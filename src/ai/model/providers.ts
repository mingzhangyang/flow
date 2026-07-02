// 供应商注册表：ModelProviderConfig（可辨识联合）→ ModelPort。
// 新增一家供应商 = 新增一个 config 变体 + 一个适配器 + 这里的一个分支（扩展而非修改，C9/C10）。

import { createAnthropicPort, type AnthropicConfig } from './anthropic';
import { createOpenAICompatiblePort, type OpenAICompatibleConfig } from './openaiCompatible';
import type { FetchLike, ModelPort } from './port';

export type ModelProviderConfig = AnthropicConfig | OpenAICompatibleConfig;

export type ProviderKind = ModelProviderConfig['provider'];

export function createModelPort(config: ModelProviderConfig, fetchFn: FetchLike): ModelPort {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicPort(config, fetchFn);
    case 'openai-compatible':
      return createOpenAICompatiblePort(config, fetchFn);
    default: {
      const never: never = config;
      throw new Error(`未知的模型供应商：${JSON.stringify(never)}`);
    }
  }
}

/** OpenAI 兼容端点的常见预设（仅 baseUrl 提示；模型名以各家文档为准）。 */
export const OPENAI_COMPATIBLE_PRESETS: { label: string; baseUrl: string }[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Kimi（Moonshot）', baseUrl: 'https://api.moonshot.cn/v1' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1' },
];
