// 平台通知 identifier 必须对开放 Flow/Node ID 保持注入性。
// 不使用 ":" 等分隔符拼接；统一以 versioned tuple JSON 编码。

const VERSION = 'notif-v1';

function encode(parts: readonly (string | number)[]): string {
  return JSON.stringify([VERSION, ...parts]);
}

export function sequentialReminderId(runId: string): string {
  return encode(['sequential', runId]);
}

export function scheduledOccurrenceReminderId(
  flowId: string,
  nodeId: string,
  at: number,
): string {
  return encode(['scheduled', flowId, nodeId, at]);
}

export function dailyReminderId(flowId: string, nodeId: string): string {
  return encode(['daily', flowId, nodeId]);
}

export function weeklyReminderId(
  flowId: string,
  nodeId: string,
  weekday: number,
): string {
  return encode(['weekly', flowId, nodeId, weekday]);
}


export type NotificationIdentity =
  | { kind: 'sequential'; runId: string }
  | { kind: 'scheduled'; flowId: string; nodeId: string; at: number }
  | { kind: 'daily'; flowId: string; nodeId: string }
  | { kind: 'weekly'; flowId: string; nodeId: string; weekday: number };

export function parseNotificationIdentity(value: string): NotificationIdentity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw[0] !== VERSION || typeof raw[1] !== 'string') return null;

  if (raw[1] === 'sequential' && raw.length === 3 && typeof raw[2] === 'string') {
    const identity: NotificationIdentity = { kind: 'sequential', runId: raw[2] };
    return sequentialReminderId(identity.runId) === value ? identity : null;
  }
  if (
    raw[1] === 'scheduled' &&
    raw.length === 5 &&
    typeof raw[2] === 'string' &&
    typeof raw[3] === 'string' &&
    typeof raw[4] === 'number' &&
    Number.isFinite(raw[4])
  ) {
    const identity: NotificationIdentity = { kind: 'scheduled', flowId: raw[2], nodeId: raw[3], at: raw[4] };
    return scheduledOccurrenceReminderId(identity.flowId, identity.nodeId, identity.at) === value ? identity : null;
  }
  if (raw[1] === 'daily' && raw.length === 4 && typeof raw[2] === 'string' && typeof raw[3] === 'string') {
    const identity: NotificationIdentity = { kind: 'daily', flowId: raw[2], nodeId: raw[3] };
    return dailyReminderId(identity.flowId, identity.nodeId) === value ? identity : null;
  }
  if (
    raw[1] === 'weekly' &&
    raw.length === 5 &&
    typeof raw[2] === 'string' &&
    typeof raw[3] === 'string' &&
    Number.isInteger(raw[4]) &&
    raw[4] >= 0 &&
    raw[4] <= 6
  ) {
    const identity: NotificationIdentity = { kind: 'weekly', flowId: raw[2], nodeId: raw[3], weekday: raw[4] };
    return weeklyReminderId(identity.flowId, identity.nodeId, identity.weekday) === value ? identity : null;
  }
  return null;
}

export function isScheduledReminderId(value: string): boolean {
  const identity = parseNotificationIdentity(value);
  return identity !== null && identity.kind !== 'sequential';
}
