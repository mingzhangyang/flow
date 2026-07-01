// AI 能力②③：优化建议与找瓶颈（AI-C4）。纯函数、确定性、离线。
// 只“指出与解释”，不擅自改动用户的 flow（AI-C1：AI 负责生成建议，用户负责决定）。

import { type Flow } from '../domain/types';
import { totalTimedSeconds, fmtDuration } from './explain';

export type Severity = 'info' | 'warn';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { warn: 0, info: 1 };

export function analyze(flow: Flow): Finding[] {
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
          title: '存在明显瓶颈',
          detail: `「${longest.label}」占了总计时的 ${share}%（${fmtDuration(longest.durationSec)}）。如果想缩短总时长，先从这一步入手。`,
        });
      }
    }

    if (total >= 30 * 60) {
      findings.push({ id: 'long-total', severity: 'info', title: '总时长较长', detail: `预计计时约 ${fmtDuration(total)}，考虑是否有可并行或可省略的步骤。` });
    }

    if (flow.nodes.length >= 5 && flow.nodes.every((n) => n.kind !== 'gate')) {
      findings.push({ id: 'no-gate', severity: 'info', title: '全程没有确认点', detail: '较长的流程里加入一两个“需确认”的节点，可以在关键处停下来核对。' });
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
        findings.push({ id: `close-${i}`, severity: 'warn', title: '两次提醒间隔很近', detail: `有两次提醒相隔不到 30 分钟，确认是否符合预期。` });
        break;
      }
    }
  }

  if (missingWhy > 0) {
    findings.push({
      id: 'missing-why',
      severity: 'info',
      title: `有 ${missingWhy} 步没有写“为什么”`,
      detail: '补上“为什么”，能让未来的自己或别人更容易理解这条 flow（Flow 是知识，不只是配置）。',
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}
