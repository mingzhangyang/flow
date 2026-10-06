// Web / 非原生环境：没有系统本地通知响应，保持 noop。
// Metro 在 iOS/Android 会自动选择 notificationResponses.native.ts。

import { type NotificationRouteData } from './notificationRoute';

export function createExpoNotificationResponseSource() {
  return {
    async getInitialRoute(): Promise<NotificationRouteData | null> {
      return null;
    },
    subscribe(_listener: (route: NotificationRouteData) => void): () => void {
      return () => {};
    },
  };
}
