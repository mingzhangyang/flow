// Storage 契约测试（C10），基于内存 KV。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Run } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { createInMemoryKV } from './kv';
import { createStorage } from './storage';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';
import { catalogDefinitionKey } from '../session/flowCatalog';

function fresh() {
  return createStorage(createInMemoryKV());
}

test('保存 / 读取 / 列出 / 删除 Flow', async () => {
  const s = fresh();
  assert.equal(await s.loadFlow('example.coffee'), null);

  await s.saveFlow(coffeeFlow);
  await s.saveFlow(medicationFlow);
  assert.deepEqual(await s.loadFlow('example.coffee'), coffeeFlow);

  const list = await s.listFlows();
  assert.deepEqual(list.map((f) => f.id), ['example.coffee', 'example.medication']);

  await s.deleteFlow('example.coffee');
  assert.equal(await s.loadFlow('example.coffee'), null);
});

test('导出 / 导入 Flow 无损', async () => {
  const s = fresh();
  await s.saveFlow(coffeeFlow);
  const text = await s.exportFlow('example.coffee');
  assert.equal(text, serializeFlow(coffeeFlow));

  const s2 = fresh();
  const imported = await s2.importFlow(text as string);
  assert.deepEqual(imported, coffeeFlow);
  assert.deepEqual(await s2.loadFlow('example.coffee'), coffeeFlow);
});

test('导入非法文本抛错', async () => {
  const s = fresh();
  await assert.rejects(() => s.importFlow('{"not":"a flow"}'));
});

test('保存 / 读取 Run（含事件日志）', async () => {
  const s = fresh();
  const run: Run = {
    id: 'active-example.coffee',
    flow: coffeeFlow,
    events: [
      { type: 'started', at: 1000 },
      { type: 'stepCompleted', index: 0, at: 1000 },
    ],
  };
  await s.saveRun(run);
  assert.deepEqual(await s.loadRun('active-example.coffee'), run);

  const runs = await s.listRuns();
  assert.equal(runs.length, 1);

  await s.deleteRun(run.id);
  assert.equal(await s.loadRun(run.id), null);
});

test('保存 / 读取打卡日志', async () => {
  const s = fresh();
  const key = catalogDefinitionKey('example.medication', 'example');
  assert.deepEqual(await s.loadCheckIns(key), []);

  const log = [{ nodeId: 'morning', scheduledFor: 28_800_000, taken: true, at: 28_800_500 }];
  await s.saveCheckIns(key, log);
  assert.deepEqual(await s.loadCheckIns(key), log);
});

// ---- 持久数据回到纯核心前的闸门：精确读取 fail closed；仅显式 best-effort 枚举可跳过 ----

test('损坏的 Run 精确读取 fail closed；listRuns 枚举可跳过坏记录', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  await kv.setItem('run:broken-json', '{not json');
  await kv.setItem('run:bad-shape', JSON.stringify({ id: 'x' }));
  await kv.setItem(
    'run:illegal-log',
    JSON.stringify({
      id: 'illegal-log',
      flow: coffeeFlow,
      events: [
        { type: 'started', at: 0 },
        { type: 'wentBack', toIndex: 999, at: 1 },
      ],
    }),
  );

  await assert.rejects(() => s.loadRun('broken-json'));
  await assert.rejects(() => s.loadRun('bad-shape'));
  await assert.rejects(() => s.loadRun('illegal-log'));
  assert.deepEqual(await s.listRuns(), []);
});

test('Run 内嵌的旧 schema flow 快照在读取时被迁移', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  const v1Flow = {
    schemaVersion: 1,
    id: 'old-med',
    title: '旧版服药',
    topology: 'scheduled',
    nodes: [{ kind: 'scheduled', id: 'a', label: '药', at: 480, repeat: { kind: 'daily' } }],
  };
  await kv.setItem(
    'run:active-old-med',
    JSON.stringify({ id: 'active-old-med', flow: v1Flow, events: [{ type: 'started', at: 0 }] }),
  );

  const run = await s.loadRun('active-old-med');
  assert.ok(run);
  assert.equal(run.flow.schemaVersion, 2);
  assert.deepEqual(run.flow.repeat, { kind: 'daily' }); // 节点上的 repeat 上移到 flow 级
});

