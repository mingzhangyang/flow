// SecretStore 默认实现（Web）：浏览器没有安全存储，只能回落 AsyncStorage（localStorage）。
// 原生端见 secureKv.native.ts（Metro 在 iOS/Android 自动优先选用 .native.ts，
// 那里才是真正的 Keychain / Keystore）。Web 上密钥仍只存本机，但保护有限——这是平台上限。

import { type SecretStore } from './kv';
import { asyncStorageKV } from './asyncStorageKv';

export const secureKV: SecretStore = asyncStorageKV;
