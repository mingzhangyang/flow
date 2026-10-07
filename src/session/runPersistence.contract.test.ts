import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionKey } from '../domain/definitionIdentity';
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
const key = (source: 'owned' | 'example' = 'owned'): string =>
  definitionKey({ source, flowId: v1.id });

test('不同 definitionKey 生成不同 active Run id；bare key 在生成边界被拒绝', () => {
  assert.notEqual(activeRunId(key('example')), activeRunId(key('owned')));
  assert.throws(() => activeRunId('bare-key'));
});

test('已有事件的 Run 保留开始时的 Flow 快照', () => {
  const saved: Run = {
    id: activeRunId(key()),
    flow: v1,
    events: [{ type: 'started', at: 1 }],
  };
  const next = runForCurrentDefinition(saved, v2, activeRunId(key()));
  assert.equal(next.flow.title, 'v1');
  assert.deepEqual(next.events, saved.events);
});

test('尚未开始的 Run 使用当前定义', () => {
  const saved: Run = { id: activeRunId(key()), flow: v1, events: [] };
  const next = runForCurrentDefinition(saved, v2, activeRunId(key()));
  assert.equal(next.flow.title, 'v2');
});

test('存储读取失败直接拒绝，绝不退化成空 Run', async () => {
  await assert.rejects(() =>
    loadRunForDefinition(
      { async loadRun() { throw new Error('storage unavailable'); } },
      v2,
      key(),
    ),
  );
});


test('存在的 Run identity mismatch 是读取错误，绝不归一化或退化为空 Run', () => {
  const expectedId = activeRunId(key());
  assert.throws(() =>
    runForCurrentDefinition(
      { id: 'wrong-run-id', flow: v1, events: [{ type: 'started', at: 1 }] },
      v2,
      expectedId,
    ),
  );
  assert.throws(() =>
    runForCurrentDefinition(
      { id: expectedId, flow: { ...v1, id: 'other-flow' }, events: [] },
      v2,
      expectedId,
    ),
  );
});

test('definitionKey 与 current Flow 错配时在读取存储前 fail closed', async () => {
  let touched = false;
  await assert.rejects(() =>
    loadRunForDefinition(
      {
        async loadRun() {
          touched = true;
          return null;
        },
      },
      { ...v2, id: 'other-flow' },
      key(),
    ),
  );
  assert.equal(touched, false);
});

test('只有真正缺失的 Run 才创建空 Run', async () => {
  const expectedId = activeRunId(key());
  const loaded = await loadRunForDefinition(
    { async loadRun(id) { assert.equal(id, expectedId); return null; } },
    v2,
    key(),
  );
  assert.deepEqual(loaded, { id: expectedId, flow: v2, events: [] });
});
