// AI 解释器契约测试（C10）：explain / analyze / diff，纯函数、确定性。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type TimedNode } from '../domain/types';
import { createFlow, addNode, updateNode, moveNode, removeNode } from '../domain/editing';
import { explain, totalTimedSeconds } from './explain';
import { analyze } from './analyze';
import { diffFlows, describeChange } from './diff';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

const timed = (id: string, label: string, d: number, rationale?: string): TimedNode => ({ kind: 'timed', id, label, durationSec: d, rationale });

// ---- explain ----

test('explain 概述 + 逐步 + 计入 rationale', () => {
  const lines = explain(coffeeFlow);
  assert.match(lines[0], /法压咖啡/);
  assert.match(lines[0], /顺序型/);
  assert.ok(lines.some((l) => /浸泡/.test(l) && /因为/.test(l))); // rationale 被写进说明
});

test('explain 日程型汇总每日时间', () => {
  const lines = explain(medicationFlow);
  assert.ok(lines.some((l) => /每天/.test(l) && /08:00/.test(l)));
});

test('totalTimedSeconds 只累加计时步', () => {
  assert.equal(totalTimedSeconds(coffeeFlow), 240 + 30);
});

// ---- analyze ----

test('analyze 找出瓶颈（最长步占比 >= 60%）', () => {
  let f = createFlow({ id: 'f', title: '测试', topology: 'sequential' });
  f = addNode(f, timed('a', '快步', 10));
  f = addNode(f, timed('b', '慢步', 100));
  const findings = analyze(f);
  const bottleneck = findings.find((x) => x.id === 'bottleneck');
  assert.ok(bottleneck);
  assert.equal(bottleneck.severity, 'warn');
  assert.match(bottleneck.detail, /慢步/);
});

test('analyze 提示缺失的“为什么”', () => {
  const f = addNode(createFlow({ id: 'f', title: 't', topology: 'sequential' }), timed('a', 'A', 10));
  assert.ok(analyze(f).some((x) => x.id === 'missing-why'));
});

test('analyze 是确定性的', () => {
  assert.deepEqual(analyze(coffeeFlow), analyze(coffeeFlow));
});

// ---- diff ----

test('diff 捕获新增/删除/修改/移动', () => {
  const base = (() => {
    let f = createFlow({ id: 'f', title: '原标题', topology: 'sequential' });
    f = addNode(f, timed('a', 'A', 10));
    f = addNode(f, timed('b', 'B', 20));
    return f;
  })();

  let next = updateNode(base, 'a', { label: 'A+', durationSec: 15 }); // 改名 + 改时长
  next = addNode(next, timed('c', 'C', 30)); // 新增
  next = removeNode(next, 'b'); // 删除
  next = { ...next, title: '新标题' }; // 改标题

  const changes = diffFlows(base, next);
  const kinds = changes.map((c) => c.kind);
  assert.ok(kinds.includes('meta'));
  assert.ok(kinds.includes('nodeAdded'));
  assert.ok(kinds.includes('nodeRemoved'));
  assert.ok(kinds.includes('nodeChanged'));

  const changed = changes.find((c) => c.kind === 'nodeChanged');
  assert.ok(changed && 'fields' in changed && changed.fields.includes('名称') && changed.fields.includes('时长'));
});

test('diff 捕获移动', () => {
  let base = createFlow({ id: 'f', title: 't', topology: 'sequential' });
  base = addNode(base, timed('a', 'A', 10));
  base = addNode(base, timed('b', 'B', 10));
  const moved = moveNode(base, 'b', -1); // b 上移
  const changes = diffFlows(base, moved);
  assert.ok(changes.some((c) => c.kind === 'nodeMoved'));
});

test('describeChange 输出可读文本', () => {
  assert.match(describeChange({ kind: 'nodeAdded', id: 'x', label: '新步骤' }), /新增/);
});

test('相同 Flow 无差异', () => {
  assert.deepEqual(diffFlows(coffeeFlow, coffeeFlow), []);
});
