import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type RunSaveOutcome } from '../session/definitionRuntime';
import { createRunSaveTracker, type RunSaveState } from './runSaveTracker';

function controlled() {
  let resolve = (_: RunSaveOutcome): void => {};
  let reject = (_: unknown): void => {};
  const promise = new Promise<RunSaveOutcome>((ok, fail) => { resolve = ok; reject = fail; });
  return { write: () => promise, resolve, reject };
}

function recording() {
  const seen: RunSaveState[] = [];
  const tracker = createRunSaveTracker((state) => seen.push(state));
  return { seen, tracker };
}

test('a save is never reported saved before the write is confirmed', async () => {
  const { seen, tracker } = recording();
  const write = controlled();
  tracker.submit(write.write);
  assert.equal(tracker.current().status, 'saving');
  write.resolve({ reminder: 'synced' });
  assert.deepEqual(await tracker.settled(), { status: 'saved', reminderFailed: false });
  assert.deepEqual(seen.map((s) => s.status), ['saving', 'saved']);
});

test('a failed write is reported failed; the next whole-snapshot success clears it', async () => {
  const { tracker } = recording();
  tracker.submit(() => Promise.reject(new Error('disk full')));
  assert.equal((await tracker.settled()).status, 'failed');
  tracker.submit(async () => ({ reminder: 'synced' }));
  assert.equal((await tracker.settled()).status, 'saved');
});

test('only the latest submitted save decides the status, whatever order writes settle in', async () => {
  const { tracker } = recording();
  const older = controlled();
  const newer = controlled();
  tracker.submit(older.write);
  tracker.submit(newer.write);
  newer.resolve({ reminder: 'synced' });
  await new Promise((resolve) => setImmediate(resolve));
  older.reject(new Error('late failure'));
  assert.equal((await tracker.settled()).status, 'saved');

  const failedLatest = controlled();
  const stale = controlled();
  tracker.submit(stale.write);
  tracker.submit(failedLatest.write);
  failedLatest.reject(new Error('disk full'));
  stale.resolve({ reminder: 'synced' });
  assert.equal((await tracker.settled()).status, 'failed');
});

test('settled() waits for saves submitted while it is waiting', async () => {
  const { tracker } = recording();
  const first = controlled();
  const second = controlled();
  tracker.submit(first.write);
  const settled = tracker.settled();
  tracker.submit(second.write);
  first.resolve({ reminder: 'synced' });
  await new Promise((resolve) => setImmediate(resolve));
  second.reject(new Error('disk full'));
  assert.equal((await settled).status, 'failed');
});

test('a synchronously throwing write is a failed save, not an escaped exception', async () => {
  const { tracker } = recording();
  tracker.submit(() => { throw new Error('session is closed'); });
  assert.equal((await tracker.settled()).status, 'failed');
});

test('reminder sync failure stays visible until a newer save resolves it', async () => {
  const { tracker } = recording();
  tracker.submit(async () => ({ reminder: 'failed' }));
  assert.deepEqual(await tracker.settled(), { status: 'saved', reminderFailed: true });
  const pending = controlled();
  tracker.submit(pending.write);
  assert.deepEqual(tracker.current(), { status: 'saving', reminderFailed: true });
  pending.resolve({ reminder: 'synced' });
  assert.deepEqual(await tracker.settled(), { status: 'saved', reminderFailed: false });
});

test('a disposed tracker stops publishing to an unmounted screen', async () => {
  const { seen, tracker } = recording();
  const write = controlled();
  tracker.submit(write.write);
  tracker.dispose();
  write.resolve({ reminder: 'synced' });
  await tracker.settled();
  assert.deepEqual(seen.map((s) => s.status), ['saving']);
});

test('settledWithin never waits past its timeout; a stuck write reports still saving', async () => {
  const { tracker } = recording();
  const stuck = controlled();
  tracker.submit(stuck.write);
  const timeout = controlled();
  const waiting = tracker.settledWithin(timeout.write().then(() => {}));
  timeout.resolve({ reminder: 'synced' });
  assert.deepEqual(await waiting, { status: 'saving', reminderFailed: false });
});

test('settledWithin returns the settled state when the write finishes first', async () => {
  const { tracker } = recording();
  tracker.submit(() => Promise.reject(new Error('disk full')));
  const never = new Promise<void>(() => {});
  assert.equal((await tracker.settledWithin(never)).status, 'failed');
});
