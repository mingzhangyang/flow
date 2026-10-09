import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { definitionKey } from '../domain/definitionIdentity';
import { createInMemoryKV } from '../storage/kv';
import { createStorage } from '../storage/storage';
import { noopNotifier, type ReminderAvailability } from '../notifications/notifier';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { project } from '../runtime/engine';
import { createDefinitionRuntime } from './definitionRuntime';
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
    storage: { ...storage, async saveRun(value) { await storage.saveRun(value); throw new Error('write failed'); } },
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

// Sequential Run persistence: failure is reported, never swallowed; reminders follow the
// visible snapshot; a retry of the latest snapshot restores the whole replayable log (C6/E2/E4).
const readyNotifier = { ...noopNotifier, async status(): Promise<ReminderAvailability> { return 'ready'; } };

function reminderRecorder(failSchedule = false, availability: ReminderAvailability = 'ready') {
  const scheduled = new Set<string>();
  const notifier = {
    ...noopNotifier,
    async status() { return availability; },
    async cancel(ids: string[]) { for (const id of ids) scheduled.delete(id); },
    async schedule(reminders: Parameters<typeof noopNotifier.schedule>[0]) {
      if (failSchedule) throw new Error('schedule failed');
      for (const reminder of reminders) scheduled.add(reminder.id);
    },
  };
  return { scheduled, notifier };
}

test('saveRun resolves with a synced reminder only after the snapshot is durably written', async () => {
  const storage = createStorage(createInMemoryKV());
  const { scheduled, notifier } = reminderRecorder();
  const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'synced' });
  assert.deepEqual(await storage.loadRun(run.id), run);
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('a failed snapshot write rejects, yet the reminder still follows the visible Run', async () => {
  const storage = createStorage(createInMemoryKV());
  const { scheduled, notifier } = reminderRecorder();
  const session = createDefinitionRuntime({
    storage: { ...storage, async saveRun() { throw new Error('disk full'); } },
    notifier, now: () => 1000,
  }).open(key);
  await assert.rejects(() => session.saveRun(run, 'en'), /disk full/);
  assert.equal(await storage.loadRun(run.id), null); // Nothing claims to be committed.
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id)); // Timer keeps its reminder.

  // Pausing with a failing disk cancels the obsolete timer reminder instead of firing it.
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  await assert.rejects(() => session.saveRun(paused, 'en'), /disk full/);
  assert.equal(scheduled.size, 0);
});

test('a written snapshot with a failed reminder sync resolves and reports the reminder failure', async () => {
  const storage = createStorage(createInMemoryKV());
  const { notifier } = reminderRecorder(true);
  const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'failed' });
  assert.deepEqual(await storage.loadRun(run.id), run);
});

test('retrying the latest snapshot after failures persists the whole log and replays identically', async () => {
  const storage = createStorage(createInMemoryKV());
  let failing = true;
  const session = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (failing) throw new Error('transient');
        await storage.saveRun(value);
      },
    },
    notifier: readyNotifier, now: () => 1000,
  }).open(key);
  const steps: Run[] = [
    run,
    { ...run, events: [...run.events, { type: 'paused', at: 10_000 }] },
    { ...run, events: [...run.events, { type: 'paused', at: 10_000 }, { type: 'resumed', at: 20_000 }] },
  ];
  for (const step of steps) await assert.rejects(() => session.saveRun(step, 'en'), /transient/);
  assert.equal(await session.loadRun(flow).then((loaded) => loaded.events.length), 0);

  failing = false;
  const latest = steps[steps.length - 1];
  assert.deepEqual(await session.saveRun(latest, 'en'), { reminder: 'synced' });
  const reloaded = await session.loadRun(flow);
  assert.deepEqual(reloaded, latest);
  assert.deepEqual(project(reloaded.flow, reloaded.events, 30_000), project(latest.flow, latest.events, 30_000));
});

test('leaving after a failed save realigns the reminder with the persisted Run', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const { scheduled, notifier } = reminderRecorder();
  let failing = false;
  const session = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (failing) throw new Error('disk full');
        await storage.saveRun(value);
      },
    },
    notifier, now: () => 1000,
  }).open(key);
  await session.saveRun(run, 'en'); // Persisted: running, timer reminder pending.
  failing = true;
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  await assert.rejects(() => session.saveRun(paused, 'en'));
  assert.equal(scheduled.size, 0); // Screen showed "paused": no alarm while it was visible.

  await session.syncReminderToSaved(flow, 'en');
  // Reopening shows the persisted running step, so its reminder is back.
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('reminder realignment runs after an in-flight failing save, never before it', async () => {
  const storage = createStorage(createInMemoryKV());
  const { scheduled, notifier } = reminderRecorder();
  const entered = deferred();
  const release = deferred();
  let failing = false;
  const session = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (!failing) return storage.saveRun(value);
        entered.resolve();
        await release.promise;
        throw new Error('disk full');
      },
    },
    notifier, now: () => 1000,
  }).open(key);
  await session.saveRun(run, 'en'); // Persisted: running.
  failing = true;
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  const saving = session.saveRun(paused, 'en');
  await entered.promise;
  const realigning = session.syncReminderToSaved(flow, 'en');
  session.close(); // App closes the session right after the guard approves.
  release.resolve();
  await assert.rejects(saving, /disk full/);
  await realigning;
  // The failed paused save cancelled the alarm; realignment ran AFTER it and restored
  // the persisted running reminder. Running it first would have left no reminder.
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('an unreadable persisted Run cancels the reminder instead of guessing', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const { scheduled, notifier } = reminderRecorder();
  const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
  await session.saveRun(run, 'en');
  assert.equal(scheduled.size, 1);
  await kv.setItem(`run:${run.id}`, '{ damaged');
  await session.syncReminderToSaved(flow, 'en');
  assert.equal(scheduled.size, 0);
});

