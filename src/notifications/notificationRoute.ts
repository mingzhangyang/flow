// 通知 route 携带 catalog definition identity。
// 旧通知没有 definitionKey 时，由 catalog 层只在来源无歧义时兼容。

export interface NotificationRouteData {
  kind: 'flow';
  flowId: string;
  definitionKey?: string;
  nodeId?: string;
}

export function flowNotificationRoute(
  flowId: string,
  nodeId?: string,
  definitionKey?: string,
): NotificationRouteData {
  return {
    kind: 'flow',
    flowId,
    ...(definitionKey ? { definitionKey } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

export function parseNotificationRoute(data: unknown): NotificationRouteData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (raw.kind !== 'flow' || typeof raw.flowId !== 'string' || raw.flowId.trim() === '') return null;

  const route: NotificationRouteData = { kind: 'flow', flowId: raw.flowId };
  if (typeof raw.definitionKey === 'string' && raw.definitionKey.trim() !== '') {
    route.definitionKey = raw.definitionKey;
  }
  if (typeof raw.nodeId === 'string' && raw.nodeId.trim() !== '') {
    route.nodeId = raw.nodeId;
  }
  return route;
}
