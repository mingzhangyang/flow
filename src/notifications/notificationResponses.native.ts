// iOS / Android 通知点击适配器。
// Expo API 只存在于这一层；消费/路由语义在纯核心中统一并由契约测试覆盖。

import * as Notifications from 'expo-notifications';
import {
  createNotificationResponseSource,
  type NotificationResponseSource,
  type NotificationResponsesFacade,
} from './notificationResponsesCore';

const expoNotificationsFacade: NotificationResponsesFacade = {
  async getLastNotificationResponseAsync() {
    return Notifications.getLastNotificationResponseAsync();
  },
  async clearLastNotificationResponseAsync() {
    await Notifications.clearLastNotificationResponseAsync();
  },
  addNotificationResponseReceivedListener(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => listener(response));
    return { remove: () => subscription.remove() };
  },
};

export function createExpoNotificationResponseSource(): NotificationResponseSource {
  return createNotificationResponseSource(expoNotificationsFacade);
}
