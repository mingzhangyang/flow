// AI 能力②③：优化建议与找瓶颈（AI-C4）。纯函数、确定性、离线。
// 只“指出与解释”，不擅自改动用户的 flow（AI-C1：AI 负责生成建议，用户负责决定）。
// 语言显式注入（locale，同 E3 思路）；发现的 id 与语言无关，仅文案随 locale 变化。

import { type Flow } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { totalTimedSeconds, fmtDuration } from './explain';

export type Severity = 'info' | 'warn';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { warn: 0, info: 1 };

interface AnalyzeText {
  bottleneckTitle: string;
  bottleneckDetail: (label: string, share: number, dur: string) => string;
  longTotalTitle: string;
  longTotalDetail: (dur: string) => string;
  noGateTitle: string;
  noGateDetail: string;
  closeTitle: string;
  closeDetail: string;
  missingWhyTitle: (n: number) => string;
  missingWhyDetail: string;
}

const TEXT: Record<Locale, AnalyzeText> = {
  zh: {
    bottleneckTitle: '存在明显瓶颈',
    bottleneckDetail: (label, share, dur) =>
      `「${label}」占了总计时的 ${share}%（${dur}）。如果想缩短总时长，先从这一步入手。`,
    longTotalTitle: '总时长较长',
    longTotalDetail: (dur) => `预计计时约 ${dur}，考虑是否有可并行或可省略的步骤。`,
    noGateTitle: '全程没有确认点',
    noGateDetail: '较长的流程里加入一两个“需确认”的节点，可以在关键处停下来核对。',
    closeTitle: '两次提醒间隔很近',
    closeDetail: '有两次提醒相隔不到 30 分钟，确认是否符合预期。',
    missingWhyTitle: (n) => `有 ${n} 步没有写“为什么”`,
    missingWhyDetail: '补上“为什么”，能让未来的自己或别人更容易理解这条 flow（Flow 是知识，不只是配置）。',
  },
  'zh-Hant': {
    bottleneckTitle: '存在明顯瓶頸',
    bottleneckDetail: (label, share, dur) =>
      `「${label}」佔了總計時的 ${share}%（${dur}）。如果想縮短總時長，先從這一步入手。`,
    longTotalTitle: '總時長較長',
    longTotalDetail: (dur) => `預計計時約 ${dur}，考慮是否有可並行或可省略的步驟。`,
    noGateTitle: '全程沒有確認點',
    noGateDetail: '較長的流程裡加入一兩個「需確認」的節點，可以在關鍵處停下來核對。',
    closeTitle: '兩次提醒間隔很近',
    closeDetail: '有兩次提醒相隔不到 30 分鐘，確認是否符合預期。',
    missingWhyTitle: (n) => `有 ${n} 步沒有寫「為什麼」`,
    missingWhyDetail: '補上「為什麼」，能讓未來的自己或別人更容易理解這條 flow（Flow 是知識，不只是設定）。',
  },
  en: {
    bottleneckTitle: 'A clear bottleneck',
    bottleneckDetail: (label, share, dur) =>
      `"${label}" takes ${share}% of the total timed duration (${dur}). To shorten the flow, start there.`,
    longTotalTitle: 'Total duration is long',
    longTotalDetail: (dur) =>
      `Estimated timed duration ≈ ${dur}; consider whether any steps can run in parallel or be dropped.`,
    noGateTitle: 'No confirmation points',
    noGateDetail:
      'In a longer flow, one or two "confirm" nodes let you stop and double-check at key moments.',
    closeTitle: 'Two reminders are very close',
    closeDetail: 'Two reminders are less than 30 minutes apart — check that this is intended.',
    missingWhyTitle: (n) => `${n} ${n === 1 ? 'step has' : 'steps have'} no "why"`,
    missingWhyDetail:
      'Adding the "why" helps future you — and others — understand this flow (a flow is knowledge, not just configuration).',
  },
};

export function analyze(flow: Flow, locale: Locale): Finding[] {
  const t = TEXT[locale];
  const findings: Finding[] = [];
  const missingWhy = flow.nodes.filter((n) => !n.rationale).length;

  if (flow.topology === 'sequential') {
    const total = totalTimedSeconds(flow);
    const timed = flow.nodes.filter((n) => n.kind === 'timed');

    // 瓶颈：最长的计时步占了多大比例
    if (timed.length > 0 && total > 0) {
      const longest = timed.reduce((a, b) => (a.durationSec >= b.durationSec ? a : b));
      const share = Math.round((longest.durationSec / total) * 100);
      if (share >= 60) {
        findings.push({
          id: 'bottleneck',
          severity: 'warn',
          title: t.bottleneckTitle,
          detail: t.bottleneckDetail(longest.label, share, fmtDuration(longest.durationSec, locale)),
        });
      }
    }

    if (total >= 30 * 60) {
      findings.push({
        id: 'long-total',
        severity: 'info',
        title: t.longTotalTitle,
        detail: t.longTotalDetail(fmtDuration(total, locale)),
      });
    }

    if (flow.nodes.length >= 5 && flow.nodes.every((n) => n.kind !== 'gate')) {
      findings.push({ id: 'no-gate', severity: 'info', title: t.noGateTitle, detail: t.noGateDetail });
    }
  } else {
    // 日程型：相邻用药时间是否过近
    const times = flow.nodes
      .filter((n): n is Extract<typeof flow.nodes[number], { kind: 'scheduled' }> => n.kind === 'scheduled')
      .map((n) => n.at)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap < 30) {
        findings.push({ id: `close-${i}`, severity: 'warn', title: t.closeTitle, detail: t.closeDetail });
        break;
      }
    }
  }

  if (missingWhy > 0) {
    findings.push({
      id: 'missing-why',
      severity: 'info',
      title: t.missingWhyTitle(missingWhy),
      detail: t.missingWhyDetail,
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}
