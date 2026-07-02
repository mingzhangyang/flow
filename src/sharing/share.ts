// 分享（社交面）的纯逻辑：把一条 Flow 组装成「给人读的文案 + 可导入的数据」。
// 分享的是知识而不是运行状态（01-domain-model.md）；开放格式（C6/E5）；
// 来源标注与医疗免责（E6）。真正的发送交给 Sharer 端口的适配器。
// 语言显式注入（locale）：人读部分按分享者的语言组织；数据部分语言无关，
// 导入端识别所有已知分界线——跨语言分享照样能收（C6）。

import { type Flow } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { serializeFlow } from '../domain/serialize';
import { explain } from '../ai/explain';

/** 分享数据里 App 的来源标记（E6 provenance.source）。 */
export const SHARE_SOURCE = 'zhunshi';

/** 分享文案里，人读部分与数据部分的分界线（按语言）。 */
export const DATA_DIVIDER = '——以下是可导入「准时」的 flow 数据——';
const DATA_DIVIDER_EN = '—— flow data for Zhunshi (paste the full text into the app to import) ——';

const DIVIDERS: Record<Locale, string> = { zh: DATA_DIVIDER, en: DATA_DIVIDER_EN };

/** 导入端认识的全部分界线（含历史与各语言版本——格式只能加法演进，E5）。 */
const KNOWN_DIVIDERS = [DATA_DIVIDER, DATA_DIVIDER_EN];

const MEDICAL_DISCLAIMER: Record<Locale, string> = {
  zh: '⚠️ 以上仅描述分享者自己的安排，不构成医疗处方或诊断；涉及用药请遵医嘱。',
  en: '⚠️ The above only describes the sharer\'s own arrangement. It is not a medical prescription or diagnosis; follow your clinician\'s advice on any medication.',
};

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
export function buildShareText(flow: Flow, opts: { author?: string; locale: Locale }): string {
  const { locale } = opts;
  const zh = locale === 'zh';
  const payload = buildSharePayload(flow, opts);
  const lines: string[] = [];

  lines.push(
    zh
      ? `《${flow.title || '未命名'}》—— 来自「准时」的时间模式分享`
      : `"${flow.title || 'Untitled'}" — a temporal pattern shared from Zhunshi`,
  );
  if (payload.provenance?.author) {
    lines.push(zh ? `分享者：${payload.provenance.author}` : `Shared by: ${payload.provenance.author}`);
  }
  lines.push('');
  lines.push(...explain(flow, locale));
  if (flow.topology === 'scheduled') {
    lines.push('');
    lines.push(MEDICAL_DISCLAIMER[locale]);
  }
  lines.push('');
  lines.push(DIVIDERS[locale]);
  lines.push(serializeFlow(payload).trimEnd());
  return lines.join('\n');
}

/** 某语言分享文案所用的分界线（ExportScreen 预览截断用）。 */
export function dataDivider(locale: Locale): string {
  return DIVIDERS[locale];
}

/**
 * 从任意粘贴文本中提取 flow JSON：既接受纯 JSON，也接受整段分享文案（任何语言）。
 * 找不到或不是合法 JSON 时返回 null（校验与导入交给 library.importFlow）。
 */
export function extractFlowJson(text: string): string | null {
  // 含已知分界线时只在其后找数据——人读部分即使出现花括号也不干扰。
  let scope = text;
  for (const divider of KNOWN_DIVIDERS) {
    const at = text.indexOf(divider);
    if (at >= 0) {
      scope = text.slice(at + divider.length);
      break;
    }
  }
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
