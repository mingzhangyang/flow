// Flow catalog 的唯一 ID 冲突规则：用户拥有的 Flow 优先于内置示例。
// 导入允许保留外部稳定 id，因此不能假设示例 id 永远唯一；所有展示、提醒与路由
// 都必须应用同一 shadowing 语义，避免同 id 指向不同定义（C6）。

import { type Flow } from '../domain/types';

/** 返回未被同 id 用户 Flow 遮蔽的示例。 */
export function examplesVisibleAlongsideOwned(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  const ownedIds = new Set(owned.map((flow) => flow.id));
  return examples.filter((flow) => !ownedIds.has(flow.id));
}

/** 构造无重复 id 的 catalog；用户 Flow 排在前面并拥有定义权。 */
export function catalogWithOwnedPrecedence(
  examples: readonly Flow[],
  owned: readonly Flow[],
): Flow[] {
  return [...owned, ...examplesVisibleAlongsideOwned(examples, owned)];
}

/** 按统一规则解析 id：用户 Flow > 内置示例。 */
export function resolveCatalogFlow(
  flowId: string,
  owned: readonly Flow[],
  examples: readonly Flow[],
): Flow | null {
  return owned.find((flow) => flow.id === flowId)
    ?? examples.find((flow) => flow.id === flowId)
    ?? null;
}
