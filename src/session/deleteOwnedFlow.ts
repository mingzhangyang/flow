// 用户 Flow 删除的 durable commit-forward journal。
// 这是正式 v1 的崩溃恢复机制，不是旧数据迁移：journal 先落盘，随后清定义及其所有
// definition-scoped 状态；任一步失败都保留 journal，下次 catalog refresh 幂等重试。

import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';
import { sequentialReminderId } from '../notifications/notificationIdentity';
import { activeRunId } from './runPersistence';

const DELETE_INTENT_PREFIX = 'txn:delete-owned-flow:v1:';

interface DeleteOwnedFlowIntent {
  v: 1;
  flowId: string;
  definitionKey: string;
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
  if (
    raw.v !== 1 ||
    typeof raw.flowId !== 'string' ||
    typeof raw.definitionKey !== 'string' ||
    raw.definitionKey === ''
  ) {
    throw new Error('invalid delete intent');
  }
  return { v: 1, flowId: raw.flowId, definitionKey: raw.definitionKey };
}

async function completeIntent(
  key: string,
  intent: DeleteOwnedFlowIntent,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const runId = activeRunId(intent.definitionKey);

  await deps.removeFlow(intent.flowId);
  await deps.unenroll(intent.definitionKey);
  await deps.cancelNotifications([runId, sequentialReminderId(runId)]);
  await deps.deleteRun(runId);
  await deps.deleteCheckIns(intent.definitionKey);
  await deps.deleteRevisions(intent.flowId);
  await deps.kv.removeItem(key);
}

export async function deleteOwnedFlowDurably(
  flow: Flow,
  definitionKey: string,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const key = intentKey(flow.id);
  const intent: DeleteOwnedFlowIntent = { v: 1, flowId: flow.id, definitionKey };

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
    if (!text) continue;
    await completeIntent(key, parseIntent(text), deps);
  }
}
