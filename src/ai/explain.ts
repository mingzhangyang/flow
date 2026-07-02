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
  if (locale === 'en') {
    if (m === 0) return `${r} sec`;
    if (r === 0) return `${m} min`;
    return `${m} min ${r} sec`;
  }
  // 简繁同形：分 / 秒
  if (m === 0) return `${r} 秒`;
  if (r === 0) return `${m} 分`;
  return `${m} 分 ${r} 秒`;
}

function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface ExplainText {
  overview: (title: string, isSeq: boolean, n: number) => string;
  timedTotal: (dur: string) => string;
  gates: (n: number) => string;
  reminders: (cadence: string, times: string[]) => string;
  stepsHeading: string;
  unnamed: string;
  because: (rationale: string) => string;
  metaTimed: (dur: string) => string;
  metaGate: string;
  metaInstant: string;
  metaScheduled: (clock: string) => string;
  metaParallel: (n: number) => string;
}

const TEXT: Record<Locale, ExplainText> = {
  zh: {
    overview: (title, isSeq, n) =>
      `「${title || '未命名'}」是一条${isSeq ? '顺序型' : '日程型'} flow，共 ${n} ${isSeq ? '步' : '个定时事件'}。`,
    timedTotal: (dur) => `预计计时约 ${dur}（不含手动操作与确认等待的时间）。`,
    gates: (n) => `其中有 ${n} 处需要你确认后才继续。`,
    reminders: (cadence, times) =>
      `${cadence}在这些时间提醒：${times.join('、')}。各事件相互独立，漏一次不影响其它。`,
    stepsHeading: '步骤：',
    unnamed: '（未命名）',
    because: (r) => ` —— 因为${r}`,
    metaTimed: (dur) => `（计时 ${dur}）`,
    metaGate: '（需确认）',
    metaInstant: '（即时）',
    metaScheduled: (clock) => `（${clock}）`,
    metaParallel: (n) => `（并行 ${n} 项）`,
  },
  'zh-Hant': {
    overview: (title, isSeq, n) =>
      `「${title || '未命名'}」是一條${isSeq ? '順序型' : '日程型'} flow，共 ${n} ${isSeq ? '步' : '個定時事件'}。`,
    timedTotal: (dur) => `預計計時約 ${dur}（不含手動操作與確認等待的時間）。`,
    gates: (n) => `其中有 ${n} 處需要你確認後才繼續。`,
    reminders: (cadence, times) =>
      `${cadence}在這些時間提醒：${times.join('、')}。各事件相互獨立，漏一次不影響其它。`,
    stepsHeading: '步驟：',
    unnamed: '（未命名）',
    because: (r) => ` —— 因為${r}`,
    metaTimed: (dur) => `（計時 ${dur}）`,
    metaGate: '（需確認）',
    metaInstant: '（即時）',
    metaScheduled: (clock) => `（${clock}）`,
    metaParallel: (n) => `（並行 ${n} 項）`,
  },
  en: {
    overview: (title, isSeq, n) => {
      const unit = n === 1 ? (isSeq ? 'step' : 'timed event') : isSeq ? 'steps' : 'timed events';
      return `"${title || 'Untitled'}" is a ${isSeq ? 'sequential' : 'scheduled'} flow with ${n} ${unit}.`;
    },
    timedTotal: (dur) => `Estimated timed duration ≈ ${dur} (excluding manual steps and confirmations).`,
    gates: (n) => `${n} ${n === 1 ? 'step waits' : 'steps wait'} for your confirmation before continuing.`,
    reminders: (cadence, times) =>
      `Reminders (${cadence}) at: ${times.join(', ')}. Each event is independent — missing one doesn't affect the others.`,
    stepsHeading: 'Steps:',
    unnamed: '(unnamed)',
    because: (r) => ` — because ${r}`,
    metaTimed: (dur) => ` (timed ${dur})`,
    metaGate: ' (needs confirmation)',
    metaInstant: ' (instant)',
    metaScheduled: (clock) => ` (${clock})`,
    metaParallel: (n) => ` (${n} in parallel)`,
  },
};

/** 一个节点的一句话说明（含“为什么”）。 */
function describeNode(node: FlowNode, index: number, locale: Locale): string {
  const t = TEXT[locale];
  let meta = '';
  switch (node.kind) {
    case 'timed':
      meta = t.metaTimed(fmtDuration(node.durationSec, locale));
      break;
    case 'gate':
      meta = t.metaGate;
      break;
    case 'instant':
      meta = t.metaInstant;
      break;
    case 'scheduled':
      meta = t.metaScheduled(fmtClock(node.at));
      break;
    case 'parallel':
      meta = t.metaParallel(node.children.length);
      break;
  }
  const why = node.rationale ? t.because(node.rationale) : '';
  return `${index + 1}. ${node.label || t.unnamed}${meta}${why}`;
}

/** 顺序型中所有计时步的总时长（秒）。 */
export function totalTimedSeconds(flow: Flow): number {
  return flow.nodes.reduce((sum, n) => sum + (n.kind === 'timed' ? n.durationSec : 0), 0);
}

/** 返回若干段说明文本。 */
export function explain(flow: Flow, locale: Locale): string[] {
  const t = TEXT[locale];
  const lines: string[] = [];
  const isSeq = flow.topology === 'sequential';

  lines.push(t.overview(flow.title, isSeq, flow.nodes.length));
  if (flow.description) lines.push(flow.description);

  if (isSeq) {
    const total = totalTimedSeconds(flow);
    const gates = flow.nodes.filter((n) => n.kind === 'gate').length;
    if (total > 0) lines.push(t.timedTotal(fmtDuration(total, locale)));
    if (gates > 0) lines.push(t.gates(gates));
  } else {
    const scheduled = flow.nodes.filter(
      (n): n is Extract<FlowNode, { kind: 'scheduled' }> => n.kind === 'scheduled',
    );
    const times = scheduled.map((n) => fmtClock(n.at)).sort();
    if (times.length > 0) {
      // 重复节律在 Flow 级（缺省 = 仅今天）
      const cadence = describeRecurrence(flow.repeat ?? { kind: 'once' }, locale);
      lines.push(t.reminders(cadence, times));
    }
  }

  lines.push(t.stepsHeading);
  flow.nodes.forEach((n, i) => lines.push(describeNode(n, i, locale)));
  return lines;
}
