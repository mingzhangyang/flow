// 通知响应的纯编排核心：Expo API 通过 facade 注入，便于契约测试。
// 启动时会先订阅 listener，再读取 last response；本模块负责缓冲、串行和启动窗口去重，
// 避免同一 cold-start tap 被 initial + listener 双路径交付两次，或不同 tap 乱序。

import { parseNotificationRoute, type NotificationRouteData } from './notificationRoute';

export interface NotificationResponseLike {
  notification: {
    request: {
      identifier: string;
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
  /**
   * 原子地启动 cold/warm response 消费。
   * listener 会在 initial response 处理完后才收到启动窗口内缓冲的 warm response。
   */
  start(listener: (route: NotificationRouteData) => void | Promise<void>): () => void;
}

function routeOf(response: NotificationResponseLike): NotificationRouteData | null {
  return parseNotificationRoute(response.notification.request.content.data);
}

function responseId(response: NotificationResponseLike): string {
  return response.notification.request.identifier;
}

async function consumeLastResponse(api: NotificationResponsesFacade): Promise<boolean> {
  // clear 是 stale-response 保证的一部分，不是 best-effort 清理。
  // 先重试一次以吸收瞬态失败；连续失败时宁可不导航。
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
    start(listener) {
      let active = true;
      let startupComplete = false;
      const startupBuffer: NotificationResponseLike[] = [];
      let serial: Promise<void> = Promise.resolve();

      const processResponse = async (response: NotificationResponseLike): Promise<boolean> => {
        if (!active) return false;
        const route = routeOf(response);
        const consumed = await consumeLastResponse(api);
        if (!consumed) return false;
        if (active && route) {
          try {
            await listener(route);
          } catch {
            // The system response is already consumed. A navigation/business failure belongs
            // to this one delivery only; never poison the serialization tail or redeliver it.
          }
        }
        return true;
      };

      const enqueue = (response: NotificationResponseLike): Promise<boolean> => {
        let result = false;
        serial = serial.then(async () => {
          result = await processResponse(response);
        });
        return serial.then(() => result);
      };

      // 先订阅，避免读取 initial 的窗口里漏 tap；在 initial 完成前事件只缓冲不交付。
      const subscription = api.addNotificationResponseReceivedListener((response) => {
        if (!active) return;
        if (!startupComplete) {
          startupBuffer.push(response);
          return;
        }
        void enqueue(response);
      });

      void (async () => {
        let initial: NotificationResponseLike | null = null;
        try {
          initial = await api.getLastNotificationResponseAsync();
        } catch {
          // initial read 失败不能阻塞之后的 warm taps。
        }
        if (!active) return;

        // 去重只限定在启动窗口。重复系统提醒可能长期复用同一个 request identifier，
        // 因此不能把 identifier 永久加入 session 级 seen set。
        const consumedStartupIds = new Set<string>();
        if (initial) {
          const consumed = await enqueue(initial);
          if (consumed) consumedStartupIds.add(responseId(initial));
        }

        while (active && startupBuffer.length > 0) {
          const buffered = startupBuffer.shift() as NotificationResponseLike;
          const id = responseId(buffered);
          if (consumedStartupIds.has(id)) continue;
          const consumed = await enqueue(buffered);
          if (consumed) consumedStartupIds.add(id);
        }

        startupComplete = true;
      })();

      return () => {
        active = false;
        startupBuffer.length = 0;
        subscription.remove();
      };
    },
  };
}
