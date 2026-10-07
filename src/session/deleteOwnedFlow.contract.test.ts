import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import { createInMemoryKV, type KVStore } from '../storage/kv';
import { sequentialReminderId } from '../notifications/notificationIdentity';
import { activeRunId } from './runPersistence';
import { deleteOwnedFlowDurably, recoverPendingOwnedFlowDeletions } from './deleteOwnedFlow';

const flow: Flow = {
  schemaVersion: 2,
  id: 'owned',
  title: 'Owned',
  topology: 'sequential',
  nodes: [],
};

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

test('成功删除清理 definition-scoped 状态、计时通知和历史', async () => {
  const kv = createInMemoryKV();
  const calls: string[] = [];
  const definitionKey = 'definition';
  const runId = activeRunId(definitionKey);

  await deleteOwnedFlowDurably(flow, definitionKey, deps(kv, {
    async removeFlow(id) { calls.push(`flow:${id}`); },
    async unenroll(key) { calls.push(`unenroll:${key}`); },
    async cancelNotifications(ids) { calls.push(`cancel:${ids.join('|')}`); },
    async deleteRun(id) { calls.push(`run:${id}`); },
    async deleteCheckIns(key) { calls.push(`checkins:${key}`); },
    async deleteRevisions(id) { calls.push(`revisions:${id}`); },
  }));

  assert.deepEqual(calls, [
    'flow:owned',
    'unenroll:definition',
    `cancel:${runId}|${sequentialReminderId(runId)}`,
    `run:${runId}`,
    'checkins:definition',
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

  await deleteOwnedFlowDurably(flow, 'definition', d);
  assert.equal((await journalKeys(kv)).length, 1);

  failCancel = false;
  await recoverPendingOwnedFlowDeletions(d);
  assert.deepEqual(calls, ['remove', 'unenroll', 'cancel', 'remove', 'unenroll', 'cancel']);
  assert.deepEqual(await journalKeys(kv), []);
});

test('journal 写入失败时绝不执行破坏性操作', async () => {
  const base = createInMemoryKV();
  const kv: KVStore = { ...base, async setItem() { throw new Error('journal unavailable'); } };
  let touched = false;
  await assert.rejects(() =>
    deleteOwnedFlowDurably(flow, 'definition', deps(kv, {
      async removeFlow() { touched = true; },
    })),
  );
  assert.equal(touched, false);
});

test('坏 journal fail closed', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('txn:delete-owned-flow:v1:broken', '{"v":1,"flowId":7}');
  await assert.rejects(() => recoverPendingOwnedFlowDeletions(deps(kv)));
});

test('journal key 支持孤立 surrogate Flow ID', async () => {
  const kv = createInMemoryKV();
  await deleteOwnedFlowDurably({ ...flow, id: '\ud800' }, 'definition', deps(kv));
  assert.deepEqual(await journalKeys(kv), []);
});
