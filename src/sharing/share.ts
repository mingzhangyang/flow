// 分享（社交面）的纯逻辑：把一条 Flow 组装成「给人读的文案 + 可导入的数据」。
// 分享的是知识而不是运行状态（01-domain-model.md）；开放格式（C6/E5）；
// 来源标注与医疗免责（E6）。真正的发送交给 Sharer 端口的适配器。

import { type Flow } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { explain } from '../ai/explain';

/** 分享数据里 App 的来源标记（E6 provenance.source）。 */
export const SHARE_SOURCE = 'zhunshi';

/** 分享文案里，人读部分与数据部分的分界线。导入端据此提取。 */
export const DATA_DIVIDER = '——以下是可导入「准时」的 flow 数据——';

const MEDICAL_DISCLAIMER = '⚠️ 以上仅描述分享者自己的安排，不构成医疗处方或诊断；涉及用药请遵医嘱。';

/**
 * 出口前给 Flow 盖来源章：署名（可选）+ App 来源标记。
 * 不改动原对象（Flow 不可变）；已有 provenance 字段按需合并。
 */
export function buildSharePayload(flow: Flow, opts: { author?: string } = {}): Flow {
  const author = opts.author?.trim();
  return {
    ...flow,
    provenance: {
      ...(flow.provenance ?? {}),
      ...(author ? { author } : {}),
      source: flow.provenance?.source ?? SHARE_SOURCE,
    },
  };
}

/**
 * 组装完整分享文案：标题 → 解读（含每步的「为什么」，AI-C2）→ 免责（日程型）→ 数据。
 * 收到的人直接读懂做法；把全文粘贴进「准时」的导入框即可收下这条 flow。
 */
export function buildShareText(flow: Flow, opts: { author?: string } = {}): string {
  const payload = buildSharePayload(flow, opts);
  const lines: string[] = [];

  lines.push(`《${flow.title || '未命名'}》—— 来自「准时」的时间模式分享`);
  if (payload.provenance?.author) lines.push(`分享者：${payload.provenance.author}`);
  lines.push('');
  lines.push(...explain(flow));
  if (flow.topology === 'scheduled') {
    lines.push('');
    lines.push(MEDICAL_DISCLAIMER);
  }
  lines.push('');
  lines.push(DATA_DIVIDER);
  lines.push(serializeFlow(payload).trimEnd());
  return lines.join('\n');
}

/**
 * 从任意粘贴文本中提取 flow JSON：既接受纯 JSON，也接受整段分享文案。
 * 找不到或不是合法 JSON 时返回 null（校验与导入交给 library.importFlow）。
 */
export function extractFlowJson(text: string): string | null {
  // 含分界线时只在其后找数据——人读部分即使出现花括号也不干扰。
  const dividerAt = text.indexOf(DATA_DIVIDER);
  const scope = dividerAt >= 0 ? text.slice(dividerAt + DATA_DIVIDER.length) : text;
  const start = scope.indexOf('{');
  const end = scope.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = scope.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}
