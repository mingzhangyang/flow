// 曾发生过 catalog identity 歧义的裸 Flow ID 永久进入本机 quarantine。
// 这是迁移安全元数据，不是用户 Flow 数据：一旦某 id 同时代表过 owned + example，
// 后续即使 owned 被删除，也绝不能重新把历史 bare-id 状态解释成 fallback example。

import { type KVStore } from '../storage/kv';

const LEGACY_AMBIGUOUS_IDS_KEY = 'catalog:legacy-ambiguous-flow-ids:v1';

function parseIds(text: string): string[] {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) {
    throw new Error('invalid legacy identity quarantine');
  }
  return [...new Set(raw)].sort();
}

export async function readLegacyAmbiguousFlowIds(kv: KVStore): Promise<string[]> {
  const text = await kv.getItem(LEGACY_AMBIGUOUS_IDS_KEY);
  return text === null ? [] : parseIds(text);
}

export async function markLegacyAmbiguousFlowId(kv: KVStore, flowId: string): Promise<void> {
  const ids = await readLegacyAmbiguousFlowIds(kv);
  if (ids.includes(flowId)) return;
  await kv.setItem(LEGACY_AMBIGUOUS_IDS_KEY, JSON.stringify([...ids, flowId].sort()));
}
