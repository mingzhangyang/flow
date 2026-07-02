// OpenAI 兼容适配器：一个适配器覆盖所有讲 /chat/completions 方言的服务——
// OpenAI、DeepSeek、Kimi（Moonshot）、通义千问、智谱、本地 Ollama、Gemini 兼容端点等。
// 只做协议翻译，不含业务逻辑。

import { type Locale } from '../../i18n/locale';
import {
  describeHttpError,
  MODEL_ERRORS,
  type FetchLike,
  type ModelPort,
  type ModelRequest,
  type ModelResponse,
} from './port';

export interface OpenAICompatibleConfig {
  provider: 'openai-compatible';
  apiKey: string;
  model: string;
  /** 形如 "https://api.deepseek.com/v1"，任何 OpenAI 兼容端点。 */
  baseUrl: string;
}

interface ChatCompletionsResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
}

export function createOpenAICompatiblePort(
  config: OpenAICompatibleConfig,
  fetchFn: FetchLike,
  locale: Locale,
): ModelPort {
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  return {
    id: `openai-compatible/${config.model}`,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const messages: { role: string; content: string }[] = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      messages.push({ role: 'user', content: req.prompt });

      const res = await fetchFn(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 本地服务（如 Ollama）会忽略此头；留空 key 也发送以保持形状一致。
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          messages,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        const provider = { zh: '模型服务', 'zh-Hant': '模型服務', en: 'Model service' }[locale];
        throw new Error(describeHttpError(provider, res.status, raw, locale));
      }

      const data = JSON.parse(raw) as ChatCompletionsResponse;
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error(MODEL_ERRORS[locale].empty);
      return { text, model: data.model ?? config.model };
    },
  };
}
