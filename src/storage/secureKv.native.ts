// SecretStore 适配器（iOS/Android）：expo-secure-store —— 密钥进系统安全存储
// （iOS Keychain / Android Keystore），不落明文磁盘（C6：密钥只存本机，且存得安全）。
// 仅由应用引用；不进入 node 端的类型检查/测试（见 tsconfig.src.json exclude）。

import * as SecureStore from 'expo-secure-store';
import { type SecretStore as SecretStorePort } from './kv';

export const secureKV: SecretStorePort = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
