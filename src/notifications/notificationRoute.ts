// 通知 route 的正式 v1 identity。
// flowId 用于定位候选，definitionKey 必须 canonical 且必须指向同一个 flowId。

import {
  assertDefinitionKeyForFlow,
  parseDefinitionKeyForFlow,
} from '../domain/definitionIdentity';

export interface NotificationRouteData {
  kind: 'flow';
  flowId: string;
  definitionKey: string;
  nodeId?: string;
}

export function flowNotificationRoute(
  flowId: string,
  definitionKey: string,
  nodeId?: string,
): NotificationRouteData {
  assertDefinitionKeyForFlow(definitionKey, flowId);
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
  if (
    raw.kind !== 'flow' ||
    typeof raw.flowId !== 'string' ||
    raw.flowId === '' ||
    typeof raw.definitionKey !== 'string'
  ) {
    return null;
  }

  if (parseDefinitionKeyForFlow(raw.definitionKey, raw.flowId) === null) return null;

  const route: NotificationRouteData = {
    kind: 'flow',
    flowId: raw.flowId,
    definitionKey: raw.definitionKey,
  };
  if (typeof raw.nodeId === 'string' && raw.nodeId !== '') {
    route.nodeId = raw.nodeId;
  }
  return route;
}
