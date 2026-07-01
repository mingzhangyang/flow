// KVStore 适配器：AsyncStorage 后端（应用侧）。
// 在原生上用设备存储，在 Web 上 AsyncStorage 自动回退到 localStorage——因此离线持久化两端可用。
// 仅由应用引用；不进入 node 端的类型检查/测试（见 tsconfig.src.json exclude）。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { type KVStore } from './kv';

export const asyncStorageKV: KVStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  keys: async () => {
    const keys = await AsyncStorage.getAllKeys();
    return [...keys];
  },
};
