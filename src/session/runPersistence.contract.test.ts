import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { activeRunId, legacyActiveRunId, runForCurrentDefinition } from './runPersistence';

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
