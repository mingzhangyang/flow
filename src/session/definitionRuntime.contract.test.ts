import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { definitionKey } from '../domain/definitionIdentity';
import { createInMemoryKV } from '../storage/kv';
import { createStorage } from '../storage/storage';
import { noopNotifier } from '../notifications/notifier';
import { planSequentialReminder, type Reminder } from '../notifications/plan';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { project, reduce } from '../runtime/engine';
import {
  startIfIdleAction, completeCurrentAction, skipCurrentAction, pauseAction, resumeAction, backAction,
} from './actions';
import { createDefinitionRuntime, type RunSaveOutcome } from './definitionRuntime';
import { sameJsonValue } from '../domain/jsonValue';
import { activeRunId } from './runPersistence';
import { deleteOwnedFlowDurably, recoverPendingOwnedFlowDeletions } from './deleteOwnedFlow';

const flow: Flow = {
  schemaVersion: 2, id: 'mine', title: 'Mine', topology: 'sequential',
  nodes: [{ id: 'step', kind: 'timed', label: 'Wait', durationSec: 60 }],
};
const key = definitionKey({ flowId: flow.id, source: 'owned' });
const run: Run = { id: activeRunId(key), flow, events: [{ type: 'started', at: 0 }] };
const log = [{ nodeId: 'step', scheduledFor: 0, taken: true, at: 1 }];
const record = { kind: 'record' as const, entry: log[0] };
const undo = { kind: 'undo' as const, nodeId: log[0].nodeId, scheduledFor: log[0].scheduledFor };
const journal = `txn:delete-owned-flow:v1:${JSON.stringify(['flow', flow.id])}`;

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const stage of ['saveRun', 'changeCheckIn', 'cancel', 'schedule'] as const) {
  test(`deletion drains delayed ${stage} before clearing state, notifications and journal`, async () => {
    const kv = createInMemoryKV();
    const storage = createStorage(kv);
    await storage.saveFlow(flow);
    const entered = deferred();
    const release = deferred();
    const pause = async (at: string): Promise<void> => {
      if (at === stage) { entered.resolve(); await release.promise; }
    };
    const notifications = new Set<string>();
    const notifier = {
      ...noopNotifier,
      async cancel(ids: string[]) {
        await pause('cancel');
        for (const id of ids) notifications.delete(id);
      },
      async schedule(reminders: Parameters<typeof noopNotifier.schedule>[0]) {
        await pause('schedule');
        for (const reminder of reminders) notifications.add(reminder.id);
        return 'scheduled' as const;
      },
    };
    const runtime = createDefinitionRuntime({
      storage: {
        ...storage,
        async saveRun(value) { await pause('saveRun'); await storage.saveRun(value); },
        async changeCheckIn(id, change) { await pause('changeCheckIn'); return storage.changeCheckIn(id, change); },
      },
      notifier, now: () => 1000,
    });
    const session = runtime.open(key);
    const writing = stage === 'changeCheckIn' ? session.changeCheckIn(record) : session.saveRun(run, 'en');
    await entered.promise;
    session.close(); // The user exits while the platform operation is still pending.
    const deleting = deleteOwnedFlowDurably(flow, key, {
      kv, runtime,
      removeFlow: (id) => storage.deleteFlow(id),
      unenroll: async () => {},
      cancelScheduledNotifications: async () => {},
      cancelNotifications: (ids) => notifier.cancel(ids),
      deleteRun: (id) => storage.deleteRun(id),
      deleteCheckIns: (id) => storage.deleteCheckIns(id),
      deleteRevisions: (id) => storage.deleteRevisions(id),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.notEqual(await kv.getItem(journal), null);
    assert.deepEqual(await storage.loadFlow(flow.id), flow); // Cleanup has not overtaken the write.
    assert.throws(() => runtime.open(key), /pending/);
    await assert.rejects(() => session.changeCheckIn(record), /closed/);
    await assert.rejects(() => session.saveRun(run, 'en'), /closed/);

    release.resolve();
    await Promise.all([writing, deleting]);
    assert.equal(await storage.loadFlow(flow.id), null);
    assert.equal(await storage.loadRun(run.id), null);
    assert.deepEqual(await storage.loadCheckIns(key), []);
    assert.equal(notifications.size, 0);
    assert.equal(await kv.getItem(journal), null);

    // Recreating this ID grants a new session, never reactivates an old screen callback.
    await storage.saveFlow(flow);
    const recreated = runtime.open(key);
    assert.notEqual(recreated.id, session.id);
    await recreated.changeCheckIn(record);
    await assert.rejects(() => session.changeCheckIn(undo), /closed/);
    assert.deepEqual(await recreated.loadCheckIns(), log);
  });
}

test('exit drains accepted FIFO saves; a reopened screen reads after those saves', async () => {
  const storage = createStorage(createInMemoryKV());
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const runtime = createDefinitionRuntime({
    storage: {
      ...storage,
      async changeCheckIn(id, change) {
        if (++calls === 1) { entered.resolve(); await release.promise; }
        return storage.changeCheckIn(id, change);
      },
    }, notifier: noopNotifier, now: () => 1000,
  });
  const old = runtime.open(key);
  const first = old.changeCheckIn(record);
  await entered.promise;
  const second = old.changeCheckIn(undo);
  old.close();
  const current = runtime.open(key);
  const reading = current.loadCheckIns();
  await assert.rejects(() => old.changeCheckIn(record), /closed/);
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(await reading, []);
});

test('failed runtime operation cannot poison deletion; failed cleanup stays fenced until recovery', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  await storage.saveFlow(flow);
  const runtime = createDefinitionRuntime({
    storage: {
      ...storage,
      // Lands, then fails, and cannot even be read back: the save must reject.
      async saveRun(value) { await storage.saveRun(value); throw new Error('write failed'); },
      async loadRun() { throw new Error('read failed'); },
    },
    notifier: noopNotifier, now: () => 1000,
  });
  const old = runtime.open(key);
  await assert.rejects(() => old.saveRun(run, 'en'), /write failed/);
  let fail = true;
  const deps = {
    kv, runtime,
    removeFlow: (id: string) => storage.deleteFlow(id),
    unenroll: async () => {},
    cancelScheduledNotifications: async () => {},
    cancelNotifications: noopNotifier.cancel,
    deleteRun: (id: string) => storage.deleteRun(id),
    async deleteCheckIns(id: string) {
      if (fail) throw new Error('cleanup failed');
      await storage.deleteCheckIns(id);
    },
    deleteRevisions: (id: string) => storage.deleteRevisions(id),
  };
  await deleteOwnedFlowDurably(flow, key, deps);
  assert.notEqual(await kv.getItem(journal), null);
  assert.throws(() => runtime.open(key), /pending/);
  await assert.rejects(() => old.saveRun(run, 'en'), /closed/);
  fail = false;
  await recoverPendingOwnedFlowDeletions(deps);
  assert.equal(await kv.getItem(journal), null);
  assert.equal(await storage.loadRun(run.id), null);
  assert.equal(runtime.open(key).isOpen(), true);
});

test('retiring owned state leaves a same-ID example session usable', async () => {
  const storage = createStorage(createInMemoryKV());
  const runtime = createDefinitionRuntime({ storage, notifier: noopNotifier, now: () => 0 });
  const exampleKey = definitionKey({ flowId: flow.id, source: 'example' });
  const example = runtime.open(exampleKey);
  const owned = runtime.open(key);
  await runtime.retire(key, async () => {});
  await assert.rejects(() => owned.changeCheckIn(record), /closed/);
  await example.changeCheckIn(record);
  assert.deepEqual(await storage.loadCheckIns(exampleKey), log);
});

test('overlapping retirements keep the fence until the latest cleanup completes', async () => {
  const runtime = createDefinitionRuntime({ storage: createStorage(createInMemoryKV()), notifier: noopNotifier, now: () => 0 });
  const gate = deferred();
  const first = runtime.retire(key, async () => {});
  const second = runtime.retire(key, () => gate.promise);
  await first;
  assert.throws(() => runtime.open(key), /pending/);
  gate.resolve();
  await second;
  assert.equal(runtime.open(key).isOpen(), true);
});

test('session rejects a Run belonging to another definition before persistence or notification work', async () => {
  const kv = createInMemoryKV();
  const runtime = createDefinitionRuntime({ storage: createStorage(kv), notifier: noopNotifier, now: () => 0 });
  const session = runtime.open(key);
  await assert.rejects(() => session.saveRun({ ...run, id: 'wrong' }, 'en'), /belong/);
  await assert.rejects(() => session.saveRun({ ...run, flow: { ...flow, id: 'other' } }, 'en'));
  assert.deepEqual(await kv.keys(), []);
});

// Sequential Run persistence. Invariant (architecture.md, Notification): the installed
// reminder is derived from the PERSISTED Run only. An unconfirmed write rejects and leaves
// reminders untouched; a confirmed one reports whether its reminder is installed (C6/E2/E6).
type Delivery = 'scheduled' | 'denied' | 'unsupported' | 'throw';

function reminderRecorder(delivery: () => Delivery = () => 'scheduled') {
  const installed = new Map<string, Reminder>();
  const notifier = {
    ...noopNotifier,
    async cancel(ids: string[]) { for (const id of ids) installed.delete(id); },
    async schedule(reminders: Reminder[]) {
      const mode = delivery();
      if (mode === 'throw') throw new Error('native scheduling failed');
      if (mode !== 'scheduled') return mode;
      for (const reminder of reminders) installed.set(reminder.id, reminder);
      return 'scheduled' as const;
    },
  };
  return { installed, notifier };
}

test('saveRun installs the reminder for the snapshot only after it is durably written', async () => {
  const storage = createStorage(createInMemoryKV());
  const { installed, notifier } = reminderRecorder();
  const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'synced' });
  assert.deepEqual(await storage.loadRun(run.id), run);
  assert.deepEqual([...installed.keys()], sequentialReminderIdsForRun(run.id));
});

