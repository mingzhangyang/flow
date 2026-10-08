// 模型端口契约测试（C10）：适配器只做协议翻译；用注入的假 fetch 断言请求形状与解析行为。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../../storage/kv';
import { createModelPort, type ModelProviderConfig } from './providers';
import { loadModelConfig, saveModelConfig, createModelConfigSession } from './settings';
import type { FetchLike } from './port';

/** 记录请求并返回固定响应的假 fetch。 */
function fakeFetch(response: { status?: number; body: unknown }) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(response.body),
    };
  };
  return { fn, calls };
}

const anthropicCfg: ModelProviderConfig = {
  provider: 'anthropic',
  apiKey: 'sk-test',
  model: 'claude-opus-4-8',
};

const openaiCfg: ModelProviderConfig = {
  provider: 'openai-compatible',
  apiKey: 'dk-test',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1/',
};

// ---- Anthropic 适配器 ----

test('anthropic：请求形状正确（端点、鉴权头、body）', async () => {
  const { fn, calls } = fakeFetch({
    body: { model: 'claude-opus-4-8', content: [{ type: 'text', text: '你好' }] },
  });
  const port = createModelPort(anthropicCfg, fn, 'zh');
  const res = await port.complete({ system: 'S', prompt: 'P', maxTokens: 100 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-test');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.max_tokens, 100);
  assert.equal(body.system, 'S');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'P' }]);
  assert.equal(res.text, '你好');
  assert.equal(res.model, 'claude-opus-4-8');
});

test('anthropic：拼接多个 text 块，忽略非 text 块', async () => {
  const { fn } = fakeFetch({
    body: { content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
  });
  const port = createModelPort(anthropicCfg, fn, 'zh');
  const res = await port.complete({ prompt: 'P' });
  assert.equal(res.text, 'AB');
});

test('anthropic：HTTP 错误给出可读信息', async () => {
  const { fn } = fakeFetch({ status: 401, body: { error: { message: 'invalid x-api-key' } } });
  const port = createModelPort(anthropicCfg, fn, 'zh');
  await assert.rejects(() => port.complete({ prompt: 'P' }), /401.*invalid x-api-key/s);
});

test('anthropic：refusal 视为错误', async () => {
  const { fn } = fakeFetch({ body: { stop_reason: 'refusal', content: [] } });
  const port = createModelPort(anthropicCfg, fn, 'zh');
  await assert.rejects(() => port.complete({ prompt: 'P' }), /拒绝/);
});

// ---- OpenAI 兼容适配器 ----

test('openai-compatible：请求形状正确（端点、Bearer、messages）', async () => {
  const { fn, calls } = fakeFetch({
    body: { model: 'deepseek-chat', choices: [{ message: { content: '好的' } }] },
  });
  const port = createModelPort(openaiCfg, fn, 'zh');
  const res = await port.complete({ system: 'S', prompt: 'P', maxTokens: 50 });

  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions'); // 末尾斜杠已归一
  assert.equal(calls[0].init.headers.authorization, 'Bearer dk-test');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_tokens, 50);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'P' },
  ]);
  assert.equal(res.text, '好的');
});

test('openai-compatible：无 system 时只发 user 消息', async () => {
  const { fn, calls } = fakeFetch({ body: { choices: [{ message: { content: 'x' } }] } });
  await createModelPort(openaiCfg, fn, 'zh').complete({ prompt: 'P' });
  assert.deepEqual(JSON.parse(calls[0].init.body).messages, [{ role: 'user', content: 'P' }]);
});

test('openai-compatible：HTTP 错误给出可读信息', async () => {
  const { fn } = fakeFetch({ status: 429, body: { error: { message: 'rate limited' } } });
  await assert.rejects(() => createModelPort(openaiCfg, fn, 'zh').complete({ prompt: 'P' }), /429.*rate limited/s);
});

test('空响应视为错误（两种适配器）', async () => {
  const a = fakeFetch({ body: { content: [] } });
  await assert.rejects(() => createModelPort(anthropicCfg, a.fn, 'zh').complete({ prompt: 'P' }), /没有返回文本/);
  const o = fakeFetch({ body: { choices: [] } });
  await assert.rejects(() => createModelPort(openaiCfg, o.fn, 'zh').complete({ prompt: 'P' }), /没有返回文本/);
});

// ---- 端口标识（用于 provenance）----

test('port.id 标明供应商与模型', async () => {
  const { fn } = fakeFetch({ body: {} });
  assert.equal(createModelPort(anthropicCfg, fn, 'zh').id, 'anthropic/claude-opus-4-8');
  assert.equal(createModelPort(openaiCfg, fn, 'zh').id, 'openai-compatible/deepseek-chat');
});

// ---- 配置持久化 ----

test('模型配置：保存 / 读取 round-trip', async () => {
  const kv = createInMemoryKV();
  await saveModelConfig(kv, openaiCfg);
  assert.deepEqual(await loadModelConfig(kv), openaiCfg);
});

test('模型配置：缺失或损坏时返回 null', async () => {
  const kv = createInMemoryKV();
  assert.equal(await loadModelConfig(kv), null);
  await kv.setItem('ai-model-config', '{not json');
  assert.equal(await loadModelConfig(kv), null);
  await kv.setItem('ai-model-config', JSON.stringify({ provider: 'unknown' }));
  assert.equal(await loadModelConfig(kv), null);
});

test('模型配置：从旧位置一次性搬迁到安全存储', async () => {
  const legacy = createInMemoryKV();
  const secure = createInMemoryKV();
  await saveModelConfig(legacy, openaiCfg);

  assert.deepEqual(await loadModelConfig(secure, legacy), openaiCfg); // 读到旧配置
  assert.deepEqual(await loadModelConfig(secure), openaiCfg); // 已写入安全存储
  assert.equal(await legacy.getItem('ai-model-config'), null); // 旧位置已清除

  // 安全存储已有配置时优先，不再看旧位置
  await legacy.setItem('ai-model-config', JSON.stringify({ ...openaiCfg, model: 'other' }));
  assert.deepEqual(await loadModelConfig(secure, legacy), openaiCfg);
});

test('model-config session serializes migration before user-edited save across screens', async () => {
  const secure = createInMemoryKV();
  const legacy = createInMemoryKV();
  await saveModelConfig(legacy, anthropicCfg);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((done) => { release = done; });
  const started = new Promise<void>((done) => { entered = done; });
  const slowLegacy = {
    ...legacy,
    async getItem(key: string) {
      entered();
      await waiting;
      return legacy.getItem(key);
    },
  };
  const session = createModelConfigSession(secure, slowLegacy);
  const firstLoad = session.load();
  await started;
  // User submits new settings before old migration completes, and navigates
  // away. The accepted save must still prevail over the migration.
  const newSettings = session.save(openaiCfg);
  release();
  assert.deepEqual(await firstLoad, anthropicCfg);
  await newSettings;
  assert.deepEqual(await loadModelConfig(secure), openaiCfg);
  assert.equal(await legacy.getItem('ai-model-config'), null);
});

test('model-config session continues a newer save after initial SecureStore read fails', async () => {
  const secure = createInMemoryKV();
  let fail = true;
  const flakySecure = {
    ...secure,
    async getItem(key: string) {
      if (fail) { fail = false; throw new Error('locked keychain'); }
      return secure.getItem(key);
    },
  };
  const session = createModelConfigSession(flakySecure);
  await assert.rejects(() => session.load(), /locked keychain/);
  await session.save(openaiCfg);
  assert.deepEqual(await session.load(), openaiCfg);
});
