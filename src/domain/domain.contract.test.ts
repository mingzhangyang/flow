// 领域层契约测试（C10）：只针对公开接口断言。
// 覆盖：校验规则、序列化无损与稳定。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, type Flow } from './types';
import { validateFlow } from './validate';
import { serializeFlow, deserializeFlow } from './serialize';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

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
    nodes: [{ kind: 'scheduled', id: 'x', label: 'x', at: 1500 }],
  };
  assert.ok(validateFlow(sched).some((i) => i.path.endsWith('at')));
});

test('校验捕获节点类型与拓扑不相容', () => {
  // scheduled 节点放进 sequential 流
  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION, id: 'f', title: 't', topology: 'sequential',
    nodes: [{ kind: 'scheduled', id: 'x', label: 'x', at: 60 }],
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

test('迁移 v1 → v2：节点级 repeat 上移为 flow 级（ADR-0003）', () => {
  const v1 = JSON.stringify({
    schemaVersion: 1,
    id: 'old',
    title: '旧数据',
    topology: 'scheduled',
    nodes: [
      { kind: 'scheduled', id: 'a', label: 'A', at: 480, repeat: { kind: 'daily' } },
      {
        kind: 'parallel', id: 'g', label: '组',
        children: [{ kind: 'scheduled', id: 'b', label: 'B', at: 600, repeat: { kind: 'daily' } }],
      },
    ],
  });
  const flow = deserializeFlow(v1);
  assert.equal(flow.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(flow.repeat, { kind: 'daily' }); // 取第一个 scheduled 节点的节律
  // 节点不再携带 repeat
  assert.ok(flow.nodes.every((n) => !('repeat' in n)));
  const group = flow.nodes[1];
  assert.ok(group.kind === 'parallel' && group.children.every((n) => !('repeat' in n)));
  // 迁移后可正常再序列化（无损、合法）
  assert.deepEqual(deserializeFlow(serializeFlow(flow)), flow);
});

test('迁移 v1 → v2：顺序型 v1 不产生 repeat 字段', () => {
  const v1 = JSON.stringify({
    schemaVersion: 1, id: 'seq', title: 't', topology: 'sequential',
    nodes: [{ kind: 'timed', id: 'a', label: 'A', durationSec: 60 }],
  });
  const flow = deserializeFlow(v1);
  assert.equal(flow.schemaVersion, SCHEMA_VERSION);
  assert.equal(flow.repeat, undefined);
});
