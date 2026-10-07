// 用户 Flow 删除的 durable commit-forward journal。
// 正式 v1 只在 journal key 中编码 flowId；value 仅是版本标记，因此不存在两份可漂移的身份。
// owned definitionKey 始终由 key 中的 flowId 唯一推导；任一步失败都保留 journal，下次 refresh 幂等重试。

import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { catalogDefinitionKey } from './flowCatalog';
import { activeRunId } from './runPersistence';
import { type DefinitionRuntime } from './definitionRuntime';

const DELETE_INTENT_PREFIX = 'txn:delete-owned-flow:v1:';

interface DeleteOwnedFlowIntent {
  v: 1;
}

export interface DeleteOwnedFlowDeps {
  kv: KVStore;
  runtime: Pick<DefinitionRuntime, 'retire'>;
  removeFlow(id: string): Promise<void>;
  unenroll(definitionKey: string): Promise<void>;
  cancelScheduledNotifications(definitionKey: string): Promise<void>;
  cancelNotifications(ids: string[]): Promise<void>;
  deleteRun(id: string): Promise<void>;
  deleteCheckIns(definitionKey: string): Promise<void>;
  deleteRevisions(flowId: string): Promise<void>;
}

function intentKey(flowId: string): string {
  return `${DELETE_INTENT_PREFIX}${JSON.stringify(['flow', flowId])}`;
}

function parseIntentKey(key: string): string {
  if (!key.startsWith(DELETE_INTENT_PREFIX)) throw new Error('invalid delete intent key');
  let raw: unknown;
  try {
    raw = JSON.parse(key.slice(DELETE_INTENT_PREFIX.length));
  } catch {
    throw new Error('invalid delete intent key');
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    raw[0] !== 'flow' ||
    typeof raw[1] !== 'string' ||
    raw[1] === '' ||
    intentKey(raw[1]) !== key
  ) {
    throw new Error('invalid delete intent key');
  }
  return raw[1];
}

function parseIntent(text: string): DeleteOwnedFlowIntent {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('invalid delete intent');
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw) ||
    (raw as Record<string, unknown>).v !== 1 ||
    Object.keys(raw).length !== 1
  ) {
    throw new Error('invalid delete intent');
  }
  return { v: 1 };
}

async function completeIntent(
  key: string,
  flowId: string,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const definitionKey = catalogDefinitionKey(flowId, 'owned');
  const runId = activeRunId(definitionKey);

  await deps.runtime.retire(definitionKey, async () => {
    await deps.removeFlow(flowId);
    await deps.unenroll(definitionKey);
    await deps.cancelScheduledNotifications(definitionKey);
    await deps.cancelNotifications(sequentialReminderIdsForRun(runId));
    await deps.deleteRun(runId);
    await deps.deleteCheckIns(definitionKey);
    await deps.deleteRevisions(flowId);
    await deps.kv.removeItem(key);
  });
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
  const intent: DeleteOwnedFlowIntent = { v: 1 };

  // Journal write is the business commit. Completion is best-effort; recovery owns failures.
  await deps.kv.setItem(key, JSON.stringify(intent));
  try {
    await completeIntent(key, flow.id, deps);
  } catch {
    // keep journal for recoverPendingOwnedFlowDeletions()
  }
}

export async function recoverPendingOwnedFlowDeletions(deps: DeleteOwnedFlowDeps): Promise<void> {
  const keys = (await deps.kv.keys()).filter((key) => key.startsWith(DELETE_INTENT_PREFIX)).sort();
  for (const key of keys) {
    const text = await deps.kv.getItem(key);
    if (text === null) continue;
    const flowId = parseIntentKey(key);
    parseIntent(text);
    await completeIntent(key, flowId, deps);
  }
}
