// Notifier 端口：把 Reminder 下发到平台的本地通知。
// 纯接口 + noop 实现，不依赖任何平台 API。真正的适配器见 expoNotifier.*。

import { type Reminder } from './plan';

export interface Notifier {
  /** 按 id 排入提醒（同 id 视为替换）。 */
  schedule(reminders: Reminder[]): Promise<void>;
  cancel(ids: string[]): Promise<void>;
  cancelAll(): Promise<void>;
}

export const noopNotifier: Notifier = {
  async schedule() {},
  async cancel() {},
  async cancelAll() {},
};
