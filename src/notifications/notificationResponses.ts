// Web / 非原生环境：没有系统本地通知响应，保持 noop。
// Metro 在 iOS/Android 会自动选择 notificationResponses.native.ts。

import { type NotificationResponseSource } from './notificationResponsesCore';

export function createExpoNotificationResponseSource(): NotificationResponseSource {
  return {
    async getInitialRoute() {
      return null;
    },
    subscribe() {
      return () => {};
    },
  };
}
