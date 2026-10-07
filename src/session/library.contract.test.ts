// Library 契约测试（C10），基于内存 KV。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { createStorage, type Storage } from '../storage/storage';
import { parseBackup } from '../storage/backup';
import { createLibrary, MAX_REVISIONS, type Library } from './library';
import { createFlow, addNode, setMeta } from '../domain/editing';
import { serializeFlow } from '../domain/serialize';
import { type TimedNode } from '../domain/types';
import { catalogDefinitionKey } from './flowCatalog';
import { type Backup } from '../storage/backup';

const step = (id: string, label: string): TimedNode => ({ kind: 'timed', id, label, durationSec: 60 });

function make() {
  const storage = createStorage(createInMemoryKV());
  return { storage, lib: createLibrary(storage) };
}

const medicationDefinitionKey = catalogDefinitionKey('example.medication', 'example');
const mineDefinitionKey = catalogDefinitionKey('mine', 'owned');

const identitySensitiveOperations: Array<[string, (lib: Library) => Promise<unknown>]> = [
  ['get', (lib) => lib.get('mine')],
  ['list', (lib) => lib.list()],
  ['commit', (lib) => lib.commit(sample())],
  ['restore', (lib) => lib.restore(sample())],
  ['importFlow', (lib) => lib.importFlow(serializeFlow(sample()), 123)],
  ['exportFlow', (lib) => lib.exportFlow('mine')],
  ['exportBackup', (lib) => lib.exportBackup(123)],
  ['importBackup', (lib) => lib.importBackup({
    kind: 'zhunshi-backup', backupVersion: 1, exportedAt: 123,
    flows: [sample()], revisions: {}, checkIns: {},
  } satisfies Backup)],
];

for (const [operation, execute] of identitySensitiveOperations) {
  test(`${operation} rejects a mis-associated current Flow before any writes`, async () => {
    const kv = createInMemoryKV();
    const wrong = serializeFlow({ ...sample(), id: 'other' });
    await kv.setItem('flow:mine', wrong);
    await kv.setItem('flow:other', serializeFlow({ ...sample(), id: 'other', title: 'Unrelated' }));
    const before = await Promise.all((await kv.keys()).map(async (key) => [key, await kv.getItem(key)]));
    const writes: string[] = [];
    const storage = createStorage({
      ...kv,
      async setItem(key, value) { writes.push(key); await kv.setItem(key, value); },
      async removeItem(key) { writes.push(key); await kv.removeItem(key); },
    });
    await assert.rejects(() => execute(createLibrary(storage)), /persisted Flow id/);
    assert.deepEqual(writes, []);
    assert.deepEqual(await Promise.all((await kv.keys()).map(async (key) => [key, await kv.getItem(key)])), before);
  });
}

function sample() {
  return addNode(createFlow({ id: 'mine', title: '我的流程', topology: 'sequential' }), step('a', '第一步'));
}

test('首次 commit 为 version 1，可在 list 中看到', async () => {
  const { lib } = make();
  const saved = await lib.commit(sample());
  assert.equal(saved.version, 1);
  const list = await lib.list();
  assert.deepEqual(list.map((f) => f.id), ['mine']);
});

test('再次 commit 递增版本并保留历史', async () => {
  const { lib } = make();
  await lib.commit(sample());
  const edited = setMeta(sample(), { title: '改了标题' });
  const v2 = await lib.commit(edited);
  assert.equal(v2.version, 2);

  const history = await lib.revisions('mine');
  assert.equal(history.length, 1);
  assert.equal(history[0].title, '我的流程'); // 旧版本被保留
});

test('restore 把旧版本作为新修订提交（可回退）', async () => {
  const { lib } = make();
  await lib.commit(sample()); // v1: 标题“我的流程”
  await lib.commit(setMeta(sample(), { title: '第二版' })); // v2
  const [v1] = await lib.revisions('mine');

  const restored = await lib.restore(v1); // 回到 v1 内容
  assert.equal(restored.title, '我的流程');
  assert.equal(restored.version, 3); // 作为新版本提交
  const current = await lib.get('mine');
  assert.equal(current?.title, '我的流程');
});

