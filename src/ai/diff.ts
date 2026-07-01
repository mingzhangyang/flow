// AI 能力④：比较两个 Flow（AI-C4）。也是 AI 改动“可 Diff/可回退”（AI-C3）的底座——
// 无论改动来自人还是将来的 AI，都能先看差异、再决定。纯函数、确定性、离线。

import { type Flow, type FlowNode } from '../domain/types';

export type Change =
  | { kind: 'meta'; field: 'title' | 'description'; from?: string; to?: string }
  | { kind: 'nodeAdded'; id: string; label: string }
  | { kind: 'nodeRemoved'; id: string; label: string }
  | { kind: 'nodeChanged'; id: string; label: string; fields: string[] }
  | { kind: 'nodeMoved'; id: string; label: string; from: number; to: number };

export function diffFlows(prev: Flow, next: Flow): Change[] {
  const changes: Change[] = [];

  if (prev.title !== next.title) {
    changes.push({ kind: 'meta', field: 'title', from: prev.title, to: next.title });
  }
  if ((prev.description ?? '') !== (next.description ?? '')) {
    changes.push({ kind: 'meta', field: 'description', from: prev.description, to: next.description });
  }

  const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextById = new Map(next.nodes.map((n) => [n.id, n]));

  for (const n of prev.nodes) {
    if (!nextById.has(n.id)) changes.push({ kind: 'nodeRemoved', id: n.id, label: n.label });
  }
  for (const n of next.nodes) {
    const before = prevById.get(n.id);
    if (!before) {
      changes.push({ kind: 'nodeAdded', id: n.id, label: n.label });
      continue;
    }
    const fields = changedFields(before, n);
    if (fields.length > 0) changes.push({ kind: 'nodeChanged', id: n.id, label: n.label, fields });
  }

  // 相对顺序变化（只看两边都存在的节点）
  const commonPrev = prev.nodes.filter((n) => nextById.has(n.id)).map((n) => n.id);
  const commonNext = next.nodes.filter((n) => prevById.has(n.id)).map((n) => n.id);
  commonNext.forEach((id, i) => {
    const from = commonPrev.indexOf(id);
    if (from !== i) {
      const node = nextById.get(id) as FlowNode;
      changes.push({ kind: 'nodeMoved', id, label: node.label, from, to: i });
    }
  });

  return changes;
}

function changedFields(a: FlowNode, b: FlowNode): string[] {
  const fields: string[] = [];
  if (a.kind !== b.kind) fields.push('类型');
  if (a.label !== b.label) fields.push('名称');
  if ((a.rationale ?? '') !== (b.rationale ?? '')) fields.push('为什么');
  if (a.kind === 'timed' && b.kind === 'timed' && a.durationSec !== b.durationSec) fields.push('时长');
  if (a.kind === 'scheduled' && b.kind === 'scheduled' && a.at !== b.at) fields.push('时间');
  return fields;
}

/** 一条差异的人类可读描述。 */
export function describeChange(c: Change): string {
  switch (c.kind) {
    case 'meta':
      return `${c.field === 'title' ? '标题' : '描述'} 改为「${c.to ?? '（空）'}」`;
    case 'nodeAdded':
      return `新增　${c.label || '（未命名）'}`;
    case 'nodeRemoved':
      return `删除　${c.label || '（未命名）'}`;
    case 'nodeChanged':
      return `修改　${c.label}（${c.fields.join('、')}）`;
    case 'nodeMoved':
      return `移动　${c.label}（第 ${c.from + 1} → 第 ${c.to + 1}）`;
  }
}
