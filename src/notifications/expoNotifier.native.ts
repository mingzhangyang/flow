// 原生 Notifier 适配器（iOS/Android），基于 expo-notifications。
// 注意：本地推送需在真机/模拟器上验证；headless 环境无法完整验证，此处仅保证类型与结构正确。

import * as Notifications from 'expo-notifications';
import { type Notifier } from './notifier';

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
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(r.at),
          },
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
