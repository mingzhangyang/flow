// 编辑变换契约测试（C10）：结构正确 + 不可变（入参不被修改）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type TimedNode } from './types';
import { createFlow, addNode, updateNode, removeNode, moveNode, setMeta } from './editing';

const timed = (id: string, label: string, durationSec = 60): TimedNode => ({ kind: 'timed', id, label, durationSec });

function draft(): Flow {
  let f = createFlow({ id: 'f1', title: '我的流程', topology: 'sequential' });
  f = addNode(f, timed('a', '第一步'));
  f = addNode(f, timed('b', '第二步'));
  return f;
}

test('createFlow 产生 version 1 的空流程', () => {
  const f = createFlow({ id: 'x', title: 't', topology: 'sequential' });
  assert.equal(f.version, 1);
  assert.equal(f.nodes.length, 0);
});

test('addNode 追加且不改动入参', () => {
  const f0 = createFlow({ id: 'x', title: 't', topology: 'sequential' });
  const f1 = addNode(f0, timed('a', 'A'));
  assert.equal(f0.nodes.length, 0); // 入参不变
  assert.equal(f1.nodes.length, 1);
});

test('updateNode 改字段（含 rationale）', () => {
  const f = updateNode(draft(), 'a', { label: '改过', rationale: '因为要先热锅' });
  const a = f.nodes.find((n) => n.id === 'a');
  assert.equal(a?.label, '改过');
  assert.equal(a?.rationale, '因为要先热锅');
});

test('removeNode 删除指定节点', () => {
  const f = removeNode(draft(), 'a');
  assert.deepEqual(f.nodes.map((n) => n.id), ['b']);
});

test('moveNode 上/下移，越界原样返回', () => {
  const f = draft();
  assert.deepEqual(moveNode(f, 'b', -1).nodes.map((n) => n.id), ['b', 'a']);
  assert.equal(moveNode(f, 'a', -1), f); // 已在顶端，原样返回
});

test('setMeta 改标题', () => {
  assert.equal(setMeta(draft(), { title: '新标题' }).title, '新标题');
});
