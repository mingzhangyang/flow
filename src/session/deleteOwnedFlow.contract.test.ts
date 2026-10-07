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

function cleanupDeps(kv: KVStore, overrides: {
  removeFlow?: (id: string) => Promise<void>;
  unenroll?: (key: string, legacy?: string) => Promise<void>;
  markLegacyAmbiguous?: (id: string) => Promise<void>;
  deleteRun?: (id: string) => Promise<void>;
  deleteDefinitionCheckIns?: (key: string) => Promise<void>;
  deleteLegacyCheckIns?: (id: string) => Promise<void>;
} = {}) {
  return {
    kv,
    removeFlow: overrides.removeFlow ?? (async () => {}),
    unenroll: overrides.unenroll ?? (async () => {}),
    markLegacyAmbiguous: overrides.markLegacyAmbiguous ?? (async () => {}),
    deleteRun: overrides.deleteRun ?? (async () => {}),
    deleteDefinitionCheckIns: overrides.deleteDefinitionCheckIns ?? (async () => {}),
    deleteLegacyCheckIns: overrides.deleteLegacyCheckIns ?? (async () => {}),
  };
}

test('成功删除先落 journal，再 remove → unenroll → 清 journal', async () => {
  const kv = createInMemoryKV();
  const calls: string[] = [];
  await deleteOwnedFlowDurably(flow, 'key', 'legacy', cleanupDeps(kv, {
    async removeFlow(id) { calls.push(`remove:${id}`); },
    async unenroll(key, legacy) { calls.push(`unenroll:${key}:${legacy}`); },
  }));

  assert.deepEqual(calls, ['remove:owned', 'unenroll:key:legacy']);
  assert.deepEqual(await journalKeys(kv), []);
});

test('remove 失败时 durable intent 保留，后续 recovery 可继续完成', async () => {
  const kv = createInMemoryKV();
  let failRemove = true;
  const calls: string[] = [];
  const deps = cleanupDeps(kv, {
    async removeFlow(id: string) {
      calls.push(`remove:${id}`);
      if (failRemove) throw new Error('remove failed');
    },
    async unenroll(key: string) { calls.push(`unenroll:${key}`); },
  });

  await deleteOwnedFlowDurably(flow, 'key', undefined, deps);
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
  const deps = cleanupDeps(kv, {
    async removeFlow(id: string) { calls.push(`remove:${id}`); },
    async unenroll(key: string) {
      calls.push(`unenroll:${key}`);
      if (failUnenroll) throw new Error('unenroll failed');
    },
  });

  await deleteOwnedFlowDurably(flow, 'key', undefined, deps);
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
      ...cleanupDeps(kv, {
        async removeFlow() { calls.push('remove'); },
        async unenroll() { calls.push('unenroll'); },
      }),
    }),
  );
  assert.deepEqual(calls, []);
});

test('坏 journal fail closed，不猜测删除目标', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('txn:delete-owned-flow:broken', '{"v":1,"definitionKey":"key","flowId":7}');
  const calls: string[] = [];

  await assert.rejects(() =>
    recoverPendingOwnedFlowDeletions({
      ...cleanupDeps(kv, {
        async removeFlow() { calls.push('remove'); },
        async unenroll() { calls.push('unenroll'); },
      }),
    }),
  );
  assert.deepEqual(calls, []);
});


test('journal 只保存稳定删除标识，不依赖 Flow schema 快照', async () => {
  const kv = createInMemoryKV();
  let failRemove = true;
  await deleteOwnedFlowDurably(flow, 'key', 'legacy', cleanupDeps(kv, {
    async removeFlow() {
      if (failRemove) throw new Error('stop after journal');
    },
  }));

  const [key] = await journalKeys(kv);
  const raw = JSON.parse((await kv.getItem(key)) ?? '{}') as Record<string, unknown>;
  assert.deepEqual(raw, {
    v: 1,
    flowId: 'owned',
    definitionKey: 'key',
    legacyFlowId: 'legacy',
  });
  assert.equal('flow' in raw, false);

  failRemove = false;
});


test('journal key 可接受 encodeURIComponent 会拒绝的孤立 surrogate flowId', async () => {
  const kv = createInMemoryKV();
  const odd = { ...flow, id: '\ud800' };
  await deleteOwnedFlowDurably(odd, 'key', undefined, cleanupDeps(kv));
  assert.deepEqual(await journalKeys(kv), []);
});


test('shadowing owned 删除先持久化 tombstone，并清理 canonical + bare runtime state', async () => {
  const kv = createInMemoryKV();
  const calls: string[] = [];
  await deleteOwnedFlowDurably(flow, 'definition-key', undefined, cleanupDeps(kv, {
    async markLegacyAmbiguous(id) { calls.push(`tombstone:${id}`); },
    async removeFlow(id) { calls.push(`remove:${id}`); },
    async unenroll(key, legacy) { calls.push(`unenroll:${key}:${legacy}`); },
    async deleteRun(id) { calls.push(`run:${id}`); },
    async deleteDefinitionCheckIns(key) { calls.push(`v2-checkins:${key}`); },
    async deleteLegacyCheckIns(id) { calls.push(`legacy-checkins:${id}`); },
  }));

  assert.deepEqual(calls, [
    'tombstone:owned',
    'remove:owned',
    'unenroll:definition-key:owned',
    `run:${JSON.stringify(['run-v2', 'definition-key'])}`,
    'v2-checkins:definition-key',
    'run:active-owned',
    'legacy-checkins:owned',
  ]);
});
