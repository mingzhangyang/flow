// AI 能力①：解释一个 Flow（AI-C4 的第一优先级——先理解）。
// 纯函数、确定性、离线。把结构 + 时间 + rationale 组织成人类可读的说明。
// 这是“解释器”版本：不调用任何外部模型；将来接入真实模型时，这里是它要达到或超过的基线。
// 语言显式注入（locale，同 E3 思路）：同一 flow + 同一 locale 必得同一说明。

import { type Flow, type FlowNode } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { describeRecurrence } from '../runtime/recurrence';

export function fmtDuration(totalSec: number, locale: Locale): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (locale === 'zh') {
    if (m === 0) return `${r} 秒`;
    if (r === 0) return `${m} 分`;
    return `${m} 分 ${r} 秒`;
  }
  if (m === 0) return `${r} sec`;
  if (r === 0) return `${m} min`;
  return `${m} min ${r} sec`;
}

function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 一个节点的一句话说明（含“为什么”）。 */
function describeNode(node: FlowNode, index: number, locale: Locale): string {
  const zh = locale === 'zh';
  let meta = '';
  switch (node.kind) {
    case 'timed':
      meta = zh ? `（计时 ${fmtDuration(node.durationSec, locale)}）` : ` (timed ${fmtDuration(node.durationSec, locale)})`;
      break;
    case 'gate':
      meta = zh ? '（需确认）' : ' (needs confirmation)';
      break;
    case 'instant':
      meta = zh ? '（即时）' : ' (instant)';
      break;
    case 'scheduled':
      meta = zh ? `（${fmtClock(node.at)}）` : ` (${fmtClock(node.at)})`;
      break;
    case 'parallel':
      meta = zh ? `（并行 ${node.children.length} 项）` : ` (${node.children.length} in parallel)`;
      break;
  }
  const unnamed = zh ? '（未命名）' : '(unnamed)';
  const why = node.rationale ? (zh ? ` —— 因为${node.rationale}` : ` — because ${node.rationale}`) : '';
  return `${index + 1}. ${node.label || unnamed}${meta}${why}`;
}

/** 顺序型中所有计时步的总时长（秒）。 */
export function totalTimedSeconds(flow: Flow): number {
  return flow.nodes.reduce((sum, n) => sum + (n.kind === 'timed' ? n.durationSec : 0), 0);
}

/** 返回若干段说明文本。 */
export function explain(flow: Flow, locale: Locale): string[] {
  const zh = locale === 'zh';
  const lines: string[] = [];
  const isSeq = flow.topology === 'sequential';

  if (zh) {
    const unit = isSeq ? '步' : '个定时事件';
    lines.push(`「${flow.title || '未命名'}」是一条${isSeq ? '顺序型' : '日程型'} flow，共 ${flow.nodes.length} ${unit}。`);
  } else {
    const unit = flow.nodes.length === 1 ? (isSeq ? 'step' : 'timed event') : isSeq ? 'steps' : 'timed events';
    lines.push(`"${flow.title || 'Untitled'}" is a ${isSeq ? 'sequential' : 'scheduled'} flow with ${flow.nodes.length} ${unit}.`);
  }
  if (flow.description) lines.push(flow.description);

  if (isSeq) {
    const total = totalTimedSeconds(flow);
    const gates = flow.nodes.filter((n) => n.kind === 'gate').length;
    if (total > 0) {
      lines.push(
        zh
          ? `预计计时约 ${fmtDuration(total, locale)}（不含手动操作与确认等待的时间）。`
          : `Estimated timed duration ≈ ${fmtDuration(total, locale)} (excluding manual steps and confirmations).`,
      );
    }
    if (gates > 0) {
      lines.push(
        zh
          ? `其中有 ${gates} 处需要你确认后才继续。`
          : `${gates} ${gates === 1 ? 'step waits' : 'steps wait'} for your confirmation before continuing.`,
      );
    }
  } else {
    const scheduled = flow.nodes.filter(
      (n): n is Extract<FlowNode, { kind: 'scheduled' }> => n.kind === 'scheduled',
    );
    const times = scheduled.map((n) => fmtClock(n.at)).sort();
    if (times.length > 0) {
      // 重复节律在 Flow 级（缺省 = 仅今天）
      const cadence = describeRecurrence(flow.repeat ?? { kind: 'once' }, locale);
      lines.push(
        zh
          ? `${cadence}在这些时间提醒：${times.join('、')}。各事件相互独立，漏一次不影响其它。`
          : `Reminders (${cadence}) at: ${times.join(', ')}. Each event is independent — missing one doesn't affect the others.`,
      );
    }
  }

  lines.push(zh ? '步骤：' : 'Steps:');
  flow.nodes.forEach((n, i) => lines.push(describeNode(n, i, locale)));
  return lines;
}
