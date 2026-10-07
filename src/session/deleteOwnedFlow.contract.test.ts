import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import { createInMemoryKV, type KVStore } from '../storage/kv';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { catalogDefinitionKey } from './flowCatalog';
import { activeRunId } from './runPersistence';
import { deleteOwnedFlowDurably, recoverPendingOwnedFlowDeletions } from './deleteOwnedFlow';

const flow: Flow = {
  schemaVersion: 2,
  id: 'owned',
  title: 'Owned',
  topology: 'sequential',
  nodes: [],
};
const ownedKey = catalogDefinitionKey(flow.id, 'owned');

function journalKey(flowId: string): string {
  return `txn:delete-owned-flow:v1:${JSON.stringify(['flow', flowId])}`;
}

function journalKeys(kv: KVStore): Promise<string[]> {
  return kv.keys().then((keys) => keys.filter((key) => key.startsWith('txn:delete-owned-flow:v1:')));
}

function deps(kv: KVStore, overrides: Partial<{
  removeFlow(id: string): Promise<void>;
  unenroll(key: string): Promise<void>;
  cancelNotifications(ids: string[]): Promise<void>;
  deleteRun(id: string): Promise<void>;
  deleteCheckIns(key: string): Promise<void>;
  deleteRevisions(id: string): Promise<void>;
}> = {}) {
  return {
    kv,
    removeFlow: overrides.removeFlow ?? (async () => {}),
    unenroll: overrides.unenroll ?? (async () => {}),
    cancelNotifications: overrides.cancelNotifications ?? (async () => {}),
    deleteRun: overrides.deleteRun ?? (async () => {}),
    deleteCheckIns: overrides.deleteCheckIns ?? (async () => {}),
    deleteRevisions: overrides.deleteRevisions ?? (async () => {}),
  };
}

test('成功删除清理 canonical owned definition-scoped 状态、计时通知和历史', async () => {
  const kv = createInMemoryKV();
  const calls: string[] = [];
  const runId = activeRunId(ownedKey);

  await deleteOwnedFlowDurably(flow, ownedKey, deps(kv, {
    async removeFlow(id) { calls.push(`flow:${id}`); },
    async unenroll(key) { calls.push(`unenroll:${key}`); },
    async cancelNotifications(ids) { calls.push(`cancel:${ids.join('|')}`); },
    async deleteRun(id) { calls.push(`run:${id}`); },
    async deleteCheckIns(key) { calls.push(`checkins:${key}`); },
    async deleteRevisions(id) { calls.push(`revisions:${id}`); },
  }));

  assert.deepEqual(calls, [
    'flow:owned',
    `unenroll:${ownedKey}`,
    `cancel:${sequentialReminderIdsForRun(runId).join('|')}`,
    `run:${runId}`,
    `checkins:${ownedKey}`,
    'revisions:owned',
  ]);
  assert.deepEqual(await journalKeys(kv), []);
});

test('中途失败保留 journal，recovery 幂等重试', async () => {
  const kv = createInMemoryKV();
  let failCancel = true;
  const calls: string[] = [];
  const d = deps(kv, {
    async removeFlow() { calls.push('remove'); },
    async unenroll() { calls.push('unenroll'); },
    async cancelNotifications() {
      calls.push('cancel');
      if (failCancel) throw new Error('cancel failed');
    },
  });

  await deleteOwnedFlowDurably(flow, ownedKey, d);
  assert.equal((await journalKeys(kv)).length, 1);

  failCancel = false;
  await recoverPendingOwnedFlowDeletions(d);
  assert.deepEqual(calls, ['remove', 'unenroll', 'cancel', 'remove', 'unenroll', 'cancel']);
  assert.deepEqual(await journalKeys(kv), []);
});

test('caller definitionKey 不匹配时在 journal 与破坏性操作前 fail closed', async () => {
  const kv = createInMemoryKV();
  let touched = false;

  await assert.rejects(() =>
    deleteOwnedFlowDurably(flow, catalogDefinitionKey(flow.id, 'example'), deps(kv, {
      async removeFlow() { touched = true; },
    })),
  );
  assert.equal(touched, false);
  assert.deepEqual(await journalKeys(kv), []);
});

test('journal 写入失败时绝不执行破坏性操作', async () => {
  const base = createInMemoryKV();
  const kv: KVStore = { ...base, async setItem() { throw new Error('journal unavailable'); } };
  let touched = false;
  await assert.rejects(() =>
    deleteOwnedFlowDurably(flow, ownedKey, deps(kv, {
      async removeFlow() { touched = true; },
    })),
  );
  assert.equal(touched, false);
});

test('recovery 身份只来自 canonical journal key；value 不得携带第二份 flow 身份', async () => {
  const kv = createInMemoryKV();
  let touched = false;
  await kv.setItem(journalKey(flow.id), JSON.stringify({ v: 1, flowId: 'other' }));

  await assert.rejects(() =>
    recoverPendingOwnedFlowDeletions(deps(kv, {
      async removeFlow() { touched = true; },
    })),
  );
  assert.equal(touched, false);
  assert.deepEqual(await journalKeys(kv), [journalKey(flow.id)]);
});

test('非 canonical journal key 在任何破坏性操作前 fail closed', async () => {
  const kv = createInMemoryKV();
  let touched = false;
  const malformedKey = 'txn:delete-owned-flow:v1: ["flow","owned"]';
  await kv.setItem(malformedKey, JSON.stringify({ v: 1 }));

  await assert.rejects(() =>
    recoverPendingOwnedFlowDeletions(deps(kv, {
      async removeFlow() { touched = true; },
    })),
  );
  assert.equal(touched, false);
  assert.equal(await kv.getItem(malformedKey), JSON.stringify({ v: 1 }));
});

test('空 journal value 是 malformed，不会被当作 absent 跳过', async () => {
  const kv = createInMemoryKV();
  await kv.setItem(journalKey('empty'), '');
  await assert.rejects(() => recoverPendingOwnedFlowDeletions(deps(kv)));
  assert.deepEqual(await journalKeys(kv), [journalKey('empty')]);
});

test('坏 journal fail closed', async () => {
  const kv = createInMemoryKV();
  await kv.setItem(journalKey('broken'), '{"v":2}');
  await assert.rejects(() => recoverPendingOwnedFlowDeletions(deps(kv)));
});

test('journal key 支持孤立 surrogate Flow ID', async () => {
  const kv = createInMemoryKV();
  const surrogateFlow = { ...flow, id: '\ud800' };
  await deleteOwnedFlowDurably(
    surrogateFlow,
    catalogDefinitionKey(surrogateFlow.id, 'owned'),
    deps(kv),
  );
  assert.deepEqual(await journalKeys(kv), []);
});
