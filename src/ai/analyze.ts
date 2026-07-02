// AI 能力②③：优化建议与找瓶颈（AI-C4）。纯函数、确定性、离线。
// 只“指出与解释”，不擅自改动用户的 flow（AI-C1：AI 负责生成建议，用户负责决定）。
// 语言显式注入（locale，同 E3 思路）。

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

export function analyze(flow: Flow, locale: Locale): Finding[] {
  const zh = locale === 'zh';
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
          title: zh ? '存在明显瓶颈' : 'A clear bottleneck',
          detail: zh
            ? `「${longest.label}」占了总计时的 ${share}%（${fmtDuration(longest.durationSec, locale)}）。如果想缩短总时长，先从这一步入手。`
            : `"${longest.label}" takes ${share}% of the total timed duration (${fmtDuration(longest.durationSec, locale)}). To shorten the flow, start there.`,
        });
      }
    }

    if (total >= 30 * 60) {
      findings.push({
        id: 'long-total',
        severity: 'info',
        title: zh ? '总时长较长' : 'Total duration is long',
        detail: zh
          ? `预计计时约 ${fmtDuration(total, locale)}，考虑是否有可并行或可省略的步骤。`
          : `Estimated timed duration ≈ ${fmtDuration(total, locale)}; consider whether any steps can run in parallel or be dropped.`,
      });
    }

    if (flow.nodes.length >= 5 && flow.nodes.every((n) => n.kind !== 'gate')) {
      findings.push({
        id: 'no-gate',
        severity: 'info',
        title: zh ? '全程没有确认点' : 'No confirmation points',
        detail: zh
          ? '较长的流程里加入一两个“需确认”的节点，可以在关键处停下来核对。'
          : 'In a longer flow, one or two "confirm" nodes let you stop and double-check at key moments.',
      });
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
        findings.push({
          id: `close-${i}`,
          severity: 'warn',
          title: zh ? '两次提醒间隔很近' : 'Two reminders are very close',
          detail: zh
            ? `有两次提醒相隔不到 30 分钟，确认是否符合预期。`
            : 'Two reminders are less than 30 minutes apart — check that this is intended.',
        });
        break;
      }
    }
  }

  if (missingWhy > 0) {
    findings.push({
      id: 'missing-why',
      severity: 'info',
      title: zh
        ? `有 ${missingWhy} 步没有写“为什么”`
        : `${missingWhy} ${missingWhy === 1 ? 'step has' : 'steps have'} no "why"`,
      detail: zh
        ? '补上“为什么”，能让未来的自己或别人更容易理解这条 flow（Flow 是知识，不只是配置）。'
        : 'Adding the "why" helps future you — and others — understand this flow (a flow is knowledge, not just configuration).',
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}
