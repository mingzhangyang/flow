import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { activeRunId, legacyActiveRunId, loadRunForDefinition, runForCurrentDefinition } from './runPersistence';

const v1: Flow = {
  schemaVersion: 2,
  id: 'same',
  title: 'v1',
  topology: 'sequential',
  nodes: [{ kind: 'timed', id: 'a', label: 'A', durationSec: 10 }],
  version: 1,
};
const v2: Flow = { ...v1, title: 'v2', version: 2 };

test('不同 definitionKey 永远生成不同 active run id', () => {
  const a = activeRunId(JSON.stringify(['v2', 'example', 'x']));
  const b = activeRunId(JSON.stringify(['v2', 'owned', 'x']));
  assert.notEqual(a, b);
  assert.notEqual(a, legacyActiveRunId('x'));
});

test('已有事件的 Run 保留开始时的 Flow 快照，即使当前定义已升级', () => {
  const saved: Run = {
    id: legacyActiveRunId('same'),
    flow: v1,
    events: [{ type: 'started', at: 1 }],
  };
  const next = runForCurrentDefinition(saved, v2, activeRunId('definition'));
  assert.equal(next.flow.title, 'v1');
  assert.equal(next.flow.version, 1);
  assert.deepEqual(next.events, saved.events);
});

test('尚未开始的旧 Run 不冻结旧定义，重新打开使用当前版本', () => {
  const saved: Run = { id: 'old', flow: v1, events: [] };
  const next = runForCurrentDefinition(saved, v2, 'new');
  assert.equal(next.flow.title, 'v2');
  assert.deepEqual(next.events, []);
});


test('legacy Run 迁移先持久化 v2 seed，再返回可运行状态', async () => {
  const legacyId = legacyActiveRunId(v1.id);
  const legacy: Run = { id: legacyId, flow: v1, events: [{ type: 'started', at: 1 }] };
  const calls: string[] = [];
  const result = await loadRunForDefinition(
    {
      async loadRun(id) {
        calls.push(`load:${id}`);
        return id === legacyId ? legacy : null;
      },
      async saveRun(run) {
        calls.push(`save:${run.id}`);
      },
    },
    v2,
    'definition',
    v1.id,
  );

  assert.deepEqual(calls, [
    `load:${activeRunId('definition')}`,
    `load:${legacyId}`,
    `save:${activeRunId('definition')}`,
  ]);
  assert.equal(result.run.flow.title, 'v1');
  assert.equal(result.cleanupLegacyRunId, legacyId);
});

test('v2 读取失败时直接拒绝，绝不退化成空 Run 或触发迁移写', async () => {
  let saves = 0;
  await assert.rejects(() =>
    loadRunForDefinition(
      {
        async loadRun() {
          throw new Error('storage unavailable');
        },
        async saveRun() {
          saves += 1;
        },
      },
      v2,
      'definition',
      v1.id,
    ),
  );
  assert.equal(saves, 0);
});
