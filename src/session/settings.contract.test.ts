// 应用偏好的契约测试（C10）：round-trip、读入闸门、未知字段容忍（E5 加法演进）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { loadSettings, saveSettings } from './settings';

test('缺省：无存档 → 空偏好（全部跟随系统）', async () => {
  assert.deepEqual(await loadSettings(createInMemoryKV()), {});
});

test('round-trip：存什么读什么', async () => {
  const kv = createInMemoryKV();
  await saveSettings(kv, { locale: 'zh-Hant', appearance: 'dark' });
  assert.deepEqual(await loadSettings(kv), { locale: 'zh-Hant', appearance: 'dark' });
});

test('读入闸门：坏 JSON → 空偏好；非法枚举值逐字段丢弃', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('settings:v1', 'not json');
  assert.deepEqual(await loadSettings(kv), {});

  await kv.setItem('settings:v1', JSON.stringify({ locale: 'fr', appearance: 'dark' }));
  assert.deepEqual(await loadSettings(kv), { appearance: 'dark' });

  await kv.setItem('settings:v1', JSON.stringify({ locale: 'zh', appearance: 'sepia' }));
  assert.deepEqual(await loadSettings(kv), { locale: 'zh' });
});

test('未知字段容忍：新版本多出的字段不影响已知字段读入', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('settings:v1', JSON.stringify({ locale: 'en', futureField: { nested: true } }));
  assert.deepEqual(await loadSettings(kv), { locale: 'en' });
});
