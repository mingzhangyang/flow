import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaveGuard, authorizeRouteExit, type LeaveDisposition } from './leaveGuard';

function confirmHarness(initial: LeaveDisposition) {
  let disposition = initial;
  const choices: Array<(allowed: boolean) => void> = [];
  const gate = createLeaveGuard({
    disposition: () => disposition,
    prompt: (answer) => choices.push(answer),
  });
  return {
    gate, choices,
    status(next: LeaveDisposition) { disposition = next; },
    decide(answer: boolean) {
      const current = choices.shift();
      assert.ok(current, 'a real confirmation must exist');
      current(answer);
    },
  };
}

test('notification replacement must wait for a pending check-in confirmation; cancel keeps the old route and retry', async () => {
  const pending = confirmHarness('confirm');
  const old = { name: 'run', sessionId: 1 };
  let route = old;
  let closes = 0;
  const requestNotification = () => authorizeRouteExit(old, () => route, () => pending.gate.request())
    .then((allowed) => {
      if (allowed) { closes++; route = { name: 'run', sessionId: 2 }; }
    });

  const first = requestNotification();
  assert.equal(closes, 0, 'session must not close before user decision');
  const back = pending.gate.request();
  assert.equal(pending.choices.length, 1, 'simultaneous Back and notification share one prompt');
  pending.decide(false);
  await Promise.all([first, back]);
  assert.equal(route, old);
  assert.equal(closes, 0);

  // After a failed write, the screen remains active and can retry.
  pending.status('allow');
  assert.equal(await pending.gate.request(), true);
});

test('confirming a notification transition closes one old session, not the accepted write', async () => {
  const pending = confirmHarness('confirm');
  const original = { name: 'run', sessionId: 1 };
  let route = original;
  let oldSessionClosed = false;
  let completedWrite = false;
  let releaseWrite!: () => void;
  const writing = new Promise<void>((resolve) => { releaseWrite = () => { completedWrite = true; resolve(); }; });
  const transition = authorizeRouteExit(original, () => route, () => pending.gate.request())
    .then((approved) => {
      if (approved) { oldSessionClosed = true; route = { name: 'run', sessionId: 2 }; }
    });
  assert.equal(oldSessionClosed, false);
  pending.decide(true);
  await transition;
  assert.equal(oldSessionClosed, true);
  releaseWrite();
  await writing;
  assert.equal(completedWrite, true, 'accepted durable work must not be cancelled');
});

test('late approval cannot navigate or close a newer route', async () => {
  const pending = confirmHarness('confirm');
  const original = { name: 'edit' };
  let route = original;
  const attempt = authorizeRouteExit(original, () => route, () => pending.gate.request());
  route = { name: 'home' };
  pending.decide(true);
  assert.equal(await attempt, false);
  assert.equal(route.name, 'home');
});

test('editor saving is blocked, while dirty draft uses the same notification exit gate', async () => {
  const pending = confirmHarness('block');
  assert.equal(await pending.gate.request(), false, 'saving cannot be interrupted');
  assert.equal(pending.choices.length, 0);
  pending.status('confirm');
  const confirmation = pending.gate.request();
  assert.equal(pending.choices.length, 1);
  pending.decide(false);
  assert.equal(await confirmation, false);
  const accepted = pending.gate.request();
  pending.decide(true);
  assert.equal(await accepted, true);
});

test('aborted screen resolves outstanding prompt as denied and ignores a late native button callback', async () => {
  const pending = confirmHarness('confirm');
  const requested = pending.gate.request();
  const oldAlert = pending.choices[0];
  pending.gate.cancel();
  assert.equal(await requested, false);
  pending.choices.shift(); // Remove dismissed native dialog from the fake alert queue.
  const newRequest = pending.gate.request();
  assert.notEqual(newRequest, requested);
  oldAlert(true); // A delayed callback from the dismissed dialog cannot grant permission.
  pending.decide(true);
  assert.equal(await newRequest, true);
});

test('no pending intent allows immediate navigation; confirmation errors fail closed', async () => {
  const clean = confirmHarness('allow');
  assert.equal(await clean.gate.request(), true);
  assert.equal(clean.choices.length, 0);
  const old = { name: 'run' };
  let current = old;
  assert.equal(await authorizeRouteExit(old, () => current, async () => { throw new Error('alert failed'); }), false);
  current = { name: 'home' };
  assert.equal(await authorizeRouteExit(old, () => current, async () => true), false);
});

test('saving starts after a dirty alert opens: later approval cannot interrupt commit', async () => {
  const pending = confirmHarness('confirm');
  const requested = pending.gate.request();
  pending.status('block');
  pending.decide(true);
  assert.equal(await requested, false);
});
