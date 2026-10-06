// 前台通知展示策略契约：确保 SDK 57 composition root 安装可见通知 handler。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configureNotificationPresentation,
  FOREGROUND_NOTIFICATION_BEHAVIOR,
  type NotificationPresentationHandler,
} from './notificationPresentationCore';

test('安装前台 handler，并保持 banner/list 可见而不修改 badge/声音策略', async () => {
  let installed: NotificationPresentationHandler | null = null;

  configureNotificationPresentation({
    setNotificationHandler(handler) {
      installed = handler;
    },
  });

  assert.ok(installed);
  assert.deepEqual(await installed.handleNotification(), FOREGROUND_NOTIFICATION_BEHAVIOR);
  assert.deepEqual(FOREGROUND_NOTIFICATION_BEHAVIOR, {
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  });
});
