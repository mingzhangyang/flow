// 平台通知 identifier 必须对开放 Flow/Node ID 保持注入性。
// 不使用 ":" 等分隔符拼接；统一以 versioned tuple JSON 编码。

const VERSION = 'notif-v2';

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