test('an unconfirmed write rejects and leaves reminders describing the persisted Run', async () => {
  const storage = createStorage(createInMemoryKV());
  const { installed, notifier } = reminderRecorder();
  let failing = false;
  const session = createDefinitionRuntime({
    storage: { ...storage, async saveRun(value) { if (failing) throw new Error('disk full'); await storage.saveRun(value); } },
    notifier, now: () => 1000,
  }).open(key);
  await session.saveRun(run, 'en'); // Persisted: running, reminder installed.
  failing = true;
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  await assert.rejects(() => session.saveRun(paused, 'en'), /disk full/);
  assert.deepEqual(await storage.loadRun(run.id), run);
  assert.deepEqual([...installed.keys()], sequentialReminderIdsForRun(run.id)); // Still the persisted Run's.
});

test('a write that lands and then throws is confirmed by reading it back', async () => {
  const storage = createStorage(createInMemoryKV());
  const { installed, notifier } = reminderRecorder();
  const session = createDefinitionRuntime({
    storage: { ...storage, async saveRun(value) { await storage.saveRun(value); throw new Error('ack lost'); } },
    notifier, now: () => 1000,
  }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'synced' });
  assert.deepEqual([...installed.keys()], sequentialReminderIdsForRun(run.id));
});

test('a rejected write realigns reminders to what is stored; unreadable storage rings nothing', async () => {
  const storage = createStorage(createInMemoryKV());
  const { installed, notifier } = reminderRecorder();
  let mode: 'ok' | 'drop' | 'garble' = 'ok';
  let readable = true;
  const session = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (mode === 'ok') return storage.saveRun(value);
        if (mode === 'garble') await storage.saveRun({ ...value, events: [] }); // A different Run landed.
        throw new Error('write failed');
      },
      async loadRun(id) {
        if (!readable) throw new Error('read failed');
        return storage.loadRun(id);
      },
    },
    notifier, now: () => 1000,
  }).open(key);
  mode = 'garble';
  await assert.rejects(() => session.saveRun(run, 'en'), /write failed/);
  assert.equal(installed.size, 0); // Stored Run is not started: nothing may ring.

  mode = 'ok';
  await session.saveRun(run, 'en');
  assert.equal(installed.size, 1);
  mode = 'drop';
  readable = false;
  await assert.rejects(() => session.saveRun(run, 'en'), /write failed/);
  assert.equal(installed.size, 0); // Reopening would fail closed; no reminder for it.
});

