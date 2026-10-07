import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { definitionKey } from '../domain/definitionIdentity';
import { createInMemoryKV } from '../storage/kv';
import { createStorage } from '../storage/storage';
import { noopNotifier } from '../notifications/notifier';
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
const journal = `txn:delete-owned-flow:v1:${JSON.stringify(['flow', flow.id])}`;

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const stage of ['saveRun', 'saveCheckIns', 'cancel', 'schedule'] as const) {
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
        async saveCheckIns(id, value) { await pause('saveCheckIns'); await storage.saveCheckIns(id, value); },
      },
      notifier, now: () => 1000,
    });
    const session = runtime.open(key);
    const writing = stage === 'saveCheckIns' ? session.saveCheckIns(log) : session.saveRun(run, 'en');
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
    await assert.rejects(() => session.saveCheckIns(log), /closed/);
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
    await recreated.saveCheckIns(log);
    await assert.rejects(() => session.saveCheckIns([]), /closed/);
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
      async saveCheckIns(id, value) {
        if (++calls === 1) { entered.resolve(); await release.promise; }
        await storage.saveCheckIns(id, value);
      },
    }, notifier: noopNotifier, now: () => 1000,
  });
  const old = runtime.open(key);
  const first = old.saveCheckIns(log);
  await entered.promise;
  const second = old.saveCheckIns([]);
  old.close();
  const current = runtime.open(key);
  const reading = current.loadCheckIns();
  await assert.rejects(() => old.saveCheckIns(log), /closed/);
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
  await assert.rejects(() => owned.saveCheckIns(log), /closed/);
  await example.saveCheckIns(log);
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
