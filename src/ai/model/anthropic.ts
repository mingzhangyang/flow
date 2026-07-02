// Anthropic（Claude）适配器：ModelRequest → Messages API → 文本。
// 只做协议翻译，不含业务逻辑；密钥保存在用户本机（C6 本地优先），请求由客户端直连。

import {
  describeHttpError,
  type FetchLike,
  type ModelPort,
  type ModelRequest,
  type ModelResponse,
} from './port';

export interface AnthropicConfig {
  provider: 'anthropic';
  apiKey: string;
  /** 如 "claude-opus-4-8"。 */
  model: string;
  /** 缺省为官方端点；可指向自建代理。 */
  baseUrl?: string;
}

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-4-8';

interface MessagesResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
}

export function createAnthropicPort(config: AnthropicConfig, fetchFn: FetchLike): ModelPort {
  const base = (config.baseUrl?.trim() || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    id: `anthropic/${config.model}`,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const res = await fetchFn(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          // 允许浏览器（Expo Web）直连；原生端忽略此头。
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: req.maxTokens ?? 4096,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: 'user', content: req.prompt }],
        }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(describeHttpError('Anthropic', res.status, raw));

      const data = JSON.parse(raw) as MessagesResponse;
      if (data.stop_reason === 'refusal') {
        throw new Error('模型拒绝了这次请求（refusal），请调整描述后重试');
      }
      const text = (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (!text) throw new Error('模型没有返回文本内容');
      return { text, model: data.model ?? config.model };
    },
  };
}
