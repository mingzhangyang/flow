import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBackup, parseBackup, mergeCheckIns, BACKUP_KIND, BACKUP_VERSION } from './backup';
import { checkIn } from '../runtime/adherence';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';
import { catalogDefinitionKey } from '../session/flowCatalog';

const medKey = catalogDefinitionKey(medicationFlow.id, 'example');

const sampleData = () => ({
  flows: [coffeeFlow, medicationFlow],
  revisions: { [coffeeFlow.id]: [{ ...coffeeFlow, title: '旧标题', version: 1 }] },
  checkIns: { [medKey]: [checkIn('n1', 1000, true, 1010)] },
  exportedAt: 42,
});

test('正式 v1 备份 round-trip 无损', () => {
  const data = sampleData();
  const parsed = parseBackup(buildBackup(data));
  assert.ok(parsed);
  assert.equal(parsed.kind, BACKUP_KIND);
  assert.equal(parsed.backupVersion, BACKUP_VERSION);
  assert.deepEqual(parsed.flows, data.flows);
  assert.deepEqual(parsed.revisions, data.revisions);
  assert.deepEqual(parsed.checkIns, data.checkIns);
});

test('不是正式 v1 备份则返回 null', () => {
  assert.equal(parseBackup('not json'), null);
  assert.equal(parseBackup('{"schemaVersion":2,"id":"x"}'), null);
  assert.equal(parseBackup(JSON.stringify({ kind: BACKUP_KIND, backupVersion: 2 })), null);
  assert.equal(parseBackup(JSON.stringify([])), null);
});

test('坏 flow / 快照 / check-in 单独丢弃，其余保留', () => {
  const raw = JSON.parse(buildBackup(sampleData())) as {
    flows: unknown[];
    revisions: Record<string, unknown[]>;
    checkIns: Record<string, unknown[]>;
  };
  raw.flows.push({ id: 'bad', nodes: 'nope' });
  raw.revisions.bad = [{ garbage: true }];
  raw.checkIns[medKey].push({ nodeId: 1 });

  const parsed = parseBackup(JSON.stringify(raw));
  assert.ok(parsed);
  assert.deepEqual(parsed.flows, sampleData().flows);
  assert.deepEqual(parsed.revisions, sampleData().revisions);
  assert.deepEqual(parsed.checkIns, sampleData().checkIns);
});

test('打卡合并同一占位本机优先', () => {
  const local = [checkIn('a', 1000, true, 1005)];
  const incoming = [checkIn('a', 1000, false, 900), checkIn('b', 2000, true, 2001)];
  const merged = mergeCheckIns(local, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((c) => c.nodeId === 'a')?.taken, true);
  assert.equal(merged.find((c) => c.nodeId === 'b')?.at, 2001);
});

test('特殊 Flow ID 在 revision 与 canonical check-in identity 中 round-trip', () => {
  const special = { ...medicationFlow, id: '__proto__', title: '特殊 ID' };
  const revisions = Object.fromEntries([['__proto__', [{ ...special, title: '旧版' }]]]);
  const checkInKey = catalogDefinitionKey(special.id, 'owned');
  const checkIns = Object.fromEntries([[checkInKey, [checkIn('dose', 1000, true, 1001)]]]);
  const parsed = parseBackup(buildBackup({ flows: [special], revisions, checkIns, exportedAt: 7 }));
  assert.ok(parsed);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.revisions, '__proto__'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.checkIns, checkInKey), true);
});


test('revision record key 与 snapshot.id 不一致时丢弃该快照', () => {
  const raw = JSON.parse(buildBackup(sampleData())) as {
    revisions: Record<string, unknown[]>;
  };
  raw.revisions[coffeeFlow.id] = [{ ...coffeeFlow, id: 'other-flow', title: 'wrong owner' }];

  const parsed = parseBackup(JSON.stringify(raw));
  assert.ok(parsed);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.revisions, coffeeFlow.id), false);
});

test('check-in record 跳过 bare flowId 与非 canonical definition key', () => {
  const raw = JSON.parse(buildBackup(sampleData())) as {
    checkIns: Record<string, unknown[]>;
  };
  raw.checkIns[medicationFlow.id] = [checkIn('legacy', 2000, true, 2001)];
  raw.checkIns[` ${medKey}`] = [checkIn('spaced', 3000, true, 3001)];

  const parsed = parseBackup(JSON.stringify(raw));
  assert.ok(parsed);
  assert.deepEqual(parsed.checkIns, sampleData().checkIns);
});


test('正式 v1 envelope 缺字段或容器 shape 错误时整体拒绝，不伪装成空恢复', () => {
  const valid = {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAt: 42,
    flows: [],
    revisions: {},
    checkIns: {},
  };

  const invalid = [
    { kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, flows: [], revisions: {}, checkIns: {} },
    { ...valid, exportedAt: '42' },
    { kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 42, revisions: {}, checkIns: {} },
    { ...valid, flows: {} },
    { kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 42, flows: [], checkIns: {} },
    { ...valid, revisions: [] },
    { ...valid, revisions: null },
    { kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 42, flows: [], revisions: {} },
    { ...valid, checkIns: [] },
    { ...valid, checkIns: 'truncated' },
  ];
  for (const value of invalid) {
    assert.equal(parseBackup(JSON.stringify(value)), null);
  }
});
