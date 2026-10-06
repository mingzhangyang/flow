// 通知响应的纯编排核心：Expo API 通过 facade 注入，便于契约测试。
// 冷启动与 warm tap 都必须在交付路由前消费 last response，防止后续普通启动重放旧点击。

import { parseNotificationRoute, type NotificationRouteData } from './notificationRoute';

export interface NotificationResponseLike {
  notification: {
    request: {
      content: {
        data?: unknown;
      };
    };
  };
}

export interface NotificationResponseSubscriptionLike {
  remove(): void;
}

export interface NotificationResponsesFacade {
  getLastNotificationResponseAsync(): Promise<NotificationResponseLike | null>;
  clearLastNotificationResponseAsync(): Promise<void>;
  addNotificationResponseReceivedListener(
    listener: (response: NotificationResponseLike) => void,
  ): NotificationResponseSubscriptionLike;
}

export interface NotificationResponseSource {
  getInitialRoute(): Promise<NotificationRouteData | null>;
  subscribe(listener: (route: NotificationRouteData) => void): () => void;
}

function routeOf(response: NotificationResponseLike | null): NotificationRouteData | null {
  return response ? parseNotificationRoute(response.notification.request.content.data) : null;
}

async function consumeLastResponse(api: NotificationResponsesFacade): Promise<boolean> {
  // clear 是 stale-response 保证的一部分，不是 best-effort 清理。
  // 先重试一次以吸收瞬态失败；连续失败时宁可不导航，也不能交付一个仍可能
  // 被 Expo 保留、并在下次普通启动再次重放的 response。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await api.clearLastNotificationResponseAsync();
      return true;
    } catch {
      // retry
    }
  }
  return false;
}

export function createNotificationResponseSource(
  api: NotificationResponsesFacade,
): NotificationResponseSource {
  return {
    async getInitialRoute() {
      const response = await api.getLastNotificationResponseAsync();
      if (!response) return null;
      const route = routeOf(response);
      const consumed = await consumeLastResponse(api);
      return consumed ? route : null;
    },

    subscribe(listener) {
      let active = true;
      const subscription = api.addNotificationResponseReceivedListener((response) => {
        void (async () => {
          const route = routeOf(response);
          // Expo retains the latest warm response too. Consume it before navigating so a
          // later ordinary launch cannot reopen this Flow.
          const consumed = await consumeLastResponse(api);
          if (active && consumed && route) listener(route);
        })();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    },
  };
}
