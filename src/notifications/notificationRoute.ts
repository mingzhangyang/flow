// 系统通知只携带稳定的路由标识；Flow 定义仍以本地库为唯一事实源（C6/E5）。
// 这里保持纯函数，原生通知适配器与 App 导航都只依赖这个小契约。

export interface NotificationRouteData {
  kind: 'flow';
  flowId: string;
  nodeId?: string;
}

export function flowNotificationRoute(flowId: string, nodeId?: string): NotificationRouteData {
  return nodeId ? { kind: 'flow', flowId, nodeId } : { kind: 'flow', flowId };
}

export function parseNotificationRoute(data: unknown): NotificationRouteData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (raw.kind !== 'flow' || typeof raw.flowId !== 'string' || raw.flowId.trim() === '') return null;

  const flowId = raw.flowId.trim();
  if (typeof raw.nodeId === 'string' && raw.nodeId.trim() !== '') {
    return { kind: 'flow', flowId, nodeId: raw.nodeId.trim() };
  }
  return { kind: 'flow', flowId };
}
