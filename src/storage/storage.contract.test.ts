// Storage 契约测试（C10），基于内存 KV。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Run } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { createInMemoryKV } from './kv';
import { createStorage } from './storage';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

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
  assert.deepEqual(await s.loadCheckIns('example.medication'), []);

  const log = [{ nodeId: 'morning', scheduledFor: 28_800_000, taken: true, at: 28_800_500 }];
  await s.saveCheckIns('example.medication', log);
  assert.deepEqual(await s.loadCheckIns('example.medication'), log);
});
