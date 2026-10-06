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
  // 保持前台提醒可见、可从系统通知进入，同时不额外改变 badge 或强制声音策略。
  shouldPlaySound: false,
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