test('an armed realignment waits for the session to actually close', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const { scheduled, notifier } = reminderRecorder();
  let failing = false;
  const runtime = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (failing) throw new Error('disk full');
        await storage.saveRun(value);
      },
    },
    notifier, now: () => 1000,
  });
  const session = runtime.open(key);
  await session.saveRun(run, 'en'); // Persisted: running.
  failing = true;
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  await assert.rejects(() => session.saveRun(paused, 'en'));
  assert.equal(scheduled.size, 0);

  // The user approved leaving, but navigation was abandoned (e.g. catalog not ready):
  // the Runner still shows "paused", so nothing may realign yet.
  session.realignReminderOnClose(flow, 'en');
  await session.loadRun(flow); // Drain the lane.
  assert.equal(scheduled.size, 0);

  // Reopening closes the old session first; its realignment runs before the new read.
  const reopened = runtime.open(key);
  const loaded = await reopened.loadRun(flow);
  assert.deepEqual(loaded, run);
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('an unarmed close and a deletion fence never realign reminders', async () => {
  const storage = createStorage(createInMemoryKV());
  const { scheduled, notifier } = reminderRecorder();
  const runtime = createDefinitionRuntime({ storage, notifier, now: () => 1000 });
  const session = runtime.open(key);
  await session.saveRun(run, 'en');
  scheduled.clear();
  session.close();
  await runtime.open(key).loadRun(flow);
  assert.equal(scheduled.size, 0);

  const armed = runtime.open(key);
  armed.realignReminderOnClose(flow, 'en');
  await runtime.retire(key, async () => {});
  assert.equal(scheduled.size, 0);
});

test('a confirmed save after an abandoned navigation disarms the close realignment', async () => {
  const storage = createStorage(createInMemoryKV());
  const scheduled = new Set<string>();
  let scheduleFails = false;
  const notifier = {
    ...readyNotifier,
    async cancel(ids: string[]) { for (const id of ids) scheduled.delete(id); },
    async schedule(reminders: Parameters<typeof noopNotifier.schedule>[0]) {
      if (scheduleFails) throw new Error('transient schedule failure');
      for (const reminder of reminders) scheduled.add(reminder.id);
    },
  };
  let failing = true;
  const runtime = createDefinitionRuntime({
    storage: {
      ...storage,
      async saveRun(value) {
        if (failing) throw new Error('disk full');
        await storage.saveRun(value);
      },
    },
    notifier, now: () => 1000,
  });
  const session = runtime.open(key);
  await assert.rejects(() => session.saveRun(run, 'en'));
  session.realignReminderOnClose(flow, 'en'); // Approved, but navigation was abandoned.

  failing = false; // Retry on the still-visible Runner succeeds.
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'synced' });
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));

  // A later normal exit must not cancel/reschedule the now-correct reminder.
  scheduleFails = true;
  session.close();
  await runtime.open(key).loadRun(flow);
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('a save whose reminder sync failed keeps the close realignment armed', async () => {
  const storage = createStorage(createInMemoryKV());
  let scheduleFails = true;
  const scheduled = new Set<string>();
  const notifier = {
    ...readyNotifier,
    async cancel(ids: string[]) { for (const id of ids) scheduled.delete(id); },
    async schedule(reminders: Parameters<typeof noopNotifier.schedule>[0]) {
      if (scheduleFails) throw new Error('transient schedule failure');
      for (const reminder of reminders) scheduled.add(reminder.id);
    },
  };
  const runtime = createDefinitionRuntime({ storage, notifier, now: () => 1000 });
  const session = runtime.open(key);
  session.realignReminderOnClose(flow, 'en');
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'failed' });
  scheduleFails = false;
  session.close(); // Second chance: realign from the persisted Run.
  await runtime.open(key).loadRun(flow);
  assert.deepEqual([...scheduled], sequentialReminderIdsForRun(run.id));
});

test('a reminder that schedule() silently did not install is reported, never "synced"', async () => {
  for (const availability of ['denied', 'unsupported'] as const) {
    const storage = createStorage(createInMemoryKV());
    const { notifier } = reminderRecorder(false, availability);
    const session = createDefinitionRuntime({ storage, notifier, now: () => 1000 }).open(key);
    assert.deepEqual(await session.saveRun(run, 'en'), { reminder: availability });
    assert.deepEqual(await storage.loadRun(run.id), run); // The snapshot itself is saved.
  }
  const { notifier } = reminderRecorder(false, 'undetermined');
  const session = createDefinitionRuntime({
    storage: createStorage(createInMemoryKV()), notifier, now: () => 1000,
  }).open(key);
  assert.deepEqual(await session.saveRun(run, 'en'), { reminder: 'failed' });
});

test('no planned reminder needs no permission: a paused Run is synced even when denied', async () => {
  const { notifier } = reminderRecorder(false, 'denied');
  const session = createDefinitionRuntime({
    storage: createStorage(createInMemoryKV()), notifier, now: () => 1000,
  }).open(key);
  const paused: Run = { ...run, events: [...run.events, { type: 'paused', at: 2000 }] };
  assert.deepEqual(await session.saveRun(paused, 'en'), { reminder: 'synced' });
});
