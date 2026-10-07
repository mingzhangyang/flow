// Flow catalog：用户 Flow 优先于只读示例；所有 definition-scoped 运行时状态
// 统一以 (source, flowId) 的 versioned definitionKey 隔离。项目尚未发布，因此 v1 不承担
// 任何开发中间格式的 legacy alias / migration / tombstone 兼容。

import { type Flow } from '../domain/types';
import { definitionKey, type DefinitionSource } from '../domain/definitionIdentity';

export type FlowCatalogSource = DefinitionSource;

export interface CatalogEntry {
  flow: Flow;
  source: FlowCatalogSource;
  definitionKey: string;
}

export interface CatalogProjection {
  flows: Flow[];
}

export type OwnedCatalogSnapshot =
  | { status: 'loading' }
  | ({ status: 'ready' } & CatalogProjection)
  | { status: 'error' };

export const LOADING_CATALOG: OwnedCatalogSnapshot = { status: 'loading' };
export const ERROR_CATALOG: OwnedCatalogSnapshot = { status: 'error' };

export function catalogDefinitionKey(
  flowId: string,
  source: FlowCatalogSource,
): string {
  return definitionKey({ flowId, source });
}

export function examplesVisibleAlongsideOwned(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  const ownedIds = new Set(owned.map((flow) => flow.id));
  return examples.filter((flow) => !ownedIds.has(flow.id));
}

function entryFor(flow: Flow, source: FlowCatalogSource): CatalogEntry {
  return { flow, source, definitionKey: catalogDefinitionKey(flow.id, source) };
}

export function catalogEntriesWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): CatalogEntry[] {
  return [
    ...owned.map((flow) => entryFor(flow, 'owned')),
    ...examplesVisibleAlongsideOwned(examples, owned).map((flow) => entryFor(flow, 'example')),
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
  if (ownedFlow) return entryFor(ownedFlow, 'owned');

  const example = examples.find((flow) => flow.id === flowId);
  return example ? entryFor(example, 'example') : null;
}

/** 通知必须同时匹配 flowId + definitionKey；缺 identity 或 stale identity 都 fail closed。 */
export function resolveCatalogEntryForRoute(
  flowId: string,
  definitionKey: string | undefined,
  owned: readonly Flow[],
  examples: readonly Flow[],
): CatalogEntry | null {
  if (!definitionKey) return null;
  const entry = resolveCatalogEntry(flowId, owned, examples);
  return entry?.definitionKey === definitionKey ? entry : null;
}

export function resolveCatalogFlow(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): Flow | null {
  return resolveCatalogEntry(flowId, owned, examples)?.flow ?? null;
}
