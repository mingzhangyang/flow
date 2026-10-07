// 整库备份纯逻辑的契约测试（C10）：round-trip 无损（E5）、读入闸门（E4）、打卡合并语义。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBackup, parseBackup, mergeCheckIns, BACKUP_KIND } from './backup';
import { checkIn } from '../runtime/adherence';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

const sampleData = () => ({
  flows: [coffeeFlow, medicationFlow],
  revisions: { [coffeeFlow.id]: [{ ...coffeeFlow, title: '旧标题', version: 1 }] },
  checkIns: { [medicationFlow.id]: [checkIn('n1', 1000, true, 1010)] },
  exportedAt: 42,
});

test('备份 round-trip 无损', () => {
  const data = sampleData();
  const text = buildBackup(data);
  const parsed = parseBackup(text);
  assert.ok(parsed);
  assert.equal(parsed.kind, BACKUP_KIND);
  assert.equal(parsed.exportedAt, 42);
  assert.deepEqual(parsed.flows, data.flows);
  assert.deepEqual(parsed.revisions, data.revisions);
  assert.deepEqual(parsed.checkIns, data.checkIns);
});

test('非备份文本 → null（据此与单条 flow 导入区分）', () => {
  assert.equal(parseBackup('not json'), null);
  assert.equal(parseBackup('{"schemaVersion":2,"id":"x"}'), null); // 单条 flow，不是备份
  assert.equal(parseBackup('{"kind":"something-else","flows":[]}'), null);
});

test('读入闸门：坏 flow / 坏快照 / 坏打卡条目单独丢弃，其余保留', () => {
  const data = sampleData();
  const raw = JSON.parse(buildBackup(data)) as {
    flows: unknown[];
    revisions: Record<string, unknown[]>;
    checkIns: Record<string, unknown[]>;
  };
  raw.flows.push({ id: 'bad', nodes: 'nope' });
  raw.revisions.bad = [{ garbage: true }];
  raw.checkIns[medicationFlow.id].push({ nodeId: 1, scheduledFor: 'x' });

  const parsed = parseBackup(JSON.stringify(raw));
  assert.ok(parsed);
  assert.deepEqual(parsed.flows, data.flows); // 坏 flow 被丢弃
  assert.deepEqual(parsed.revisions, data.revisions); // 全坏的修订组整组消失
  assert.deepEqual(parsed.checkIns, data.checkIns); // 坏打卡条目被过滤
});

test('打卡合并：同一占位本机优先，其余并入', () => {
  const local = [checkIn('a', 1000, true, 1005)];
  const incoming = [
    checkIn('a', 1000, false, 900), // 同占位——本机记录胜出
    checkIn('b', 2000, true, 2001), // 新占位——并入
  ];
  const merged = mergeCheckIns(local, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((c) => c.nodeId === 'a')?.taken, true);
  assert.equal(merged.find((c) => c.nodeId === 'b')?.at, 2001);
});


test('开放 flowId = "__proto__" 的 revisions / checkIns 仍作为普通数据键 round-trip', () => {
  const specialFlow = { ...medicationFlow, id: '__proto__', title: '特殊 ID' };
  const revisions = Object.fromEntries([
    ['__proto__', [{ ...specialFlow, title: '旧版' }]],
  ]) as Record<string, typeof medicationFlow[]>;
  const checkIns = Object.fromEntries([
    ['__proto__', [checkIn('dose', 1000, true, 1001)]],
  ]);

  const parsed = parseBackup(buildBackup({
    flows: [specialFlow],
    revisions,
    checkIns,
    exportedAt: 7,
  }));
  assert.ok(parsed);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.revisions, '__proto__'), true);
  assert.equal(parsed.revisions.__proto__[0]?.title, '旧版');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.checkIns, '__proto__'), true);
  assert.equal(parsed.checkIns.__proto__[0]?.nodeId, 'dose');
});
