// 领域层契约测试（C10）：只针对公开接口断言。
// 覆盖：校验规则、序列化无损与稳定。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, type Flow } from './types.ts';
import { validateFlow } from './validate.ts';
import { serializeFlow, deserializeFlow } from './serialize.ts';
import { coffeeFlow } from '../examples/coffee.ts';
import { medicationFlow } from '../examples/medication.ts';

test('两个示例 Flow 都是合法的', () => {
  assert.deepEqual(validateFlow(coffeeFlow), []);
  assert.deepEqual(validateFlow(medicationFlow), []);
});

test('校验捕获缺失字段与空节点', () => {
  const bad: Flow = { schemaVersion: SCHEMA_VERSION, id: '', title: '', topology: 'sequential', nodes: [] };
  const paths = validateFlow(bad).map((i) => i.path);
  assert.ok(paths.includes('id'));
  assert.ok(paths.includes('title'));
  assert.ok(paths.includes('nodes'));
});

test('校验捕获重复节点 id', () => {
  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION, id: 'f', title: 't', topology: 'sequential',
    nodes: [
      { kind: 'instant', id: 'dup', label: 'a' },
      { kind: 'instant', id: 'dup', label: 'b' },
    ],
  };
  assert.ok(validateFlow(flow).some((i) => i.message.includes('duplicate')));
});

test('校验捕获非法计时时长与越界时刻', () => {
  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION, id: 'f', title: 't', topology: 'sequential',
    nodes: [{ kind: 'timed', id: 'x', label: 'x', durationSec: 0 }],
  };
  assert.ok(validateFlow(flow).some((i) => i.path.endsWith('durationSec')));

  const sched: Flow = {
    schemaVersion: SCHEMA_VERSION, id: 'f', title: 't', topology: 'scheduled',
    nodes: [{ kind: 'scheduled', id: 'x', label: 'x', at: 1500, repeat: { kind: 'daily' } }],
  };
  assert.ok(validateFlow(sched).some((i) => i.path.endsWith('at')));
});

test('校验捕获节点类型与拓扑不相容', () => {
  // scheduled 节点放进 sequential 流
  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION, id: 'f', title: 't', topology: 'sequential',
    nodes: [{ kind: 'scheduled', id: 'x', label: 'x', at: 60, repeat: { kind: 'daily' } }],
  };
  assert.ok(validateFlow(flow).some((i) => i.path.endsWith('kind')));
});

test('序列化 <-> 反序列化无损', () => {
  for (const flow of [coffeeFlow, medicationFlow]) {
    const restored = deserializeFlow(serializeFlow(flow));
    assert.deepEqual(restored, flow);
  }
});

test('序列化是稳定的（幂等）', () => {
  for (const flow of [coffeeFlow, medicationFlow]) {
    const once = serializeFlow(flow);
    const twice = serializeFlow(deserializeFlow(once));
    assert.equal(twice, once);
  }
});
