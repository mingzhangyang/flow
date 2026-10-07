// Flow catalog 的唯一 ID 冲突规则：用户拥有的 Flow 优先于内置示例。
// 提醒登记身份不能依赖任何“保留前缀”：Flow ID 是开放字符串，任意前缀都可能被导入值撞上。
// 因此新 enrollment 使用 source + flowId 的结构化身份；旧 bare-ID 只作为迁移别名处理（C6）。

import { type Flow } from '../domain/types';

export type FlowCatalogSource = 'owned' | 'example';

export interface ReminderEnrollmentIdentity {
  key: string;
  /** 旧版本裸 flowId 的兼容别名；shadowing owned 时故意不提供，避免歧义转移。 */
  legacyId?: string;
}

export interface CatalogEntry {
  flow: Flow;
  source: FlowCatalogSource;
  enrollmentKey: string;
  legacyEnrollmentId?: string;
}

export type OwnedCatalogSnapshot =
  | { status: 'loading' }
  | { status: 'ready'; flows: Flow[] }
  | { status: 'error' };

export const LOADING_CATALOG: OwnedCatalogSnapshot = { status: 'loading' };
export const ERROR_CATALOG: OwnedCatalogSnapshot = { status: 'error' };

const ENROLLMENT_KEY_VERSION = 'v2';

/**
 * 对 (source, flowId) 做注入式编码。所有新登记都以结构化记录存储，
 * 所以即使用户 Flow ID 文本恰好长得像这个 key，也不会与新记录混淆。
 */
export function reminderEnrollmentIdentity(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): ReminderEnrollmentIdentity {
  const key = JSON.stringify([ENROLLMENT_KEY_VERSION, source, flowId]);
  const shadowsExample = source === 'owned' && examples.some((flow) => flow.id === flowId);
  return shadowsExample ? { key } : { key, legacyId: flowId };
}

export function reminderEnrollmentKey(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): string {
  return reminderEnrollmentIdentity(flowId, source, examples).key;
}

/** 返回未被同 id 用户 Flow 遮蔽的示例。 */
export function examplesVisibleAlongsideOwned(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  const ownedIds = new Set(owned.map((flow) => flow.id));
  return examples.filter((flow) => !ownedIds.has(flow.id));
}

function entryFor(flow: Flow, source: FlowCatalogSource, examples: readonly Flow[]): CatalogEntry {
  const identity = reminderEnrollmentIdentity(flow.id, source, examples);
  return {
    flow,
    source,
    enrollmentKey: identity.key,
    ...(identity.legacyId ? { legacyEnrollmentId: identity.legacyId } : {}),
  };
}

/** 构造无重复 id 的可见 catalog，并带上各自独立的提醒登记身份。 */
export function catalogEntriesWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): CatalogEntry[] {
  return [
    ...owned.map((flow) => entryFor(flow, 'owned', examples)),
    ...examplesVisibleAlongsideOwned(examples, owned).map((flow) => entryFor(flow, 'example', examples)),
  ];
}

/** 兼容只需要 Flow[] 的调用方。 */
export function catalogWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  return catalogEntriesWithOwnedPrecedence(examples, owned).map((entry) => entry.flow);
}

/** 按统一规则解析 id：用户 Flow > 内置示例，并返回其 catalog 身份。 */
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

/** 兼容只需要 Flow 的调用方。 */
export function resolveCatalogFlow(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): Flow | null {
  return resolveCatalogEntry(flowId, owned, examples)?.flow ?? null;
}
