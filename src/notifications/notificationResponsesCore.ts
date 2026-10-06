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

async function consumeLastResponse(api: NotificationResponsesFacade): Promise<void> {
  await api.clearLastNotificationResponseAsync().catch(() => {});
}

export function createNotificationResponseSource(
  api: NotificationResponsesFacade,
): NotificationResponseSource {
  return {
    async getInitialRoute() {
      const response = await api.getLastNotificationResponseAsync();
      if (!response) return null;
      const route = routeOf(response);
      await consumeLastResponse(api);
      return route;
    },

    subscribe(listener) {
      let active = true;
      const subscription = api.addNotificationResponseReceivedListener((response) => {
        void (async () => {
          const route = routeOf(response);
          // Expo retains the latest warm response too. Consume it before navigating so a
          // later ordinary launch cannot reopen this Flow.
          await consumeLastResponse(api);
          if (active && route) listener(route);
        })();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    },
  };
}
