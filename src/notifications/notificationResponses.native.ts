// iOS / Android 通知点击适配器。
// 同时覆盖运行中点击与“App 已被系统杀掉后点击通知”的冷启动路径。

import * as Notifications from 'expo-notifications';
import { parseNotificationRoute, type NotificationRouteData } from './notificationRoute';

function routeOf(response: Notifications.NotificationResponse | null): NotificationRouteData | null {
  return response ? parseNotificationRoute(response.notification.request.content.data) : null;
}

export function createExpoNotificationResponseSource() {
  return {
    async getInitialRoute(): Promise<NotificationRouteData | null> {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (!response) return null;
      const route = routeOf(response);
      // 已消费的响应必须清掉，否则下一次普通启动仍会被旧点击重新路由。
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
      return route;
    },

    subscribe(listener: (route: NotificationRouteData) => void): () => void {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const route = routeOf(response);
        if (route) listener(route);
      });
      return () => subscription.remove();
    },
  };
}
