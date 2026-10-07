import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import { deleteOwnedFlowSafely } from './deleteOwnedFlow';

const flow: Flow = {
  schemaVersion: 2,
  id: 'owned',
  title: 'Owned',
  topology: 'scheduled',
  nodes: [],
};

test('删除定义失败时绝不触碰 enrollment', async () => {
  const calls: string[] = [];
  await assert.rejects(() =>
    deleteOwnedFlowSafely(flow, 'key', 'legacy', {
      async removeFlow() {
        calls.push('remove');
        throw new Error('remove failed');
      },
      async restoreFlow() {
        calls.push('restore');
      },
      async unenroll() {
        calls.push('unenroll');
      },
    }),
  );
  assert.deepEqual(calls, ['remove']);
});

test('unenroll 失败时恢复原 Flow，避免半成功状态', async () => {
  const calls: string[] = [];
  await assert.rejects(() =>
    deleteOwnedFlowSafely(flow, 'key', 'legacy', {
      async removeFlow() {
        calls.push('remove');
      },
      async restoreFlow(restored) {
        calls.push(`restore:${restored.id}`);
      },
      async unenroll(key, legacy) {
        calls.push(`unenroll:${key}:${legacy}`);
        throw new Error('unenroll failed');
      },
    }),
  );
  assert.deepEqual(calls, ['remove', 'unenroll:key:legacy', 'restore:owned']);
});

test('成功路径严格按 remove → unenroll 执行', async () => {
  const calls: string[] = [];
  await deleteOwnedFlowSafely(flow, 'key', undefined, {
    async removeFlow() {
      calls.push('remove');
    },
    async restoreFlow() {
      calls.push('restore');
    },
    async unenroll() {
      calls.push('unenroll');
    },
  });
  assert.deepEqual(calls, ['remove', 'unenroll']);
});
