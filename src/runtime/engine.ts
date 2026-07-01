// Runtime 引擎。宪章 E1/E2/E3/E4：
//   - 纯函数、最小状态：状态由「Flow 定义 + Run 事件日志 + 注入的 now」推导，无隐式内存。
//   - 时钟显式注入：所有 now / tzOffset 都是参数，绝不隐读环境。
//   - 确定性：给定同样的输入，必得同样的输出（可重放、可验证）。

import { type Flow, type FlowNode, type Run, type RunEvent, type ScheduledNode } from '../domain/types.ts';
import { type Instant, localMidnight, MS_PER_DAY, MS_PER_MINUTE } from './clock.ts';

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed';

/** 某一时刻（now）下，一个顺序型 Run 的可观察状态。 */
export interface RunState {
  status: RunStatus;
  /** 当前节点下标；完成时等于 nodes.length。 */
  currentIndex: number;
  /** 当前计时节点已过去的秒数（暂停时冻结）。 */
  elapsedSec: number;
  /** 当前计时节点剩余的秒数（非计时节点为 0）。 */
  remainingSec: number;
  /** 当前节点是否在等待用户操作（gate、instant，或计时已到）。 */
  awaitingAction: boolean;
}

/**
 * 追加一个事件，返回新的 Run（纯函数，不改动入参）。
 * 非法转移会抛错，从而保证日志始终一致（E2/E4）。
 */
export function reduce(run: Run, event: RunEvent): Run {
  assertLegal(run, event);
  return { ...run, events: [...run.events, event] };
}

function assertLegal(run: Run, event: RunEvent): void {
  const hasStarted = run.events.some((e) => e.type === 'started');
  if (event.type === 'started' && hasStarted) throw new Error('run already started');
  if (event.type !== 'started' && !hasStarted) throw new Error('run not started');
}

// ---- 顺序型：把事件日志折叠为一个游标，再按 now 计算可观察状态 ----

interface Cursor {
  started: boolean;
  index: number;
  stepStartAt: Instant; // 当前步计时的起点
  pausedAccumMs: number; // 当前步内累计的暂停时长
  pausedAt: Instant | null; // 若当前处于暂停
  completed: boolean;
}

function foldSequential(flow: Flow, events: RunEvent[]): Cursor {
  const n = flow.nodes.length;
  const c: Cursor = {
    started: false,
    index: 0,
    stepStartAt: 0,
    pausedAccumMs: 0,
    pausedAt: null,
    completed: false,
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'started':
        c.started = true;
        enterStep(c, 0, ev.at);
        break;
      case 'stepCompleted':
      case 'skipped':
      case 'gateConfirmed':
        if (!c.completed && ev.index === c.index) {
          enterStep(c, c.index + 1, ev.at);
          if (c.index >= n) c.completed = true;
        }
        break;
      case 'paused':
        if (!c.completed && c.pausedAt === null) c.pausedAt = ev.at;
        break;
      case 'resumed':
        if (c.pausedAt !== null) {
          c.pausedAccumMs += ev.at - c.pausedAt;
          c.pausedAt = null;
        }
        break;
      case 'wentBack':
        enterStep(c, ev.toIndex, ev.at);
        break;
    }
  }
  return c;
}

function enterStep(c: Cursor, index: number, at: Instant): void {
  c.index = index;
  c.stepStartAt = at;
  c.pausedAccumMs = 0;
  c.pausedAt = null;
  c.completed = false;
}

const IDLE: RunState = {
  status: 'idle',
  currentIndex: 0,
  elapsedSec: 0,
  remainingSec: 0,
  awaitingAction: false,
};

/**
 * 推导某个 Run 在 now 时刻的可观察状态。
 * 日程型 Flow 不走线性游标——其“下一步”由 nextEvents() 表达，这里仅给出最小状态。
 */
export function project(flow: Flow, events: RunEvent[], now: Instant): RunState {
  if (flow.topology !== 'sequential') {
    return events.length > 0 ? { ...IDLE, status: 'running' } : IDLE;
  }

  const c = foldSequential(flow, events);
  if (!c.started) return IDLE;
  if (c.completed) {
    return { status: 'completed', currentIndex: flow.nodes.length, elapsedSec: 0, remainingSec: 0, awaitingAction: false };
  }

  const node = flow.nodes[c.index];
  const effectiveNow = c.pausedAt !== null ? c.pausedAt : now;
  const elapsedMs = Math.max(0, effectiveNow - c.stepStartAt - c.pausedAccumMs);
  const elapsedSec = Math.floor(elapsedMs / 1000);

  let remainingSec = 0;
  let awaitingAction = false;
  if (node.kind === 'timed') {
    remainingSec = Math.max(0, node.durationSec - elapsedSec);
    awaitingAction = remainingSec === 0; // 计时到点，等待用户确认进入下一步
  } else if (node.kind === 'gate' || node.kind === 'instant') {
    awaitingAction = true;
  }

  const status: RunStatus = c.pausedAt !== null ? 'paused' : 'running';
  return { status, currentIndex: c.index, elapsedSec, remainingSec, awaitingAction };
}

// ---- 日程型：计算即将到来的绝对时刻，供通知层调度 ----

export interface ScheduledOccurrence {
  nodeId: string;
  label: string;
  at: Instant;
}

/**
 * 计算 [now, now+horizonMs] 窗口内、每个 scheduled 节点的下一次触发时刻。
 * 结果与任何 Run 日志无关——各定时事件相互独立（漏一次不影响其它，见 01-domain-model.md §二）。
 */
export function nextEvents(
  flow: Flow,
  now: Instant,
  tzOffsetMinutes: number,
  horizonMs: number,
): ScheduledOccurrence[] {
  if (flow.topology !== 'scheduled') return [];

  const out: ScheduledOccurrence[] = [];
  for (const node of collectScheduled(flow.nodes)) {
    const at = nextOccurrence(node, now, tzOffsetMinutes);
    if (at !== null && at <= now + horizonMs) {
      out.push({ nodeId: node.id, label: node.label, at });
    }
  }
  out.sort((a, b) => a.at - b.at || (a.nodeId < b.nodeId ? -1 : 1));
  return out;
}

function collectScheduled(nodes: FlowNode[]): ScheduledNode[] {
  const acc: ScheduledNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'scheduled') acc.push(node);
    else if (node.kind === 'parallel') acc.push(...collectScheduled(node.children));
  }
  return acc;
}

function nextOccurrence(node: ScheduledNode, now: Instant, tzOffsetMinutes: number): Instant | null {
  const todayAt = localMidnight(now, tzOffsetMinutes) + node.at * MS_PER_MINUTE;
  if (node.repeat.kind === 'daily') {
    return todayAt >= now ? todayAt : todayAt + MS_PER_DAY;
  }
  // once：仅当今天该时刻仍在未来时
  return todayAt >= now ? todayAt : null;
}
