// 用户 Flow 删除的持久化事务日志。
//
// AsyncStorage/KV 没有跨 key 事务，因此不能靠“失败后立即 rollback”声称原子性。
// 正确语义是 commit-forward：任何破坏性写入前先落 durable intent；随后 remove → unenroll →
// 清 intent。任一步失败都保留 intent，App 下一次 catalog refresh / foreground 会重试。
// 这样即使进程崩溃或单次写入失败，也不会出现“没有 Flow、也没有恢复线索”的静默数据丢失。

import { coerceFlow } from '../domain/serialize';
import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';

const DELETE_INTENT_PREFIX = 'txn:delete-owned-flow:';

interface DeleteOwnedFlowIntent {
  v: 1;
  flow: Flow;
  enrollmentKey: string;
  legacyEnrollmentId?: string;
}

export interface DeleteOwnedFlowDeps {
  kv: KVStore;
  removeFlow(id: string): Promise<void>;
  unenroll(enrollmentKey: string, legacyEnrollmentId?: string): Promise<void>;
}

function intentKey(flowId: string): string {
  return `${DELETE_INTENT_PREFIX}${encodeURIComponent(flowId)}`;
}

function parseIntent(text: string): DeleteOwnedFlowIntent {
  const raw = JSON.parse(text) as {
    v?: unknown;
    flow?: unknown;
    enrollmentKey?: unknown;
    legacyEnrollmentId?: unknown;
  };
  if (raw.v !== 1 || typeof raw.enrollmentKey !== 'string') throw new Error('invalid delete intent');
  if (raw.legacyEnrollmentId !== undefined && typeof raw.legacyEnrollmentId !== 'string') {
    throw new Error('invalid delete intent legacy id');
  }
  return {
    v: 1,
    flow: coerceFlow(raw.flow),
    enrollmentKey: raw.enrollmentKey,
    ...(raw.legacyEnrollmentId !== undefined ? { legacyEnrollmentId: raw.legacyEnrollmentId } : {}),
  };
}

async function completeIntent(
  key: string,
  intent: DeleteOwnedFlowIntent,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  await deps.removeFlow(intent.flow.id);
  await deps.unenroll(intent.enrollmentKey, intent.legacyEnrollmentId);
  await deps.kv.removeItem(key);
}

export async function deleteOwnedFlowDurably(
  flow: Flow,
  enrollmentKey: string,
  legacyEnrollmentId: string | undefined,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  const key = intentKey(flow.id);
  const intent: DeleteOwnedFlowIntent = {
    v: 1,
    flow,
    enrollmentKey,
    ...(legacyEnrollmentId !== undefined ? { legacyEnrollmentId } : {}),
  };

  await deps.kv.setItem(key, JSON.stringify(intent));
  await completeIntent(key, intent, deps);
}

export async function recoverPendingOwnedFlowDeletions(deps: DeleteOwnedFlowDeps): Promise<void> {
  const keys = (await deps.kv.keys()).filter((key) => key.startsWith(DELETE_INTENT_PREFIX)).sort();
  for (const key of keys) {
    const text = await deps.kv.getItem(key);
    if (!text) continue;
    const intent = parseIntent(text);
    await completeIntent(key, intent, deps);
  }
}