test('a reminder that is not actually installed is reported with its reason, never "synced"', async () => {
  for (const mode of ['denied', 'unsupported'] as const) {
    const storage = createStorage(createInMemoryKV());
    const { installed, notifier } = reminderRecorder(() => mode);
    const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
    assert.deepEqual(await session.saveRun(run, 'en'), { reminder: mode });
    assert.deepEqual(await storage.loadRun(run.id), run); // The snapshot itself is saved.
    assert.equal(installed.size, 0);
  }
  const { notifier } = reminderRecorder(() => 'throw');
  const session = createDefinitionRuntime({
    storage: createStorage(createInMemoryKV()), notifier, now: () => 1000,
  }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'failed' });
});

test('no planned reminder needs no delivery: a paused Run is synced even when denied', async () => {
  const { notifier } = reminderRecorder(() => 'denied');
  const session = createDefinitionRuntime({
    storage: createStorage(createInMemoryKV()), notifier, now: () => 1000,
  }).open(key);
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  assert.deepEqual(await session.saveRun(paused, 'en'), { reminder: 'synced' });
});

test('retrying the latest snapshot after failures persists the whole log and replays identically', async () => {
  const storage = createStorage(createInMemoryKV());
  let failing = true;
  const session = createDefinitionRuntime({
    storage: { ...storage, async saveRun(value) { if (failing) throw new Error('transient'); await storage.saveRun(value); } },
    notifier: reminderRecorder().notifier, now: () => 1000,
  }).open(key);
  const steps: Run[] = [
    run,
    { ...run, events: [...run.events, { type: 'paused', at: 10_000 }] },
    { ...run, events: [...run.events, { type: 'paused', at: 10_000 }, { type: 'resumed', at: 20_000 }] },
  ];
  for (const step of steps) await assert.rejects(() => session.saveRun(step, 'en'), /transient/);
  assert.equal((await session.loadRun(flow)).events.length, 0);

  failing = false;
  const latest = steps[steps.length - 1];
  assert.deepEqual(await session.saveRun(latest, 'en'), { reminder: 'synced' });
  const reloaded = await session.loadRun(flow);
  assert.deepEqual(reloaded, latest);
  assert.deepEqual(project(reloaded.flow, reloaded.events, 30_000), project(latest.flow, latest.events, 30_000));
});

