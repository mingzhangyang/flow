// AI 能力①：解释一个 Flow（AI-C4 的第一优先级——先理解）。
// 纯函数、确定性、离线。把结构 + 时间 + rationale 组织成人类可读的说明。
// 这是“解释器”版本：不调用任何外部模型；将来接入真实模型时，这里是它要达到或超过的基线。

import { type Flow, type FlowNode } from '../domain/types';
import { describeRecurrence } from '../runtime/recurrence';

export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} 秒`;
  if (r === 0) return `${m} 分`;
  return `${m} 分 ${r} 秒`;
}

function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 一个节点的一句话说明（含“为什么”）。 */
function describeNode(node: FlowNode, index: number): string {
  let meta = '';
  switch (node.kind) {
    case 'timed':
      meta = `（计时 ${fmtDuration(node.durationSec)}）`;
      break;
    case 'gate':
      meta = '（需确认）';
      break;
    case 'instant':
      meta = '（即时）';
      break;
    case 'scheduled':
      meta = `（${describeRecurrence(node.repeat)} ${fmtClock(node.at)}）`;
      break;
    case 'parallel':
      meta = `（并行 ${node.children.length} 项）`;
      break;
  }
  const why = node.rationale ? ` —— 因为${node.rationale}` : '';
  return `${index + 1}. ${node.label || '（未命名）'}${meta}${why}`;
}

/** 顺序型中所有计时步的总时长（秒）。 */
export function totalTimedSeconds(flow: Flow): number {
  return flow.nodes.reduce((sum, n) => sum + (n.kind === 'timed' ? n.durationSec : 0), 0);
}

/** 返回若干段说明文本。 */
export function explain(flow: Flow): string[] {
  const lines: string[] = [];
  const isSeq = flow.topology === 'sequential';
  const unit = isSeq ? '步' : '个定时事件';

  lines.push(`「${flow.title || '未命名'}」是一条${isSeq ? '顺序型' : '日程型'} flow，共 ${flow.nodes.length} ${unit}。`);
  if (flow.description) lines.push(flow.description);

  if (isSeq) {
    const total = totalTimedSeconds(flow);
    const gates = flow.nodes.filter((n) => n.kind === 'gate').length;
    if (total > 0) lines.push(`预计计时约 ${fmtDuration(total)}（不含手动操作与确认等待的时间）。`);
    if (gates > 0) lines.push(`其中有 ${gates} 处需要你确认后才继续。`);
  } else {
    const scheduled = flow.nodes.filter(
      (n): n is Extract<FlowNode, { kind: 'scheduled' }> => n.kind === 'scheduled',
    );
    const times = scheduled.map((n) => fmtClock(n.at)).sort();
    const allDaily = scheduled.every((n) => n.repeat.kind === 'daily');
    if (times.length > 0) {
      const prefix = allDaily ? '每天在这些时间提醒' : '将在这些时间提醒（重复方式见各条）';
      lines.push(`${prefix}：${times.join('、')}。各事件相互独立，漏一次不影响其它。`);
    }
  }

  lines.push('步骤：');
  flow.nodes.forEach((n, i) => lines.push(describeNode(n, i)));
  return lines;
}
