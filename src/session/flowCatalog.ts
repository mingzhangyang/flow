// Catalog identity 是所有“属于某个 Flow 定义”的运行时状态的唯一身份边界。
// Flow ID 是开放字符串，且 example / owned 可以同 id，因此裸 flowId 不能作为运行时状态主键。
// 新状态统一按 (source, flowId) 的 versioned tuple 编码；裸 flowId 只作为无歧义旧数据迁移别名。

import { type Flow } from '../domain/types';

export type FlowCatalogSource = 'owned' | 'example';

export interface CatalogDefinitionIdentity {
  key: string;
  /** 仅当裸 flowId 在当前来源上无歧义时可用于迁移旧数据。 */
  legacyFlowId?: string;
}

export interface CatalogEntry {
  flow: Flow;
  source: FlowCatalogSource;
  definitionKey: string;
  legacyFlowId?: string;
}

export type OwnedCatalogSnapshot =
  | { status: 'loading' }
  | { status: 'ready'; flows: Flow[] }
  | { status: 'error' };

export const LOADING_CATALOG: OwnedCatalogSnapshot = { status: 'loading' };
export const ERROR_CATALOG: OwnedCatalogSnapshot = { status: 'error' };

const DEFINITION_KEY_VERSION = 'v2';

export function catalogDefinitionIdentity(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): CatalogDefinitionIdentity {
  const key = JSON.stringify([DEFINITION_KEY_VERSION, source, flowId]);
  const shadowsExample = source === 'owned' && examples.some((flow) => flow.id === flowId);
  return shadowsExample ? { key } : { key, legacyFlowId: flowId };
}

// Compatibility exports for tests/older callers while the semantic name is upgraded.
export function reminderEnrollmentIdentity(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): { key: string; legacyId?: string } {
  const identity = catalogDefinitionIdentity(flowId, source, examples);
  return identity.legacyFlowId
    ? { key: identity.key, legacyId: identity.legacyFlowId }
    : { key: identity.key };
}

export function reminderEnrollmentKey(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): string {
  return catalogDefinitionIdentity(flowId, source, examples).key;
}

export function examplesVisibleAlongsideOwned(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  const ownedIds = new Set(owned.map((flow) => flow.id));
  return examples.filter((flow) => !ownedIds.has(flow.id));
}

function entryFor(flow: Flow, source: FlowCatalogSource, examples: readonly Flow[]): CatalogEntry {
  const identity = catalogDefinitionIdentity(flow.id, source, examples);
  return {
    flow,
    source,
    definitionKey: identity.key,
    ...(identity.legacyFlowId ? { legacyFlowId: identity.legacyFlowId } : {}),
  };
}

export function catalogEntriesWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): CatalogEntry[] {
  return [
    ...owned.map((flow) => entryFor(flow, 'owned', examples)),
    ...examplesVisibleAlongsideOwned(examples, owned).map((flow) => entryFor(flow, 'example', examples)),
  ];
}

export function catalogWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  return catalogEntriesWithOwnedPrecedence(examples, owned).map((entry) => entry.flow);
}

export function resolveCatalogEntry(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): CatalogEntry | null {
  const ownedFlow = owned.find((flow) => flow.id === flowId);
  if (ownedFlow) return entryFor(ownedFlow, 'owned', examples);

  const example = examples.find((flow) => flow.id === flowId);
  return example ? entryFor(example, 'example', examples) : null;
}

/** 新通知必须匹配 definitionKey；旧通知只在裸 flowId 来源无歧义时兼容。 */
export function resolveCatalogEntryForRoute(
  flowId: string,
  definitionKey: string | undefined,
  owned: readonly Flow[],
  examples: readonly Flow[],
): CatalogEntry | null {
  const entry = resolveCatalogEntry(flowId, owned, examples);
  if (!entry) return null;
  if (definitionKey !== undefined) return entry.definitionKey === definitionKey ? entry : null;
  return entry.legacyFlowId === flowId ? entry : null;
}

export function resolveCatalogFlow(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): Flow | null {
  return resolveCatalogEntry(flowId, owned, examples)?.flow ?? null;
}
