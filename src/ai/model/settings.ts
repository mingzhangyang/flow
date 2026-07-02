// 模型配置的本地持久化：建立在 KVStore 端口之上（C6 本地优先——密钥只存在用户设备）。

import type { KVStore } from '../../storage/kv';
import type { ModelProviderConfig } from './providers';

const KEY = 'ai-model-config';

export async function saveModelConfig(kv: KVStore, config: ModelProviderConfig): Promise<void> {
  await kv.setItem(KEY, JSON.stringify(config));
}

/** 读取已保存的配置；缺失或形状不认识时返回 null（由 UI 引导用户填写）。 */
export async function loadModelConfig(kv: KVStore): Promise<ModelProviderConfig | null> {
  const text = await kv.getItem(KEY);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ModelProviderConfig>;
    if (parsed.provider === 'anthropic' || parsed.provider === 'openai-compatible') {
      return parsed as ModelProviderConfig;
    }
    return null;
  } catch {
    return null;
  }
}