test('打卡容器损坏 fail closed；坏条目可单独丢弃', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  const brokenKey = catalogDefinitionKey('x', 'owned');
  const malformedEnvelopeKey = catalogDefinitionKey('malformed-envelope', 'owned');
  const preReleaseArrayKey = catalogDefinitionKey('pre-release-array', 'owned');
  const goodKey = catalogDefinitionKey('y', 'owned');
  await kv.setItem('checkins:v1:' + brokenKey, '{not json');
  await assert.rejects(() => s.loadCheckIns(brokenKey));
  await kv.setItem('checkins:v1:' + malformedEnvelopeKey, '{}');
  await assert.rejects(() => s.loadCheckIns(malformedEnvelopeKey));
  const good = { nodeId: 'a', scheduledFor: 1, taken: true, at: 2 };
  const rawArray = JSON.stringify([good]);
  await kv.setItem('checkins:v1:' + preReleaseArrayKey, rawArray);
  await assert.rejects(() => s.loadCheckIns(preReleaseArrayKey), /invalid persisted check-in log/);
  // Reject the pre-release shape without trying to "fix" or replace the record.
  await assert.rejects(() => s.changeCheckIn(preReleaseArrayKey, { kind: 'undo', nodeId: 'a', scheduledFor: 1 }));
  await assert.rejects(() => s.mergeBackupCheckIns(preReleaseArrayKey, [good]));
  assert.equal(await kv.getItem('checkins:v1:' + preReleaseArrayKey), rawArray);

  await kv.setItem('checkins:v1:' + goodKey, JSON.stringify({
    v: 1, log: [good, { nodeId: 42 }, null], undone: [],
  }));
  assert.deepEqual(await s.loadCheckIns(goodKey), [good]);
});

test('damaged undo envelope is a read/write/restore/export error, not an empty check-in log', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const key = catalogDefinitionKey('medical', 'owned');
  const original = JSON.stringify({
    v: 1, log: [], undone: [{ nodeId: 19, scheduledFor: 1000 }],
  });
  await kv.setItem('checkins:v1:' + key, original);
  const dose = { nodeId: 'morning', scheduledFor: 1000, taken: true, at: 1001 };
  await assert.rejects(() => storage.loadCheckIns(key));
  await assert.rejects(() => storage.changeCheckIn(key, { kind: 'record', entry: dose }));
  await assert.rejects(() => storage.mergeBackupCheckIns(key, [dose]));
  await assert.rejects(() => storage.listAllCheckIns());
  assert.equal(await kv.getItem('checkins:v1:' + key), original);
});

test('local bulk replace cannot clear an undo fence through a stale empty snapshot', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const key = catalogDefinitionKey('medical', 'owned');
  const dose = { nodeId: 'morning', scheduledFor: 1000, taken: true, at: 1001 };
  await storage.saveCheckIns(key, [dose]);
  await storage.saveCheckIns(key, []);
  assert.deepEqual(await storage.mergeBackupCheckIns(key, [dose]), []);
  const updated = { ...dose, at: 1002 };
  await storage.saveCheckIns(key, [updated]);
  assert.deepEqual(await storage.mergeBackupCheckIns(key, [dose]), [updated]);
});

test('历史修订容器损坏 fail closed；坏快照跳过、其余保留', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  await kv.setItem('rev:broken', '{not json');
  await assert.rejects(() => s.loadRevisions('broken'));

  const ownedByX = { ...coffeeFlow, id: 'x' };
  await kv.setItem('rev:x', JSON.stringify([ownedByX, { not: 'a flow' }]));
  const revisions = await s.loadRevisions('x');
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].id, 'x');
});


test('listAllCheckIns 保留 "__proto__" 这类开放 flowId 的 canonical identity', async () => {
  const s = fresh();
  const key = catalogDefinitionKey('__proto__', 'owned');
  const log = [{ nodeId: 'dose', scheduledFor: 1, taken: true, at: 2 }];
  await s.saveCheckIns(key, log);
  const all = await s.listAllCheckIns();
  assert.equal(Object.prototype.hasOwnProperty.call(all, key), true);
  assert.deepEqual(all[key], log);
});


