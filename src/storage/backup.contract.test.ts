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

test('开放字符串键按普通 own property round-trip', () => {
  const special = { ...medicationFlow, id: '__proto__', title: '特殊 ID' };
  const revisions = Object.fromEntries([['__proto__', [{ ...special, title: '旧版' }]]]);
  const checkIns = Object.fromEntries([['__proto__', [checkIn('dose', 1000, true, 1001)]]]);
  const parsed = parseBackup(buildBackup({ flows: [special], revisions, checkIns, exportedAt: 7 }));
  assert.ok(parsed);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.revisions, '__proto__'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.checkIns, '__proto__'), true);
});
