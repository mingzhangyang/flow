// iOS / Android 前台通知展示适配器。
// Expo SDK 57 默认会抑制前台通知；这里显式安装展示策略。

import * as Notifications from 'expo-notifications';
import {
  configureNotificationPresentation,
  type NotificationPresentationFacade,
} from './notificationPresentationCore';

const expoPresentationFacade: NotificationPresentationFacade = {
  setNotificationHandler(handler) {
    Notifications.setNotificationHandler({
      handleNotification: handler.handleNotification,
    });
  },
};

export function configureExpoNotificationPresentation(): void {
  configureNotificationPresentation(expoPresentationFacade);
}