test('本机 revision key 与 snapshot.id 不一致时不会流入历史', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  await kv.setItem(
    'rev:owner',
    JSON.stringify([{ ...coffeeFlow, id: 'other', title: 'wrong owner' }, { ...coffeeFlow, id: 'owner' }]),
  );
  const revisions = await s.loadRevisions('owner');
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.id, 'owner');
});


test('check-in exact operations 拒绝 bare / noncanonical definitionKey 且不写入', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  const log = [{ nodeId: 'dose', scheduledFor: 1, taken: true, at: 2 }];

  await assert.rejects(() => s.saveCheckIns('bare-flow-id', log));
  await assert.rejects(() => s.loadCheckIns('bare-flow-id'));
  await assert.rejects(() => s.deleteCheckIns('bare-flow-id'));
  assert.equal(await kv.getItem('checkins:v1:bare-flow-id'), null);
});

test('listAllCheckIns 遇到 malformed identity fail closed，避免导出后静默丢日志', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  const raw = JSON.stringify([{ nodeId: 'dose', scheduledFor: 1, taken: true, at: 2 }]);
  await kv.setItem('checkins:v1:bare-flow-id', raw);

  await assert.rejects(() => s.listAllCheckIns());
  assert.equal(await kv.getItem('checkins:v1:bare-flow-id'), raw);
});


test('Run storage key 与 embedded id 不一致时精确读取 fail closed，枚举也不归一化', async () => {
  const kv = createInMemoryKV();
  const s = createStorage(kv);
  const persisted = JSON.stringify({
    id: 'other-run',
    flow: coffeeFlow,
    events: [{ type: 'started', at: 1 }],
  });
  await kv.setItem('run:expected-run', persisted);

  await assert.rejects(() => s.loadRun('expected-run'));
  assert.deepEqual(await s.listRuns(), []);
  assert.equal(await kv.getItem('run:expected-run'), persisted);
});

for (const [label, text] of [
  ['wrong owner', serializeFlow({ ...coffeeFlow, id: 'other' })],
  ['wrong owner in old schema', JSON.stringify({ ...coffeeFlow, schemaVersion: 1, id: 'other' })],
  ['empty value', ''],
  ['broken JSON', '{'],
  ['null value', 'null'],
  ['invalid shape', '{}'],
] as const) {
  test(`Flow ${label}: exact read, enumeration and export reject without changing persisted data`, async () => {
    const kv = createInMemoryKV();
    const storage = createStorage(kv);
    await storage.saveFlow(medicationFlow);
    await kv.setItem('flow:expected', text);
    await assert.rejects(() => storage.loadFlow('expected'));
    await assert.rejects(() => storage.listFlows());
    await assert.rejects(() => storage.exportFlow('expected'));
    assert.equal(await kv.getItem('flow:expected'), text);
    assert.deepEqual(await storage.loadFlow(medicationFlow.id), medicationFlow);
  });
}

test('Flow identity uses the entire opaque ID, including prefixes, punctuation and Unicode', async () => {
  const storage = fresh();
  const ids = ['__proto__', 'flow:x', 'x:y', '["owned","x"]', ' 流程 🫖 '];
  for (const id of ids) {
    const flow = { ...coffeeFlow, id };
    await storage.saveFlow(flow);
    assert.deepEqual(await storage.loadFlow(id), flow);
    assert.equal(await storage.exportFlow(id), serializeFlow(flow));
  }
  assert.deepEqual((await storage.listFlows()).map((flow) => flow.id), [...ids].sort());
  assert.equal(await storage.loadFlow('missing'), null);
  assert.equal(await storage.exportFlow('missing'), null);
});

test('Flow enumeration tolerates disappeared keys but propagates storage read failures', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage({
    ...kv,
    keys: async () => ['flow:gone', 'flow:' + coffeeFlow.id],
  });
  await storage.saveFlow(coffeeFlow);
  assert.deepEqual(await storage.listFlows(), [coffeeFlow]);
  const failed = createStorage({
    ...kv,
    getItem: async () => { throw new Error('disk unavailable'); },
  });
  await assert.rejects(() => failed.loadFlow(coffeeFlow.id), /disk unavailable/);
  await assert.rejects(() => failed.listFlows(), /disk unavailable/);
});
