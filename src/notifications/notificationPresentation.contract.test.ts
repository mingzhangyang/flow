// 前台通知展示策略契约：确保 SDK 57 composition root 安装可见通知 handler。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configureNotificationPresentation,
  FOREGROUND_NOTIFICATION_BEHAVIOR,
  type NotificationPresentationHandler,
} from './notificationPresentationCore';

test('安装前台 handler，并保持 banner/list 可见且允许提醒声音', async () => {
  const installed: NotificationPresentationHandler[] = [];

  configureNotificationPresentation({
    setNotificationHandler(handler) {
      installed.push(handler);
    },
  });

  assert.equal(installed.length, 1);
  const handler = installed[0];
  assert.ok(handler);
  assert.deepEqual(await handler.handleNotification(), FOREGROUND_NOTIFICATION_BEHAVIOR);
  assert.deepEqual(FOREGROUND_NOTIFICATION_BEHAVIOR, {
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  });
});
