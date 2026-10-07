// Flow catalog 的唯一 ID 冲突规则：用户拥有的 Flow 优先于内置示例。
// 导入允许保留外部稳定 id，因此不能假设示例 id 永远唯一；所有展示、提醒与路由
// 都必须应用同一 shadowing 语义，避免同 id 指向不同定义（C6）。

import { type Flow } from '../domain/types';

export type FlowCatalogSource = 'owned' | 'example';

export interface CatalogEntry {
  flow: Flow;
  source: FlowCatalogSource;
  /** 提醒登记绑定“具体 catalog 定义”，而不是裸 flowId。 */
  enrollmentKey: string;
}

const OWNED_SHADOW_PREFIX = 'owned-shadow:';

/**
 * 非冲突 Flow 沿用旧 flowId 作为提醒登记 key，兼容已有数据。
 * 只有 owned Flow 与内置示例同 id 时改用独立 key，阻断登记在两个定义间转移。
 */
export function reminderEnrollmentKey(
  flowId: string,
  source: FlowCatalogSource,
  examples: readonly Flow[],
): string {
  const shadowsExample = source === 'owned' && examples.some((flow) => flow.id === flowId);
  return shadowsExample ? `${OWNED_SHADOW_PREFIX}${encodeURIComponent(flowId)}` : flowId;
}

/** 返回未被同 id 用户 Flow 遮蔽的示例。 */
export function examplesVisibleAlongsideOwned(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  const ownedIds = new Set(owned.map((flow) => flow.id));
  return examples.filter((flow) => !ownedIds.has(flow.id));
}

/** 构造无重复 id 的可见 catalog，并带上各自独立的提醒登记身份。 */
export function catalogEntriesWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): CatalogEntry[] {
  return [
    ...owned.map((flow) => ({
      flow,
      source: 'owned' as const,
      enrollmentKey: reminderEnrollmentKey(flow.id, 'owned', examples),
    })),
    ...examplesVisibleAlongsideOwned(examples, owned).map((flow) => ({
      flow,
      source: 'example' as const,
      enrollmentKey: reminderEnrollmentKey(flow.id, 'example', examples),
    })),
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
  if (ownedFlow) {
    return {
      flow: ownedFlow,
      source: 'owned',
      enrollmentKey: reminderEnrollmentKey(flowId, 'owned', examples),
    };
  }

  const example = examples.find((flow) => flow.id === flowId);
  if (!example) return null;
  return {
    flow: example,
    source: 'example',
    enrollmentKey: reminderEnrollmentKey(flowId, 'example', examples),
  };
}

/** 兼容只需要 Flow 的调用方。 */
export function resolveCatalogFlow(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): Flow | null {
  return resolveCatalogEntry(flowId, owned, examples)?.flow ?? null;
}
