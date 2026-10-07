// 用户 Flow 删除的 durable commit-forward journal。
// 这是正式 v1 的崩溃恢复机制，不是旧数据迁移：journal 只保存 flowId，definitionKey
// 始终由 owned catalog identity 唯一推导；任一步失败都保留 journal，下次 refresh 幂等重试。

import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';
import { sequentialReminderId } from '../notifications/notificationIdentity';
import { catalogDefinitionKey } from './flowCatalog';
import { activeRunId } from './runPersistence';

const DELETE_INTENT_PREFIX = 'txn:delete-owned-flow:v1:';

interface DeleteOwnedFlowIntent {
  v: 1;
  flowId: string;
}

export interface DeleteOwnedFlowDeps {
  kv: KVStore;
  removeFlow(id: string): Promise<void>;
  unenroll(definitionKey: string): Promise<void>;
  cancelNotifications(ids: string[]): Promise<void>;
  deleteRun(id: string): Promise<void>;
  deleteCheckIns(definitionKey: string): Promise<void>;
  deleteRevisions(flowId: string): Promise<void>;
}

function intentKey(flowId: string): string {
  return `${DELETE_INTENT_PREFIX}${JSON.stringify(['flow', flowId])}`;
}

function parseIntent(text: string): DeleteOwnedFlowIntent {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (raw.v !== 1 || typeof raw.flowId !== 'string' || raw.flowId === '') {
    throw new Error('invalid delete intent');
  }
  return { v: 1, flowId: raw.flowId };
}

async function completeIntent(
  key: string,
  intent: DeleteOwnedFlowIntent,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const definitionKey = catalogDefinitionKey(intent.flowId, 'owned');
  const runId = activeRunId(definitionKey);

  await deps.removeFlow(intent.flowId);
  await deps.unenroll(definitionKey);
  await deps.cancelNotifications([runId, sequentialReminderId(runId)]);
  await deps.deleteRun(runId);
  await deps.deleteCheckIns(definitionKey);
  await deps.deleteRevisions(intent.flowId);
  await deps.kv.removeItem(key);
}

export async function deleteOwnedFlowDurably(
  flow: Flow,
  definitionKey: string,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const expectedDefinitionKey = catalogDefinitionKey(flow.id, 'owned');
  if (definitionKey !== expectedDefinitionKey) {
    throw new Error('invalid owned definition key');
  }

  const key = intentKey(flow.id);
  const intent: DeleteOwnedFlowIntent = { v: 1, flowId: flow.id };

  // Journal write is the business commit. Completion is best-effort; recovery owns failures.
  await deps.kv.setItem(key, JSON.stringify(intent));
  try {
    await completeIntent(key, intent, deps);
  } catch {
    // keep journal for recoverPendingOwnedFlowDeletions()
  }
}

export async function recoverPendingOwnedFlowDeletions(deps: DeleteOwnedFlowDeps): Promise<void> {
  const keys = (await deps.kv.keys()).filter((key) => key.startsWith(DELETE_INTENT_PREFIX)).sort();
  for (const key of keys) {
    const text = await deps.kv.getItem(key);
    if (text === null) continue;
    await completeIntent(key, parseIntent(text), deps);
  }
}