// Interleaving model: random user intents, clocks, storage faults (a write that is dropped,
// one that lands and then throws, and an unreadable read-back) and notifier outcomes.
// After EVERY call, whether it resolved or rejected, installed reminders are exactly what
// the stored Run plans (or nothing, when delivery did not install or storage is unreadable).
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

test('model: installed reminders always derive from the stored Run (200 seeded walks)', async () => {
  const modelFlow: Flow = {
    schemaVersion: 2, id: 'mine', title: 'Mine', topology: 'sequential',
    nodes: [
      { id: 'a', kind: 'timed', label: 'A', durationSec: 60 },
      { id: 'b', kind: 'gate', label: 'B' },
      { id: 'c', kind: 'timed', label: 'C', durationSec: 30 },
    ],
  };
  const intents = [
    (r: Run, at: number) => startIfIdleAction(r.events, at),
    (r: Run, at: number) => completeCurrentAction(r.flow, r.events, at),
    (r: Run, at: number) => skipCurrentAction(r.flow, r.events, at),
    (r: Run, at: number) => pauseAction(r.flow, r.events, at),
    (r: Run, at: number) => resumeAction(r.flow, r.events, at),
    (r: Run, at: number) => backAction(r.flow, r.events, at),
  ];
  const deliveries: Delivery[] = ['scheduled', 'scheduled', 'scheduled', 'denied', 'unsupported', 'throw'];
  const writes = ['ok', 'ok', 'ok', 'drop', 'landThenThrow'] as const;
  for (let seed = 1; seed <= 200; seed++) {
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const storage = createStorage(createInMemoryKV());
    let write: (typeof writes)[number] = 'ok';
    let readable = true;
    let delivery: Delivery = 'scheduled';
    let clock = 0;
    const { installed, notifier } = reminderRecorder(() => delivery);
    const session = createDefinitionRuntime({
      storage: {
        ...storage,
        async saveRun(value) {
          if (write === 'drop') throw new Error('write rejected');
          await storage.saveRun(value);
          if (write === 'landThenThrow') throw new Error('write landed, then the call failed');
        },
        async loadRun(id) {
          if (!readable) throw new Error('read failed');
          return storage.loadRun(id);
        },
      },
      notifier, now: () => clock,
    }).open(key);
    let visible: Run = { id: activeRunId(key), flow: modelFlow, events: [] };

    for (let step = 0; step < 25; step++) {
      clock += Math.floor(rand() * 40_000);
      const event = pick(intents)(visible, clock);
      if (event) visible = reduce(visible, event);
      else if (rand() < 0.1) visible = { ...visible, events: [] }; // reset
      write = pick(writes);
      readable = rand() < 0.85;
      delivery = pick(deliveries);
      const where = `seed ${seed} step ${step} (${write}, ${readable ? 'readable' : 'unreadable'}, ${delivery})`;
      let outcome: RunSaveOutcome | null = null;
      try {
        outcome = await session.saveRun(visible, 'en');
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      const stored = await storage.loadRun(visible.id);
      // Confirmed iff the exact snapshot is known to be stored (a dropped write of an
      // unchanged snapshot reads back identical, and is genuinely confirmed).
      const confirmed = write === 'ok' || (readable && stored !== null && sameJsonValue(stored, visible));
      assert.equal(outcome !== null, confirmed, where);

      const planned = stored
        ? planSequentialReminder(stored.flow, stored.events, clock, stored.id, 'en', key)
        : null;
      const installedNow = [...installed.values()];
      const readBackUsed = !confirmed || write !== 'ok';
      if (readBackUsed && !readable) {
        assert.deepEqual(installedNow, [], `${where}: unreadable storage must ring nothing`);
      } else if (delivery === 'scheduled') {
        assert.deepEqual(installedNow, planned ? [planned] : [], `${where}: reminder != stored Run`);
      } else {
        assert.deepEqual(installedNow, [], `${where}: nothing can be installed`);
      }
      if (outcome) {
        const expected = { scheduled: 'synced', denied: 'denied', unsupported: 'unsupported', throw: 'failed' } as const;
        assert.equal(outcome.reminder, planned ? expected[delivery] : 'synced', where);
      }
    }
  }
});
