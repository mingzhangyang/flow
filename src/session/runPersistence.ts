// 顺序型 Run 的正式 v1 持久化身份。
// Run 一旦有事件就继续使用 run.flow 定义快照；尚未开始的 Run 可采用当前定义。

import {
  assertDefinitionKey,
  assertDefinitionKeyForFlow,
} from '../domain/definitionIdentity';
import { type Flow, type Run } from '../domain/types';

export interface RunPersistencePort {
  loadRun(id: string): Promise<Run | null>;
}

export function activeRunId(definitionKey: string): string {
  assertDefinitionKey(definitionKey);
  return JSON.stringify(['run-v1', definitionKey]);
}

export function runForCurrentDefinition(
  saved: Run | null,
  currentFlow: Flow,
  runId: string,
): Run {
  if (saved !== null) {
    if (saved.id !== runId) {
      throw new Error('persisted Run id does not match requested identity');
    }
    if (saved.flow.id !== currentFlow.id) {
      throw new Error('persisted Run flow does not match current definition');
    }
    if (saved.events.length > 0) return saved;
  }
  return { id: runId, flow: currentFlow, events: [] };
}

export async function loadRunForDefinition(
  port: RunPersistencePort,
  currentFlow: Flow,
  definitionKey: string,
): Promise<Run> {
  assertDefinitionKeyForFlow(definitionKey, currentFlow.id);
  const runId = activeRunId(definitionKey);
  const saved = await port.loadRun(runId);
  return runForCurrentDefinition(saved, currentFlow, runId);
}
