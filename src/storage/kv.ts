// KVStore 端口：最小键值存储抽象。Storage 建立其上，从而与具体后端
// （AsyncStorage / localStorage / 内存）解耦——这也是 C10「模块可单独重建」的落点。

export interface KVStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

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
