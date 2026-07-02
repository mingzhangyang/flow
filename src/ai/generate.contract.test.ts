// 生成管线契约测试（C10）：prompt 构建与输出解析是纯函数；编排经由 ModelPort（供应商无关）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGenerationRequest, parseGeneratedFlow, generateFlow } from './generate';
import type { ModelPort } from './model/port';

const sequentialJson = JSON.stringify({
  title: '法压咖啡',
  description: '四分钟浸泡',
  topology: 'sequential',
  nodes: [
    { kind: 'instant', label: '倒入热水', rationale: '92 度水温最合适' },
    { kind: 'timed', label: '浸泡', durationSec: 240, rationale: '充分萃取' },
    { kind: 'gate', label: '压下压杆' },
  ],
});

const scheduledJson = JSON.stringify({
  title: '每日服药',
  topology: 'scheduled',
  repeat: { kind: 'daily' },
  nodes: [
    { kind: 'scheduled', label: '早餐药', at: '08:00' },
    {
      kind: 'parallel',
      label: '晚间药组',
      children: [
        { kind: 'scheduled', label: 'A 药', at: '22:00' },
        { kind: 'scheduled', label: 'B 药', at: '22:00' },
      ],
    },
  ],
});

// ---- buildGenerationRequest ----

test('请求包含 schema 约束与用户描述', () => {
  const req = buildGenerationRequest('  做一杯法压咖啡  ');
  assert.equal(req.prompt, '做一杯法压咖啡');
  assert.ok(req.system);
  assert.match(req.system as string, /sequential/);
  assert.match(req.system as string, /scheduled/);
  assert.match(req.system as string, /rationale/);
  assert.match(req.system as string, /不要输出 id/);
});

// ---- parseGeneratedFlow ----

test('解析顺序型输出：分配 id、保留 rationale、通过校验', () => {
  const res = parseGeneratedFlow(sequentialJson, { id: 'flow-1', locale: 'zh' });
  assert.ok(res.ok);
  assert.equal(res.flow.id, 'flow-1');
  assert.equal(res.flow.schemaVersion, 2);
  assert.equal(res.flow.nodes.length, 3);
  assert.deepEqual(res.flow.nodes.map((n) => n.id), ['n1', 'n2', 'n3']);
  assert.equal(res.flow.nodes[1].kind, 'timed');
  assert.equal(res.flow.nodes[0].rationale, '92 度水温最合适');
});

test('解析日程型输出："HH:MM" 换算为分钟，并行子节点也分配 id', () => {
  const res = parseGeneratedFlow(scheduledJson, { id: 'flow-2', locale: 'zh' });
  assert.ok(res.ok);
  const first = res.flow.nodes[0];
  assert.equal(first.kind, 'scheduled');
  assert.equal(first.kind === 'scheduled' && first.at, 8 * 60);
  const group = res.flow.nodes[1];
  assert.ok(group.kind === 'parallel');
  assert.equal(group.kind === 'parallel' && group.children.length, 2);
  const childIds = group.kind === 'parallel' ? group.children.map((c) => c.id) : [];
  assert.deepEqual(childIds, ['n3', 'n4']); // 与顶层 id 不冲突
});

test('容忍 markdown 代码块与前后缀文字', () => {
  const wrapped = '当然，这是您要的 flow：\n```json\n' + sequentialJson + '\n```\n希望有帮助！';
  const res = parseGeneratedFlow(wrapped, { id: 'f', locale: 'zh' });
  assert.ok(res.ok);
});

test('非 JSON 输出返回错误（不抛异常）', () => {
  const res = parseGeneratedFlow('抱歉，我做不到。', { id: 'f', locale: 'zh' });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && /JSON/.test(res.error));
});

test('校验失败返回问题列表（如空 nodes、未知 kind）', () => {
  const empty = parseGeneratedFlow(JSON.stringify({ title: 't', topology: 'sequential', nodes: [] }), { id: 'f', locale: 'zh' });
  assert.equal(empty.ok, false);
  assert.ok(!empty.ok && empty.issues && empty.issues.length > 0);

  const badKind = parseGeneratedFlow(
    JSON.stringify({ title: 't', topology: 'sequential', nodes: [{ kind: 'magic', label: 'x' }] }),
    { id: 'f', locale: 'zh' },
  );
  assert.equal(badKind.ok, false);
});

test('repeat 整理（flow 级）：weekly/everyNDays 收下，缺省与未知回落不重复', () => {
  const mk = (repeat?: unknown, onNode = false): string =>
    JSON.stringify({
      title: 't',
      topology: 'scheduled',
      ...(repeat !== undefined && !onNode ? { repeat } : {}),
      nodes: [{ kind: 'scheduled', label: 'x', at: '08:00', ...(repeat !== undefined && onNode ? { repeat } : {}) }],
    });
  const rep = (text: string) => {
    const res = parseGeneratedFlow(text, { id: 'f', locale: 'zh', todayDayIndex: 123 });
    assert.ok(res.ok);
    return res.flow.repeat;
  };
  assert.equal(rep(mk()), undefined); // 缺省 → 不重复（仅今天）
  assert.equal(rep(mk({ kind: 'monthly' })), undefined); // 未知 → 不重复
  assert.deepEqual(rep(mk({ kind: 'daily' })), { kind: 'daily' });
  assert.deepEqual(rep(mk({ kind: 'weekly', days: [3, 3, 9, 1] })), { kind: 'weekly', days: [3, 1] }); // 去重、滤越界
  assert.deepEqual(rep(mk({ kind: 'everyNDays', n: 2 })), { kind: 'everyNDays', n: 2, fromDay: 123 }); // 起算日来自注入
  // 容错：模型按旧习惯把 repeat 写在节点上 → 提升为 flow 级
  assert.deepEqual(rep(mk({ kind: 'daily' }, true)), { kind: 'daily' });
});

test('日程型输出可携带锚定时区（timeZone 透传）', () => {
  const withTz = JSON.parse(scheduledJson);
  withTz.timeZone = 'Asia/Shanghai';
  const res = parseGeneratedFlow(JSON.stringify(withTz), { id: 'f', locale: 'zh' });
  assert.ok(res.ok);
  assert.equal(res.flow.timeZone, 'Asia/Shanghai');
  // 未提及时区则不带该字段
  const plain = parseGeneratedFlow(scheduledJson, { id: 'f', locale: 'zh' });
  assert.ok(plain.ok && plain.flow.timeZone === undefined);
});

// ---- generateFlow（经由 ModelPort，供应商无关）----

function stubPort(text: string): ModelPort {
  return {
    id: 'stub/test-model',
    complete: async () => ({ text, model: 'test-model' }),
  };
}

test('generateFlow：任何实现了 ModelPort 的供应商都能产出带来源标注的草稿', async () => {
  const res = await generateFlow(stubPort(sequentialJson), '做咖啡', { id: 'flow-9', locale: 'zh' });
  assert.ok(res.ok);
  assert.equal(res.flow.provenance?.source, 'ai:stub/test-model'); // E6 来源标注
  assert.equal(res.flow.version, undefined); // 版本由 library.commit 分配（AI-C3）
});

test('generateFlow：解析失败原样返回错误结果', async () => {
  const res = await generateFlow(stubPort('nope'), 'x', { id: 'f', locale: 'zh' });
  assert.equal(res.ok, false);
});
