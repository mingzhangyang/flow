// 顺序型 Run 的 definition-scoped 持久化身份与恢复规则。
// 有事件的 Run 永远继续使用 run.flow 快照；空闲旧快照可安全换到当前定义。

import { type Flow, type Run } from '../domain/types';

export function activeRunId(definitionKey: string): string {
  return JSON.stringify(['run-v2', definitionKey]);
}

export function legacyActiveRunId(flowId: string): string {
  return `active-${flowId}`;
}

export function runForCurrentDefinition(
  saved: Run | null,
  currentFlow: Flow,
  nextRunId: string,
): Run {
  if (saved && saved.flow.id === currentFlow.id && saved.events.length > 0) {
    return { ...saved, id: nextRunId };
  }
  return { id: nextRunId, flow: currentFlow, events: [] };
}
