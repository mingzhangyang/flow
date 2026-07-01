// 默认实现（Web 及类型检查用）：noop。
// 原生实现见 expoNotifier.native.ts——Metro 会在 iOS/Android 上自动优先选用 .native.ts，
// 因此 Web 包永远不会引入 expo-notifications。

import { type Notifier, noopNotifier } from './notifier';

export function createExpoNotifier(): Notifier {
  return noopNotifier;
}
