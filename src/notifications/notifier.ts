// Notifier 端口：把 Reminder 下发到平台的本地通知。
// 纯接口 + noop 实现，不依赖任何平台 API。真正的适配器见 expoNotifier.*。

import { type Reminder } from './plan';

/**
 * 提醒在当前环境的可用状态。UI 据此对用户诚实（E6）：
 * - ready：已授权，到点会响。
 * - undetermined：尚未询问（首次登记提醒时会弹系统权限框）。
 * - denied：被拒绝——排入也不会响，必须显式告知并引导去系统设置。
 * - unsupported：平台没有定时本地通知能力（如网页版）。
 */
export type ReminderAvailability = 'ready' | 'undetermined' | 'denied' | 'unsupported';

/**
 * schedule 的结果——端口必须如实说明提醒是否真的排上（E6），不能「静默成功」：
 * - scheduled：已全部排入（空列表也算）。
 * - denied：没有通知权限，什么也没排。
 * - unsupported：平台没有定时本地通知能力（如网页版），什么也没排。
 * 平台调用本身出错则 reject。
 */
export type ReminderDelivery = 'scheduled' | 'denied' | 'unsupported';

export interface Notifier {
  /** 按 id 排入提醒（同 id 视为替换），并如实返回是否排上。 */
  schedule(reminders: Reminder[]): Promise<ReminderDelivery>;
  cancel(ids: string[]): Promise<void>;
  cancelAll(): Promise<void>;
  /** 当前环境能否真正送达提醒（权限/平台能力）。 */
  status(): Promise<ReminderAvailability>;
}

export const noopNotifier: Notifier = {
  async schedule() {
    return 'unsupported';
  },
  async cancel() {},
  async cancelAll() {},
  async status() {
    return 'unsupported';
  },
};
