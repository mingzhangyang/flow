// KVStore 端口：最小键值存储抽象。Storage 建立其上，从而与具体后端
// （AsyncStorage / localStorage / 内存）解耦——这也是 C10「模块可单独重建」的落点。

export interface KVStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * 机密专用的窄端口：只有单键读写，没有枚举。
 * 平台安全存储（如 iOS Keychain / Android Keystore）不提供 keys()，
 * 所以机密走这个更小的接口；任何 KVStore 结构上都满足它（测试用内存 KV 即可）。
 */
export type SecretStore = Pick<KVStore, 'getItem' | 'setItem' | 'removeItem'>;

/** 内存实现，供测试与默认回退使用。 */
export function createInMemoryKV(): KVStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}
