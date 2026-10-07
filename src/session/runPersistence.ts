// 顺序型 Run 的 definition-scoped 持久化身份与恢复规则。
// 有事件的 Run 永远继续使用 run.flow 快照；legacy → v2 迁移必须先持久化 v2 seed，
// 调用方才可开放用户操作，避免迁移写与新事件写竞速覆盖。

import { type Flow, type Run } from '../domain/types';

export interface RunPersistencePort {
  loadRun(id: string): Promise<Run | null>;
  saveRun(run: Run): Promise<void>;
}

export interface LoadedDefinitionRun {
  run: Run;
  /** v2 已成为事实源后，可以幂等清理这个 legacy run/reminder identity。 */
  cleanupLegacyRunId?: string;
}

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

export async function loadRunForDefinition(
  port: RunPersistencePort,
  currentFlow: Flow,
  definitionKey: string,
  legacyFlowId?: string,
): Promise<LoadedDefinitionRun> {
  const runId = activeRunId(definitionKey);
  const cleanupLegacyRunId = legacyFlowId ? legacyActiveRunId(legacyFlowId) : undefined;

  const current = await port.loadRun(runId);
  if (current) {
    return {
      run: runForCurrentDefinition(current, currentFlow, runId),
      ...(cleanupLegacyRunId ? { cleanupLegacyRunId } : {}),
    };
  }

  let legacy: Run | null = null;
  if (cleanupLegacyRunId) legacy = await port.loadRun(cleanupLegacyRunId);
  const next = runForCurrentDefinition(legacy, currentFlow, runId);

  if (legacy) {
    // Migration seed must be durable before the UI can mutate this Run.
    await port.saveRun(next);
  }

  return {
    run: next,
    ...(cleanupLegacyRunId ? { cleanupLegacyRunId } : {}),
  };
}
