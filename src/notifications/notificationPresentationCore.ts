// 前台通知展示策略的纯编排核心。
// SDK 57 前台默认不展示通知，因此 composition root 必须显式安装 handler。

export interface ForegroundNotificationBehavior {
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
  shouldShowBanner: boolean;
  shouldShowList: boolean;
}

export interface NotificationPresentationHandler {
  handleNotification(): Promise<ForegroundNotificationBehavior>;
}

export interface NotificationPresentationFacade {
  setNotificationHandler(handler: NotificationPresentationHandler): void;
}

export const FOREGROUND_NOTIFICATION_BEHAVIOR: ForegroundNotificationBehavior = {
  // Android 上 shouldPlaySound=false 会抑制前台 heads-up/drop-down；提醒型应用需要可见、可点击。
  shouldPlaySound: true,
  shouldSetBadge: false,
  shouldShowBanner: true,
  shouldShowList: true,
};

export function configureNotificationPresentation(api: NotificationPresentationFacade): void {
  api.setNotificationHandler({
    async handleNotification() {
      return FOREGROUND_NOTIFICATION_BEHAVIOR;
    },
  });
}
