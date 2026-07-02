// Library 契约测试（C10），基于内存 KV。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { createStorage } from '../storage/storage';
import { createLibrary, MAX_REVISIONS } from './library';
import { createFlow, addNode, setMeta } from '../domain/editing';
import { serializeFlow } from '../domain/serialize';
import { type TimedNode } from '../domain/types';

const step = (id: string, label: string): TimedNode => ({ kind: 'timed', id, label, durationSec: 60 });

function make() {
  const storage = createStorage(createInMemoryKV());
  return { storage, lib: createLibrary(storage) };
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
