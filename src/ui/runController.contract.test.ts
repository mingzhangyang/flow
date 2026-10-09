import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type RunSaveOutcome } from '../session/definitionRuntime';
import {
  startIfIdleAction, completeCurrentAction, skipCurrentAction, pauseAction, resumeAction, backAction,
} from '../session/actions';
import { createRunController } from './runController';

const flow: Flow = {
  schemaVersion: 2, id: 'mine', title: 'Mine', topology: 'sequential',
  nodes: [
    { id: 'a', kind: 'timed', label: 'A', durationSec: 60 },
    { id: 'b', kind: 'gate', label: 'B' },
    { id: 'c', kind: 'timed', label: 'C', durationSec: 30 },
  ],
};
const empty: Run = { id: 'run', flow, events: [] };

/** Session stand-in: saves settle strictly in submission order, like the session lane. */
function fakeSession() {
  const queue: Array<{ run: Run; resolve: (o: RunSaveOutcome) => void; reject: (e: Error) => void }> = [];
  let persisted: Run | null = null;
  return {
    save(run: Run): Promise<RunSaveOutcome> {
      return new Promise((resolve, reject) => queue.push({ run, resolve, reject }));
    },
    pending: () => queue.length,
    persisted: () => persisted,
    settleOldest(ok: boolean): void {
      const next = queue.shift();
      if (!next) return;
      if (ok) {
        persisted = next.run;
        next.resolve({ reminder: 'synced' });
      } else {
        next.reject(new Error('disk full'));
      }
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a second tap from the same (older) render is ignored, never applied to the next step', () => {
  const session = fakeSession();
  const controller = createRunController(empty, { save: session.save, onRun: () => {}, onSave: () => {} });
  controller.install(empty);
  const seen = controller.current();
  assert.equal(controller.dispatch(seen, (r) => startIfIdleAction(r.events, 0)), true);
  const step1 = controller.current();
  assert.equal(controller.dispatch(step1, (r) => completeCurrentAction(r.flow, r.events, 1)), true);
  const afterFirst = controller.current();
  // Double-tap: the handler still holds `step1`, the snapshot the user was looking at.
  assert.equal(controller.dispatch(step1, (r) => completeCurrentAction(r.flow, r.events, 2)), false);
  assert.equal(controller.current(), afterFirst);
});

test('nothing applies before the loaded Run is installed', () => {
  const controller = createRunController(empty, { save: fakeSession().save, onRun: () => {}, onSave: () => {} });
  assert.equal(controller.dispatch(empty, (r) => startIfIdleAction(r.events, 0)), false);
  assert.equal(controller.needsLeaveConfirmation(), false);
});

test('a change is marked saving in the same call, before any render or effect', () => {
  const controller = createRunController(empty, { save: fakeSession().save, onRun: () => {}, onSave: () => {} });
  controller.install(empty);
  assert.equal(controller.saveState().status, 'saving');
  assert.equal(controller.needsLeaveConfirmation(), true);
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('model: I1 stale taps ignored, I2 leave allowed only when the visible Run is persisted, I3 no unsubmitted change (300 seeded walks)', async () => {
  const intents: Array<(r: Run, at: number) => RunEvent | null> = [
    (r, at) => startIfIdleAction(r.events, at),
    (r, at) => completeCurrentAction(r.flow, r.events, at),
    (r, at) => skipCurrentAction(r.flow, r.events, at),
    (r, at) => pauseAction(r.flow, r.events, at),
    (r, at) => resumeAction(r.flow, r.events, at),
    (r, at) => backAction(r.flow, r.events, at),
  ];
  for (let seed = 1; seed <= 300; seed++) {
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const session = fakeSession();
    let rendered = empty; // What React last rendered (lags the controller until "render").
    const controller = createRunController(empty, { save: session.save, onRun: () => {}, onSave: () => {} });
    controller.install(empty);
    rendered = controller.current();
    let clock = 0;

    for (let step = 0; step < 40; step++) {
      const where = `seed ${seed} step ${step}`;
      clock += Math.floor(rand() * 20_000);
      const op = pick(['tap', 'tap', 'tap', 'render', 'reset', 'ok', 'ok', 'fail', 'resave'] as const);
      if (op === 'tap') {
        const before = controller.current();
        const intent = pick(intents);
        const at = clock;
        const changed = controller.dispatch(rendered, (r) => intent(r, at));
        if (rendered !== before) {
          assert.equal(changed, false, `${where}: I1 stale tap applied`);
          assert.equal(controller.current(), before, `${where}: I1`);
        }
        if (changed) assert.equal(controller.saveState().status, 'saving', `${where}: I3`);
      } else if (op === 'render') {
        rendered = controller.current();
      } else if (op === 'reset') {
        if (controller.replace(rendered, { ...empty })) {
          assert.equal(controller.saveState().status, 'saving', `${where}: I3`);
        }
      } else if (op === 'resave') {
        controller.resave();
      } else {
        session.settleOldest(op === 'ok');
        await flush();
      }
      // I2: no confirmation needed  =>  nothing in flight and the visible Run is what's stored.
      if (!controller.needsLeaveConfirmation()) {
        assert.equal(session.pending(), 0, `${where}: I2 save still in flight`);
        assert.deepEqual(session.persisted(), controller.current(), `${where}: I2 visible Run not persisted`);
      }
    }
  }
});
