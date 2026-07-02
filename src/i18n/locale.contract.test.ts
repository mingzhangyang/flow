// Locale 解析契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocale } from './locale';

test('中文标签（含繁体/地区变体）→ zh', () => {
  assert.equal(resolveLocale(['zh-Hans-CN']), 'zh');
  assert.equal(resolveLocale(['zh-TW']), 'zh');
  assert.equal(resolveLocale(['zh']), 'zh');
});

test('英文与未知语言 → en；空列表回落 en', () => {
  assert.equal(resolveLocale(['en-US']), 'en');
  assert.equal(resolveLocale(['fr-FR']), 'en');
  assert.equal(resolveLocale([]), 'en');
});

test('按用户偏好顺序取第一个受支持的语言', () => {
  assert.equal(resolveLocale(['fr-FR', 'zh-CN', 'en-US']), 'zh');
  assert.equal(resolveLocale(['fr-FR', 'en-GB', 'zh-CN']), 'en');
});
