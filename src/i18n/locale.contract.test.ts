// Locale 解析契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocale } from './locale';

test('简体中文标签 → zh', () => {
  assert.equal(resolveLocale(['zh-Hans-CN']), 'zh');
  assert.equal(resolveLocale(['zh-CN']), 'zh');
  assert.equal(resolveLocale(['zh-SG']), 'zh');
  assert.equal(resolveLocale(['zh']), 'zh'); // 未指明脚本按简体
});

test('繁体中文标签（Hant 脚本或台/港/澳地区）→ zh-Hant', () => {
  assert.equal(resolveLocale(['zh-Hant']), 'zh-Hant');
  assert.equal(resolveLocale(['zh-Hant-TW']), 'zh-Hant');
  assert.equal(resolveLocale(['zh-TW']), 'zh-Hant');
  assert.equal(resolveLocale(['zh-HK']), 'zh-Hant');
  assert.equal(resolveLocale(['zh-MO']), 'zh-Hant');
});

test('英文与未知语言 → en；空列表回落 en', () => {
  assert.equal(resolveLocale(['en-US']), 'en');
  assert.equal(resolveLocale(['fr-FR']), 'en');
  assert.equal(resolveLocale([]), 'en');
});

test('按用户偏好顺序取第一个受支持的语言', () => {
  assert.equal(resolveLocale(['fr-FR', 'zh-CN', 'en-US']), 'zh');
  assert.equal(resolveLocale(['fr-FR', 'en-GB', 'zh-TW']), 'en');
  assert.equal(resolveLocale(['fr-FR', 'zh-HK', 'en-US']), 'zh-Hant');
});