test('导出 / 导入无损，导入登记 provenance.importedAt', async () => {
  const { lib } = make();
  const saved = await lib.commit(sample());
  const text = await lib.exportFlow('mine');
  assert.equal(text, serializeFlow(saved));

  const other = make();
  const imported = await other.lib.importFlow(text as string, 1234);
  assert.equal(imported.provenance?.importedAt, 1234);
  assert.equal(imported.id, 'mine');
  assert.deepEqual(imported.nodes, saved.nodes);
});

test('导入同 id 的 flow → 旧版本入历史，绝不静默覆盖', async () => {
  const { lib } = make();
  await lib.commit(sample()); // v1：标题「我的流程」

  const foreign = setMeta(sample(), { title: '别人分享的同名流程' });
  const imported = await lib.importFlow(serializeFlow(foreign), 999);

  assert.equal(imported.version, 2); // 作为新修订入库
  assert.equal(imported.provenance?.importedAt, 999);
  const history = await lib.revisions('mine');
  assert.equal(history.length, 1);
  assert.equal(history[0].title, '我的流程'); // 原 flow 保留在历史中，可回退
});

test('历史修订有上限：超出时丢最旧的', async () => {
  const { lib } = make();
  await lib.commit(sample());
  for (let i = 1; i <= MAX_REVISIONS + 5; i++) {
    await lib.commit(setMeta(sample(), { title: `第 ${i} 版` }));
  }
  const history = await lib.revisions('mine');
  assert.equal(history.length, MAX_REVISIONS);
  assert.equal(history.at(-1)?.title, `第 ${MAX_REVISIONS + 4} 版`); // 最新的都在
});

test('remove 从库中移除', async () => {
  const { lib } = make();
  await lib.commit(sample());
  await lib.remove('mine');
  assert.deepEqual(await lib.list(), []);
});

test('整库备份 → 新设备恢复：flow（含版本）、历史、打卡全部回来', async () => {
  const { storage, lib } = make();
  await lib.commit(sample()); // v1
  await lib.commit(setMeta(sample(), { title: '第二版' })); // v2，v1 入历史
  // 示例 flow 不入库也可能有打卡（创始场景）——备份必须带走
  await storage.saveCheckIns(medicationDefinitionKey, [{ nodeId: 'n1', scheduledFor: 1000, taken: true, at: 1010 }]);

  const text = await lib.exportBackup(777);
  const backup = parseBackup(text);
  assert.ok(backup);

  const fresh = make();
  const count = await fresh.lib.importBackup(backup);
  assert.equal(count, 1);
  const restored = await fresh.lib.get('mine');
  assert.equal(restored?.title, '第二版');
  assert.equal(restored?.version, 2); // 恢复保留版本号
  const history = await fresh.lib.revisions('mine');
  assert.equal(history.length, 1);
  assert.equal(history[0].title, '我的流程');
  assert.deepEqual(await fresh.storage.loadCheckIns(medicationDefinitionKey), [
    { nodeId: 'n1', scheduledFor: 1000, taken: true, at: 1010 },
  ]);
});

