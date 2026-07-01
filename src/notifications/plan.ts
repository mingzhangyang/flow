// 通知规划：纯函数，把「Flow + 状态 + now」算成一组待排的提醒。
// 与运行时一样，时钟显式注入（E3），结果确定、可测。真正的下发交给 Notifier 适配器。

import { type Flow, type RunEvent } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { project, nextEvents } from '../runtime/engine';

export interface Reminder {
  id: string;
  at: Instant;
  title: string;
  body: string;
}

/**
 * 顺序型：若当前是计时步且尚未到点，返回其结束时刻的提醒；否则 null。
 * 这样即使 App 退到后台，计时结束也能被提醒（C5）。
 */
export function planSequentialReminder(
  flow: Flow,
  events: RunEvent[],
  now: Instant,
  runId: string,
): Reminder | null {
  if (flow.topology !== 'sequential') return null;
  const s = project(flow, events, now);
  if (s.status !== 'running') return null;
  const node = flow.nodes[s.currentIndex];
  if (node.kind !== 'timed' || s.remainingSec <= 0) return null;
  return {
    id: runId, // 每个运行实例仅保留一个“下一步计时”提醒，便于替换/取消
    at: now + s.remainingSec * 1000,
    title: flow.title,
    body: `“${node.label}”计时完成`,
  };
}

/** 日程型：未来 horizon 内每个 scheduled 事件的提醒（各自独立）。 */
export function planScheduledReminders(
  flow: Flow,
  now: Instant,
  tzOffsetMinutes: number,
  horizonMs: number,
): Reminder[] {
  return nextEvents(flow, now, tzOffsetMinutes, horizonMs).map((o) => ({
    id: `${flow.id}:${o.nodeId}`,
    at: o.at,
    title: flow.title,
    body: o.label,
  }));
}
