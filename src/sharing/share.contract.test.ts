// 分享契约测试（C10）：文案组装、来源标注（E6）、混合文本提取与导入闭环，全部纯函数。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSharePayload, buildShareText, extractFlowJson, DATA_DIVIDER, SHARE_SOURCE } from './share';
import { deserializeFlow } from '../domain/serialize';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

// ---- 来源标注（E6）----

test('buildSharePayload：盖署名与来源章，不动原对象', () => {
  const shared = buildSharePayload(coffeeFlow, { author: '老杨' });
  assert.equal(shared.provenance?.author, '老杨');
  assert.equal(shared.provenance?.source, SHARE_SOURCE);
  assert.equal(coffeeFlow.provenance, undefined); // 原对象未被修改
});

test('buildSharePayload：保留已有来源（如 ai:…），不覆盖', () => {
  const aiFlow = { ...coffeeFlow, provenance: { source: 'ai:stub/m' } };
  const shared = buildSharePayload(aiFlow, { author: 'A' });
  assert.equal(shared.provenance?.source, 'ai:stub/m');
  assert.equal(shared.provenance?.author, 'A');
});

test('buildSharePayload：空白署名不产生 author 字段', () => {
  const shared = buildSharePayload(coffeeFlow, { author: '  ' });
  assert.equal(shared.provenance?.author, undefined);
});

// ---- 分享文案 ----

test('buildShareText：标题 + 署名 + 解读（含「为什么」）+ 分界线 + 数据', () => {
  const text = buildShareText(coffeeFlow, { author: '老杨', locale: 'zh' });
  assert.match(text, /《.*法压咖啡.*》/);
  assert.match(text, /分享者：老杨/);
  assert.match(text, /顺序型/); // explain 的概述
  assert.match(text, /因为/); // rationale 进入人读部分（AI-C2）
  assert.ok(text.includes(DATA_DIVIDER));
});

test('buildShareText：日程型附医疗免责；顺序型不附（E6，两种语言）', () => {
  assert.match(buildShareText(medicationFlow, { locale: 'zh' }), /不构成医疗处方/);
  assert.doesNotMatch(buildShareText(coffeeFlow, { locale: 'zh' }), /不构成医疗处方/);
  assert.match(buildShareText(medicationFlow, { locale: 'en' }), /not a medical prescription/);
  assert.doesNotMatch(buildShareText(coffeeFlow, { locale: 'en' }), /not a medical prescription/);
});

// ---- 提取与导入闭环 ----

test('extractFlowJson：纯 JSON、整段分享文案都能提取；垃圾文本返回 null', () => {
  const text = buildShareText(coffeeFlow, { author: '老杨', locale: 'zh' });
  const fromShare = extractFlowJson(text);
  assert.ok(fromShare);
  const fromPlain = extractFlowJson(JSON.stringify({ a: 1 }));
  assert.equal(fromPlain, '{"a":1}');
  assert.equal(extractFlowJson('没有数据的闲聊'), null);
  assert.equal(extractFlowJson('花括号{不配对'), null);
});

test('闭环：分享全文 → 提取 → 反序列化 == 盖章后的 payload', () => {
  const text = buildShareText(medicationFlow, { author: '老杨', locale: 'zh' });
  const json = extractFlowJson(text);
  assert.ok(json);
  const back = deserializeFlow(json);
  assert.deepEqual(back, buildSharePayload(medicationFlow, { author: '老杨' }));
});

test('跨语言闭环：英文分享全文在导入端同样可提取（C6）', () => {
  const text = buildShareText(medicationFlow, { author: 'Yang', locale: 'en' });
  const json = extractFlowJson(text);
  assert.ok(json);
  assert.deepEqual(deserializeFlow(json), buildSharePayload(medicationFlow, { author: 'Yang' }));
});
