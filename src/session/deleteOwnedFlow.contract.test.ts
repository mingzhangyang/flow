import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import { createInMemoryKV, type KVStore } from '../storage/kv';
import { deleteOwnedFlowDurably, recoverPendingOwnedFlowDeletions } from './deleteOwnedFlow';

const flow: Flow = {
  schemaVersion: 2,
  id: 'owned',
  title: 'Owned',
  topology: 'scheduled',
  nodes: [],
};

function journalKeys(kv: KVStore): Promise<string[]> {
  return kv.keys().then((keys) => keys.filter((key) => key.startsWith('txn:delete-owned-flow:')));
}

test('成功删除先落 journal，再 remove → unenroll → 清 journal', async () => {
  const kv = createInMemoryKV();
  const calls: string[] = [];
  await deleteOwnedFlowDurably(flow, 'key', 'legacy', {
    kv,
    async removeFlow(id) { calls.push(`remove:${id}`); },
    async unenroll(key, legacy) { calls.push(`unenroll:${key}:${legacy}`); },
  });

  assert.deepEqual(calls, ['remove:owned', 'unenroll:key:legacy']);
  assert.deepEqual(await journalKeys(kv), []);
});

test('remove 失败时 durable intent 保留，后续 recovery 可继续完成', async () => {
  const kv = createInMemoryKV();
  let failRemove = true;
  const calls: string[] = [];
  const deps = {
    kv,
    async removeFlow(id: string) {
      calls.push(`remove:${id}`);
      if (failRemove) throw new Error('remove failed');
    },
    async unenroll(key: string) { calls.push(`unenroll:${key}`); },
  };

  await assert.rejects(() => deleteOwnedFlowDurably(flow, 'key', undefined, deps));
  assert.equal((await journalKeys(kv)).length, 1);
  assert.deepEqual(calls, ['remove:owned']);

  failRemove = false;
  await recoverPendingOwnedFlowDeletions(deps);
  assert.deepEqual(calls, ['remove:owned', 'remove:owned', 'unenroll:key']);
  assert.deepEqual(await journalKeys(kv), []);
});

test('unenroll 失败时不尝试脆弱 rollback；intent 保留供恢复重试', async () => {
  const kv = createInMemoryKV();
  let failUnenroll = true;
  const calls: string[] = [];
  const deps = {
    kv,
    async removeFlow(id: string) { calls.push(`remove:${id}`); },
    async unenroll(key: string) {
      calls.push(`unenroll:${key}`);
      if (failUnenroll) throw new Error('unenroll failed');
    },
  };

  await assert.rejects(() => deleteOwnedFlowDurably(flow, 'key', undefined, deps));
  assert.equal((await journalKeys(kv)).length, 1);

  failUnenroll = false;
  await recoverPendingOwnedFlowDeletions(deps);
  assert.deepEqual(calls, [
    'remove:owned',
    'unenroll:key',
    'remove:owned',
    'unenroll:key',
  ]);
  assert.deepEqual(await journalKeys(kv), []);
});

test('journal 写入失败时绝不执行破坏性操作', async () => {
  const base = createInMemoryKV();
  const kv: KVStore = {
    ...base,
    async setItem() {
      throw new Error('journal unavailable');
    },
  };
  const calls: string[] = [];

  await assert.rejects(() =>
    deleteOwnedFlowDurably(flow, 'key', undefined, {
      kv,
      async removeFlow() { calls.push('remove'); },
      async unenroll() { calls.push('unenroll'); },
    }),
  );
  assert.deepEqual(calls, []);
});

test('坏 journal fail closed，不猜测删除目标', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('txn:delete-owned-flow:broken', '{"v":1,"enrollmentKey":"key","flow":{"id":7}}');
  const calls: string[] = [];

  await assert.rejects(() =>
    recoverPendingOwnedFlowDeletions({
      kv,
      async removeFlow() { calls.push('remove'); },
      async unenroll() { calls.push('unenroll'); },
    }),
  );
  assert.deepEqual(calls, []);
});
