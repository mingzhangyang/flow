// Web 没有系统本地通知展示策略；保持显式 noop。
// Metro 在 iOS/Android 会自动选择 notificationPresentation.native.ts。

export function configureExpoNotificationPresentation(): void {
  // noop
}
