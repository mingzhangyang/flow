// AI 能力⑤：从自然语言生成 Flow（AI-C4 把「生成」放在最后——解释/分析/比较已先行）。
// 结构：buildGenerationRequest / parseGeneratedFlow 是纯函数（确定性、可测），
// generateFlow 只做编排，通过 ModelPort 调用任意供应商的模型（不绑定某一家）。
// 生成结果只是「提议的草稿」：由用户在编辑器里审阅、保存为新版本（AI-C1、AI-C3）。

import { SCHEMA_VERSION, type Flow, type FlowNode, type Topology } from '../domain/types';
import { validateFlow, type ValidationIssue } from '../domain/validate';
import type { ModelPort, ModelRequest } from './model/port';

const SYSTEM_PROMPT = `你是「准时」应用的 flow 编辑助手。用户用自然语言描述一个时间模式，你把它转写成一个 JSON 对象。只输出这一个 JSON 对象——不要 markdown 代码块，不要任何解释文字。

JSON 结构：
{
  "title": "简短标题",
  "description": "一句话说明（可省略）",
  "topology": "sequential" 或 "scheduled",
  "nodes": [ ... ]
}

两种拓扑：
- "sequential"（顺序型，如烹饪、锻炼）：节点依次执行。允许的节点：
  {"kind":"timed","label":"...","durationSec":240,"rationale":"..."}    计时步骤，durationSec 为正整数秒
  {"kind":"gate","label":"...","rationale":"..."}                        需要用户确认后才继续
  {"kind":"instant","label":"...","rationale":"..."}                     瞬时动作
- "scheduled"（日程型，如每日服药）：节点钉在每天的墙钟时刻，互相独立。允许的节点：
  {"kind":"scheduled","label":"...","at":"08:00","repeat":{"kind":"daily"},"rationale":"..."}
  {"kind":"parallel","label":"...","children":[ 若干 scheduled 节点 ]}    同一时刻的并行组

规则：
- 每个节点尽量写 rationale（这一步「为什么」）——这是本应用的核心价值。
- 不要输出 id、schemaVersion、version 字段，应用会自动分配。
- 时长换算成秒；时刻用 24 小时制 "HH:MM"。
- 医疗相关内容只做描述性转写，不提供医疗建议。`;

export function buildGenerationRequest(description: string): ModelRequest {
  return {
    system: SYSTEM_PROMPT,
    prompt: description.trim(),
    maxTokens: 4096,
  };
}

export type GenerateResult =
  | { ok: true; flow: Flow }
  | { ok: false; error: string; issues?: ValidationIssue[] };

/** 模型输出里可能包着代码块或前后缀文字；取第一个 { 到最后一个 } 之间的部分。 */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** "HH:MM" → 自午夜起的分钟数；数字原样返回。 */
function coerceTimeOfDay(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return NaN;
}

interface RawNode {
  kind?: unknown;
  label?: unknown;
  rationale?: unknown;
  durationSec?: unknown;
  at?: unknown;
  repeat?: unknown;
  children?: unknown;
}

/** 把模型给出的节点整理成领域节点：分配 id、换算时刻、丢弃未知字段。 */
function coerceNode(raw: RawNode, nextId: () => string): FlowNode {
  const base = {
    id: nextId(),
    label: typeof raw.label === 'string' ? raw.label : '',
    ...(typeof raw.rationale === 'string' && raw.rationale ? { rationale: raw.rationale } : {}),
  };
  switch (raw.kind) {
    case 'timed':
      return { ...base, kind: 'timed', durationSec: Math.round(Number(raw.durationSec)) };
    case 'gate':
      return { ...base, kind: 'gate' };
    case 'instant':
      return { ...base, kind: 'instant' };
    case 'scheduled': {
      const repeat =
        typeof raw.repeat === 'object' &&
        raw.repeat !== null &&
        (raw.repeat as { kind?: unknown }).kind === 'once'
          ? ({ kind: 'once' } as const)
          : ({ kind: 'daily' } as const);
      return { ...base, kind: 'scheduled', at: coerceTimeOfDay(raw.at), repeat };
    }
    case 'parallel': {
      const children = Array.isArray(raw.children) ? (raw.children as RawNode[]) : [];
      return { ...base, kind: 'parallel', children: children.map((c) => coerceNode(c, nextId)) };
    }
    default:
      // 未知 kind：保留为 instant 会掩盖问题，改为构造一个必然过不了校验的节点。
      return { ...base, kind: String(raw.kind ?? '') } as unknown as FlowNode;
  }
}

/** 把模型输出解析为合法 Flow；任何问题都以结果值返回（不抛错），便于 UI 呈现。 */
export function parseGeneratedFlow(text: string, opts: { id: string }): GenerateResult {
  const json = extractJson(text);
  if (!json) return { ok: false, error: '模型输出中找不到 JSON 对象' };

  let payload: {
    title?: unknown;
    description?: unknown;
    topology?: unknown;
    nodes?: unknown;
  };
  try {
    payload = JSON.parse(json) as typeof payload;
  } catch {
    return { ok: false, error: '模型输出不是合法 JSON，请重试' };
  }

  let counter = 0;
  const nextId = (): string => `n${++counter}`;
  const rawNodes = Array.isArray(payload.nodes) ? (payload.nodes as RawNode[]) : [];

  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    title: typeof payload.title === 'string' ? payload.title : '',
    ...(typeof payload.description === 'string' && payload.description
      ? { description: payload.description }
      : {}),
    topology: payload.topology as Topology,
    nodes: rawNodes.map((n) => coerceNode(n, nextId)),
  };

  const issues = validateFlow(flow);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join('；');
    return { ok: false, error: `生成的 flow 未通过校验：${detail}`, issues };
  }
  return { ok: true, flow };
}

/** 编排：描述 → 模型 → 解析校验 → 带来源标注的 Flow 草稿（E6）。 */
export async function generateFlow(
  port: ModelPort,
  description: string,
  opts: { id: string },
): Promise<GenerateResult> {
  const res = await port.complete(buildGenerationRequest(description));
  const parsed = parseGeneratedFlow(res.text, opts);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    flow: { ...parsed.flow, provenance: { source: `ai:${port.id}` } },
  };
}
