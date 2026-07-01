// 动作层：把「用户意图 + 当前状态 + 注入的 now」翻译成一个 RunEvent（或 null 表示当前不适用）。
// 纯函数、可测试。时钟停留在 UI 边界（调用方传入 now），本层及以下永不隐读环境（E3）。
// UI 只需：event = 某动作(flow, events, now)；若非 null 则 reduce(run, event)。

import { type Flow, type RunEvent } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { project } from '../runtime/engine';

export function startAction(now: Instant): RunEvent {
  return { type: 'started', at: now };
}

/** 完成当前步：gate 节点记为确认，其余记为完成。 */
export function completeCurrentAction(flow: Flow, events: RunEvent[], now: Instant): RunEvent | null {
  const s = project(flow, events, now);
  if (s.status === 'idle' || s.status === 'completed') return null;
  const node = flow.nodes[s.currentIndex];
  if (node.kind === 'gate') return { type: 'gateConfirmed', index: s.currentIndex, at: now };
  return { type: 'stepCompleted', index: s.currentIndex, at: now };
}

export function skipCurrentAction(flow: Flow, events: RunEvent[], now: Instant): RunEvent | null {
  const s = project(flow, events, now);
  if (s.status === 'idle' || s.status === 'completed') return null;
  return { type: 'skipped', index: s.currentIndex, at: now };
}

export function pauseAction(flow: Flow, events: RunEvent[], now: Instant): RunEvent | null {
  const s = project(flow, events, now);
  if (s.status !== 'running') return null;
  return { type: 'paused', at: now };
}

export function resumeAction(flow: Flow, events: RunEvent[], now: Instant): RunEvent | null {
  const s = project(flow, events, now);
  if (s.status !== 'paused') return null;
  return { type: 'resumed', at: now };
}

/** 回到上一步（完成态则回到最后一步）。已在第一步或未开始时返回 null。 */
export function backAction(flow: Flow, events: RunEvent[], now: Instant): RunEvent | null {
  const s = project(flow, events, now);
  if (s.status === 'idle') return null;
  const target = s.status === 'completed' ? flow.nodes.length - 1 : s.currentIndex - 1;
  if (target < 0) return null;
  return { type: 'wentBack', toIndex: target, at: now };
}
