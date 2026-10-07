// 通知 route 携带 catalog definition identity。
// flowId 用于定位候选，definitionKey 用于验证具体定义，避免 same-id source 串线。

export interface NotificationRouteData {
  kind: 'flow';
  flowId: string;
  definitionKey?: string;
  nodeId?: string;
}

export function flowNotificationRoute(
  flowId: string,
  definitionKey: string,
  nodeId?: string,
): NotificationRouteData {
  return {
    kind: 'flow',
    flowId,
    definitionKey,
    ...(nodeId ? { nodeId } : {}),
  };
}

export function parseNotificationRoute(data: unknown): NotificationRouteData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (raw.kind !== 'flow' || typeof raw.flowId !== 'string' || raw.flowId === '') return null;

  const route: NotificationRouteData = { kind: 'flow', flowId: raw.flowId };
  if (typeof raw.definitionKey === 'string' && raw.definitionKey !== '') {
    route.definitionKey = raw.definitionKey;
  }
  if (typeof raw.nodeId === 'string' && raw.nodeId !== '') {
    route.nodeId = raw.nodeId;
  }
  return route;
}
