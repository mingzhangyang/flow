// 通知 route 的正式 v1 identity。
// flowId 用于定位候选，definitionKey 必须 canonical 且必须指向同一个 flowId。

import { parseDefinitionKey } from '../domain/definitionIdentity';

export interface NotificationRouteData {
  kind: 'flow';
  flowId: string;
  definitionKey: string;
  nodeId?: string;
}

function routeIdentity(flowId: string, definitionKey: string) {
  const identity = parseDefinitionKey(definitionKey);
  if (flowId === '' || identity === null || identity.flowId !== flowId) {
    throw new Error('invalid notification route identity');
  }
  return identity;
}

export function flowNotificationRoute(
  flowId: string,
  definitionKey: string,
  nodeId?: string,
): NotificationRouteData {
  routeIdentity(flowId, definitionKey);
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

  const identity = parseDefinitionKey(raw.definitionKey);
  if (identity === null || identity.flowId !== raw.flowId) return null;

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
