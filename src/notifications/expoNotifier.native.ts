// 原生 Notifier 适配器（iOS/Android），基于 expo-notifications。
// 注意：本地推送需在真机/模拟器上验证；headless 环境无法完整验证，此处仅保证类型与结构正确。

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { type Notifier } from './notifier';
import { type Reminder } from './plan';
import {
  FOREGROUND_REMINDER_BEHAVIOR,
  REMINDER_CHANNEL_ID,
  REMINDER_CHANNEL_NAME,
  reminderContent,
} from './nativePolicy';

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
      channelId: REMINDER_CHANNEL_ID,
      hour: r.repeat.hour,
      minute: r.repeat.minute,
    };
  }
  if (r.repeat?.kind === 'weekly') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      channelId: REMINDER_CHANNEL_ID,
      weekday: r.repeat.weekday + 1,
      hour: r.repeat.hour,
      minute: r.repeat.minute,
    };
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    channelId: REMINDER_CHANNEL_ID,
    date: new Date(r.at),
  };
}

export function createExpoNotifier(): Notifier {
  // Without a handler Expo intentionally suppresses notifications while the
  // app is foregrounded. All notifications in this app are user-enrolled
  // reminders, so foreground delivery follows the same visible/audible policy.
  Notifications.setNotificationHandler({
    handleNotification: async () => FOREGROUND_REMINDER_BEHAVIOR,
  });

  async function ensureChannel(): Promise<void> {
    if (Platform.OS !== 'android') return;
    // Android 13 does not show the notification permission prompt until a
    // channel exists. Channel importance/sound also controls Android 8+ audio.
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: REMINDER_CHANNEL_NAME,
      description: 'Timers and scheduled flow reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 250, 200, 250],
    });
  }

  async function ensurePermission(): Promise<boolean> {
    await ensureChannel();
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
          content: {
            ...reminderContent(r),
            priority: Notifications.AndroidNotificationPriority.HIGH,
          },
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
    async status() {
      await ensureChannel();
      const p = await Notifications.getPermissionsAsync();
      if (p.granted) return 'ready';
      // 还能再问 = 尚未真正拒绝（首次登记时会弹系统框）；不能再问 = 被拒，需去系统设置
      return p.canAskAgain ? 'undetermined' : 'denied';
    },
  };
}
