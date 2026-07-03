// 原生 Notifier 适配器（iOS/Android），基于 expo-notifications。
// 注意：本地推送需在真机/模拟器上验证；headless 环境无法完整验证，此处仅保证类型与结构正确。

import * as Notifications from 'expo-notifications';
import { type Notifier } from './notifier';
import { type Reminder } from './plan';

/**
 * Reminder → 平台触发器。
 * - repeat: daily/weekly → 系统级重复触发器（iOS 为 repeats 的 UNCalendarNotificationTrigger，
 *   Android 由 expo-notifications 在每次触发后自续）——排入一次，长期有效。
 * - 无 repeat → 一次性 DATE 触发。
 * 注意 expo 的 weekday 取值为 1=周日 … 7=周六；本仓库沿用 JS getDay（0=周日），此处 +1 换算。
 */
function triggerFor(r: Reminder): Notifications.SchedulableNotificationTriggerInput {
  if (r.repeat?.kind === 'daily') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: r.repeat.hour,
      minute: r.repeat.minute,
    };
  }
  if (r.repeat?.kind === 'weekly') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: r.repeat.weekday + 1,
      hour: r.repeat.hour,
      minute: r.repeat.minute,
    };
  }
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at) };
}

export function createExpoNotifier(): Notifier {
  async function ensurePermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }

  return {
    async schedule(reminders) {
      if (reminders.length === 0) return;
      if (!(await ensurePermission())) return;
      for (const r of reminders) {
        await Notifications.scheduleNotificationAsync({
          identifier: r.id,
          content: { title: r.title, body: r.body },
          trigger: triggerFor(r),
        });
      }
    },
    async cancel(ids) {
      for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
    },
    async cancelAll() {
      await Notifications.cancelAllScheduledNotificationsAsync();
    },
  };
}
