// 平台通知 identifier 的正式 v1 codec。
// definition-scoped reminder 必须携带 canonical definitionKey；顺序型 cleanup 也只通过本模块取得 ID。

import { assertDefinitionKey, parseDefinitionKey } from '../domain/definitionIdentity';

const VERSION = 'notif-v1';

function encode(parts: readonly (string | number)[]): string {
  return JSON.stringify([VERSION, ...parts]);
}

export function sequentialReminderId(runId: string): string {
  return encode(['sequential', runId]);
}

/** 一个 sequential Run 在正式 v1 中唯一允许的 platform notification identifier 集合。 */
export function sequentialReminderIdsForRun(runId: string): string[] {
  return [sequentialReminderId(runId)];
}

export function scheduledOccurrenceReminderId(
  definitionKey: string,
  nodeId: string,
  at: number,
): string {
  assertDefinitionKey(definitionKey);
  if (!Number.isFinite(at)) throw new Error('invalid scheduled reminder instant');
  return encode(['scheduled', definitionKey, nodeId, at]);
}

export function dailyReminderId(definitionKey: string, nodeId: string): string {
  assertDefinitionKey(definitionKey);
  return encode(['daily', definitionKey, nodeId]);
}

export function weeklyReminderId(
  definitionKey: string,
  nodeId: string,
  weekday: number,
): string {
  assertDefinitionKey(definitionKey);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error('invalid weekly reminder weekday');
  }
  return encode(['weekly', definitionKey, nodeId, weekday]);
}

export type NotificationIdentity =
  | { kind: 'sequential'; runId: string }
  | { kind: 'scheduled'; definitionKey: string; nodeId: string; at: number }
  | { kind: 'daily'; definitionKey: string; nodeId: string }
  | { kind: 'weekly'; definitionKey: string; nodeId: string; weekday: number };

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
    parseDefinitionKey(raw[2]) !== null &&
    typeof raw[3] === 'string' &&
    typeof raw[4] === 'number' &&
    Number.isFinite(raw[4])
  ) {
    const identity: NotificationIdentity = {
      kind: 'scheduled',
      definitionKey: raw[2],
      nodeId: raw[3],
      at: raw[4],
    };
    return scheduledOccurrenceReminderId(identity.definitionKey, identity.nodeId, identity.at) === value
      ? identity
      : null;
  }

  if (
    raw[1] === 'daily' &&
    raw.length === 4 &&
    typeof raw[2] === 'string' &&
    parseDefinitionKey(raw[2]) !== null &&
    typeof raw[3] === 'string'
  ) {
    const identity: NotificationIdentity = { kind: 'daily', definitionKey: raw[2], nodeId: raw[3] };
    return dailyReminderId(identity.definitionKey, identity.nodeId) === value ? identity : null;
  }

  if (
    raw[1] === 'weekly' &&
    raw.length === 5 &&
    typeof raw[2] === 'string' &&
    parseDefinitionKey(raw[2]) !== null &&
    typeof raw[3] === 'string' &&
    Number.isInteger(raw[4]) &&
    raw[4] >= 0 &&
    raw[4] <= 6
  ) {
    const identity: NotificationIdentity = {
      kind: 'weekly',
      definitionKey: raw[2],
      nodeId: raw[3],
      weekday: raw[4],
    };
    return weeklyReminderId(identity.definitionKey, identity.nodeId, identity.weekday) === value
      ? identity
      : null;
  }

  return null;
}

export function isScheduledReminderId(value: string): boolean {
  const identity = parseNotificationIdentity(value);
  return identity !== null && identity.kind !== 'sequential';
}