test('恢复备份不覆盖本机数据：同 id 走 commit 入历史，打卡本机优先', async () => {
  const { lib } = make();
  await lib.commit(sample());
  const text = await lib.exportBackup(777);
  const backup = parseBackup(text);
  assert.ok(backup);

  const { storage: s2, lib: lib2 } = make();
  await lib2.commit(setMeta(sample(), { title: '本机的版本' })); // 本机已有同 id
  await s2.saveCheckIns(mineDefinitionKey, [{ nodeId: 'a', scheduledFor: 500, taken: true, at: 505 }]);
  // 备份里也有 mine 的打卡（同占位但状态不同）+ 一条本机没有的
  backup.checkIns[mineDefinitionKey] = [
    { nodeId: 'a', scheduledFor: 500, taken: false, at: 400 },
    { nodeId: 'a', scheduledFor: 900, taken: true, at: 905 },
  ];

  await lib2.importBackup(backup);
  const current = await lib2.get('mine');
  assert.equal(current?.title, '我的流程'); // 备份内容成为新修订
  assert.equal(current?.version, 2);
  const history = await lib2.revisions('mine');
  assert.equal(history[0].title, '本机的版本'); // 本机原版本入历史，没有消失
  const log = await s2.loadCheckIns(mineDefinitionKey);
  assert.equal(log.length, 2);
  assert.equal(log.find((c) => c.scheduledFor === 500)?.taken, true); // 本机打卡胜出
});


test('备份保留 "__proto__" 这类开放 flowId 的历史修订', async () => {
  const { lib } = make();
  const special = addNode(
    createFlow({ id: '__proto__', title: '特殊 ID', topology: 'sequential' }),
    step('a', '一步'),
  );
  await lib.commit(special);
  await lib.commit(setMeta(special, { title: '第二版' }));

  const backup = parseBackup(await lib.exportBackup(123));
  assert.ok(backup);
  assert.equal(Object.prototype.hasOwnProperty.call(backup.revisions, '__proto__'), true);
  assert.equal(backup.revisions.__proto__[0]?.title, '特殊 ID');
});


test('commit 在历史已写入但 current 保存失败后可重试，不重复历史', async () => {
  const kv = createInMemoryKV();
  const base = createStorage(kv);
  const setup = createLibrary(base);
  await setup.commit(sample());

  let failNextSave = true;
  const faulty: Storage = {
    ...base,
    async saveFlow(flow) {
      if (failNextSave) {
        failNextSave = false;
        throw new Error('save current failed');
      }
      await base.saveFlow(flow);
    },
  };
  const lib = createLibrary(faulty);
  const edited = setMeta(sample(), { title: '第二版' });

  await assert.rejects(() => lib.commit(edited));
  assert.equal((await base.loadFlow('mine'))?.version, 1);
  assert.equal((await base.loadRevisions('mine')).length, 1);

  const saved = await lib.commit(edited);
  assert.equal(saved.version, 2);
  const history = await base.loadRevisions('mine');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.title, '我的流程');
});

test('备份恢复在后续写入失败后可安全重试，不重复生成 Flow revision', async () => {
  const source = make();
  await source.lib.commit(setMeta(sample(), { title: '备份版本' }));
  await source.storage.saveCheckIns(mineDefinitionKey, [
    { nodeId: 'a', scheduledFor: 1000, taken: true, at: 1001 },
  ]);
  const backup = parseBackup(await source.lib.exportBackup(123));
  assert.ok(backup);

  const kv = createInMemoryKV();
  const base = createStorage(kv);
  const initial = createLibrary(base);
  await initial.commit(setMeta(sample(), { title: '本机版本' }));

  let failCheckIns = true;
  const faulty: Storage = {
    ...base,
    async saveCheckIns(definitionKey, log) {
      if (failCheckIns) {
        failCheckIns = false;
        throw new Error('check-in write failed');
      }
      await base.saveCheckIns(definitionKey, log);
    },
  };
  const lib = createLibrary(faulty);

  await assert.rejects(() => lib.importBackup(backup));
  assert.equal((await base.loadFlow('mine'))?.version, 2);
  assert.equal((await base.loadRevisions('mine')).length, 1);

  await lib.importBackup(backup);
  const current = await base.loadFlow('mine');
  assert.equal(current?.title, '备份版本');
  assert.equal(current?.version, 2);
  const history = await base.loadRevisions('mine');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.title, '本机版本');
  assert.equal((await base.loadCheckIns(mineDefinitionKey)).length, 1);
});
