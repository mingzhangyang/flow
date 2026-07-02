// AI 能力④：比较两个 Flow（AI-C4）。也是 AI 改动“可 Diff/可回退”（AI-C3）的底座——
// 无论改动来自人还是将来的 AI，都能先看差异、再决定。纯函数、确定性、离线。

import { type Flow, type FlowNode } from '../domain/types';
import { type Locale } from '../i18n/locale';

/** 节点上可发生变化的字段（稳定标识，语言无关；译文见 describeChange）。 */
export type NodeField = 'kind' | 'label' | 'rationale' | 'duration' | 'time';

export type Change =
  | { kind: 'meta'; field: 'title' | 'description'; from?: string; to?: string }
  | { kind: 'nodeAdded'; id: string; label: string }
  | { kind: 'nodeRemoved'; id: string; label: string }
  | { kind: 'nodeChanged'; id: string; label: string; fields: NodeField[] }
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

function changedFields(a: FlowNode, b: FlowNode): NodeField[] {
  const fields: NodeField[] = [];
  if (a.kind !== b.kind) fields.push('kind');
  if (a.label !== b.label) fields.push('label');
  if ((a.rationale ?? '') !== (b.rationale ?? '')) fields.push('rationale');
  if (a.kind === 'timed' && b.kind === 'timed' && a.durationSec !== b.durationSec) fields.push('duration');
  if (a.kind === 'scheduled' && b.kind === 'scheduled' && a.at !== b.at) fields.push('time');
  return fields;
}

interface DiffText {
  fieldNames: Record<NodeField, string>;
  fieldJoiner: string;
  unnamed: string;
  meta: (field: 'title' | 'description', to: string | undefined) => string;
  added: (label: string) => string;
  removed: (label: string) => string;
  changed: (label: string, fields: string) => string;
  moved: (label: string, from: number, to: number) => string;
}

const TEXT: Record<Locale, DiffText> = {
  zh: {
    fieldNames: { kind: '类型', label: '名称', rationale: '为什么', duration: '时长', time: '时间' },
    fieldJoiner: '、',
    unnamed: '（未命名）',
    meta: (field, to) => `${field === 'title' ? '标题' : '描述'} 改为「${to ?? '（空）'}」`,
    added: (label) => `新增　${label}`,
    removed: (label) => `删除　${label}`,
    changed: (label, fields) => `修改　${label}（${fields}）`,
    moved: (label, from, to) => `移动　${label}（第 ${from + 1} → 第 ${to + 1}）`,
  },
  'zh-Hant': {
    fieldNames: { kind: '類型', label: '名稱', rationale: '為什麼', duration: '時長', time: '時間' },
    fieldJoiner: '、',
    unnamed: '（未命名）',
    meta: (field, to) => `${field === 'title' ? '標題' : '描述'} 改為「${to ?? '（空）'}」`,
    added: (label) => `新增　${label}`,
    removed: (label) => `刪除　${label}`,
    changed: (label, fields) => `修改　${label}（${fields}）`,
    moved: (label, from, to) => `移動　${label}（第 ${from + 1} → 第 ${to + 1}）`,
  },
  en: {
    fieldNames: { kind: 'type', label: 'name', rationale: 'why', duration: 'duration', time: 'time' },
    fieldJoiner: ', ',
    unnamed: '(unnamed)',
    meta: (field, to) => `${field === 'title' ? 'Title' : 'Description'} changed to "${to ?? '(empty)'}"`,
    added: (label) => `Added ${label}`,
    removed: (label) => `Removed ${label}`,
    changed: (label, fields) => `Changed ${label} (${fields})`,
    moved: (label, from, to) => `Moved ${label} (#${from + 1} → #${to + 1})`,
  },
};

/** 一条差异的人类可读描述。语言显式注入（同 E3 思路）。 */
export function describeChange(c: Change, locale: Locale): string {
  const t = TEXT[locale];
  const fields = (fs: NodeField[]): string => fs.map((f) => t.fieldNames[f]).join(t.fieldJoiner);
  switch (c.kind) {
    case 'meta':
      return t.meta(c.field, c.to);
    case 'nodeAdded':
      return t.added(c.label || t.unnamed);
    case 'nodeRemoved':
      return t.removed(c.label || t.unnamed);
    case 'nodeChanged':
      return t.changed(c.label, fields(c.fields));
    case 'nodeMoved':
      return t.moved(c.label, c.from, c.to);
  }
}
