// 模型配置的本地持久化（C6 本地优先——密钥只存在用户设备）。
// 配置含 API Key，属机密：走窄的 SecretStore 端口（原生端为 Keychain/Keystore 适配器），
// 不与普通应用数据混在一个后端。早期版本存在 AsyncStorage 里，读取时做一次性搬迁。

import type { SecretStore } from '../../storage/kv';
import type { ModelProviderConfig } from './providers';

const KEY = 'ai-model-config';

export interface ModelConfigSession {
  load(): Promise<ModelProviderConfig | null>;
  save(config: ModelProviderConfig): Promise<void>;
}

/**
 * Application-owned queue: initial SecureStore read/legacy migration must finish
 * before any newly entered settings can be persisted. Closing an individual
 * Generate screen cannot cancel an accepted migration or reorder its successor.
 */
export function createModelConfigSession(
  store: SecretStore, legacy?: SecretStore,
): ModelConfigSession {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(() => {}, () => {});
    return result;
  };
  return {
    load: () => enqueue(() => loadModelConfig(store, legacy)),
    save: (config) => enqueue(() => saveModelConfig(store, config)),
  };
}

export async function saveModelConfig(store: SecretStore, config: ModelProviderConfig): Promise<void> {
  await store.setItem(KEY, JSON.stringify(config));
}

async function readConfig(store: SecretStore): Promise<ModelProviderConfig | null> {
  const text = await store.getItem(KEY);
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

/**
 * 读取已保存的配置；缺失或形状不认识时返回 null（由 UI 引导用户填写）。
 * @param legacy 旧位置（明文 AsyncStorage）。若安全存储里没有而旧位置有，
 *   先写入安全存储、再删除旧数据（顺序保证搬迁失败时旧数据仍在）。
 */
export async function loadModelConfig(
  store: SecretStore,
  legacy?: SecretStore,
): Promise<ModelProviderConfig | null> {
  const current = await readConfig(store);
  if (current) return current;
  if (!legacy) return null;

  const old = await readConfig(legacy);
  if (!old) return null;
  await saveModelConfig(store, old);
  await legacy.removeItem(KEY);
  return old;
}
