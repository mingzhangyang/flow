// 用户 Flow 删除的持久化 commit-forward journal。
// 破坏性写入前先落最小 intent；随后 remove → unenroll → 清 intent。
// 任一步失败都保留 intent，下一次 catalog refresh 重试。

import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';

const DELETE_INTENT_PREFIX = 'txn:delete-owned-flow:';

interface DeleteOwnedFlowIntent {
  v: 1;
  flowId: string;
  definitionKey: string;
  legacyFlowId?: string;
}

export interface DeleteOwnedFlowDeps {
  kv: KVStore;
  removeFlow(id: string): Promise<void>;
  unenroll(definitionKey: string, legacyFlowId?: string): Promise<void>;
}

function intentKey(flowId: string): string {
  return `${DELETE_INTENT_PREFIX}${encodeURIComponent(flowId)}`;
}

function parseIntent(text: string): DeleteOwnedFlowIntent {
  const raw = JSON.parse(text) as Record<string, unknown>;
  // Accept the earlier PR-local field names so in-flight journal data remains recoverable.
  const definitionKey =
    typeof raw.definitionKey === 'string'
      ? raw.definitionKey
      : typeof raw.enrollmentKey === 'string'
        ? raw.enrollmentKey
        : null;
  const legacyFlowId =
    typeof raw.legacyFlowId === 'string'
      ? raw.legacyFlowId
      : typeof raw.legacyEnrollmentId === 'string'
        ? raw.legacyEnrollmentId
        : undefined;

  if (raw.v !== 1 || typeof raw.flowId !== 'string' || definitionKey === null) {
    throw new Error('invalid delete intent');
  }
  return {
    v: 1,
    flowId: raw.flowId,
    definitionKey,
    ...(legacyFlowId !== undefined ? { legacyFlowId } : {}),
  };
}

async function completeIntent(
  key: string,
  intent: DeleteOwnedFlowIntent,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  await deps.removeFlow(intent.flowId);
  await deps.unenroll(intent.definitionKey, intent.legacyFlowId);
  await deps.kv.removeItem(key);
}

export async function deleteOwnedFlowDurably(
  flow: Flow,
  definitionKey: string,
  legacyFlowId: string | undefined,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const key = intentKey(flow.id);
  const intent: DeleteOwnedFlowIntent = {
    v: 1,
    flowId: flow.id,
    definitionKey,
    ...(legacyFlowId !== undefined ? { legacyFlowId } : {}),
  };

  await deps.kv.setItem(key, JSON.stringify(intent));
  await completeIntent(key, intent, deps);
}

export async function recoverPendingOwnedFlowDeletions(deps: DeleteOwnedFlowDeps): Promise<void> {
  const keys = (await deps.kv.keys()).filter((key) => key.startsWith(DELETE_INTENT_PREFIX)).sort();
  for (const key of keys) {
    const text = await deps.kv.getItem(key);
    if (!text) continue;
    await completeIntent(key, parseIntent(text), deps);
  }
}
