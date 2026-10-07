import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { activeRunId, loadRunForDefinition, runForCurrentDefinition } from './runPersistence';

const v1: Flow = {
  schemaVersion: 2,
  id: 'same',
  title: 'v1',
  topology: 'sequential',
  nodes: [{ kind: 'timed', id: 'a', label: 'A', durationSec: 10 }],
  version: 1,
};
const v2: Flow = { ...v1, title: 'v2', version: 2 };

test('不同 definitionKey 生成不同 active Run id', () => {
  assert.notEqual(activeRunId('example-key'), activeRunId('owned-key'));
});

test('已有事件的 Run 保留开始时的 Flow 快照', () => {
  const saved: Run = {
    id: activeRunId('definition'),
    flow: v1,
    events: [{ type: 'started', at: 1 }],
  };
  const next = runForCurrentDefinition(saved, v2, activeRunId('definition'));
  assert.equal(next.flow.title, 'v1');
  assert.deepEqual(next.events, saved.events);
});

test('尚未开始的 Run 使用当前定义', () => {
  const saved: Run = { id: activeRunId('definition'), flow: v1, events: [] };
  const next = runForCurrentDefinition(saved, v2, activeRunId('definition'));
  assert.equal(next.flow.title, 'v2');
});

test('存储读取失败直接拒绝，绝不退化成空 Run', async () => {
  await assert.rejects(() =>
    loadRunForDefinition(
      { async loadRun() { throw new Error('storage unavailable'); } },
      v2,
      'definition',
    ),
  );
});
