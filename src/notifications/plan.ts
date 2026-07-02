// 通知规划：纯函数，把「Flow + 状态 + now」算成一组待排的提醒。
// 与运行时一样，时钟显式注入（E3），结果确定、可测。真正的下发交给 Notifier 适配器。

import { type Flow, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant, type TimeZoneLike } from '../runtime/clock';
import { project, upcomingEvents } from '../runtime/engine';

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
  locale: Locale,
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
    body: locale === 'zh' ? `“${node.label}”计时完成` : `"${node.label}" — time's up`,
  };
}

/**
 * 日程型：未来 horizon 内每个 scheduled 事件的**全部**触发（可跨多日，各自独立）。
 * 多日排入让 App 几天不被打开时提醒也不断档（C5）；id 含触发时刻，同一节点的
 * 不同日提醒互不覆盖（Notifier 的「同 id 视为替换」语义保持可用）。
 */
export function planScheduledReminders(
  flow: Flow,
  now: Instant,
  tz: TimeZoneLike,
  horizonMs: number,
): Reminder[] {
  return upcomingEvents(flow, now, tz, horizonMs).map((o) => ({
    id: `${flow.id}:${o.nodeId}:${o.at}`,
    at: o.at,
    title: flow.title,
    body: o.label,
  }));
}

/**
 * 多条日程型 flow 的合并计划：各自按注入时区展开，全体按时间排序后截断到 cap。
 * cap 对应平台的待决通知上限（iOS 为 64）——最近的提醒优先，远期的等下次重排再补。
 */
export function planScheduledBatch(
  entries: ReadonlyArray<{ flow: Flow; tz: TimeZoneLike }>,
  now: Instant,
  horizonMs: number,
  cap: number,
): Reminder[] {
  const all = entries.flatMap((e) => planScheduledReminders(e.flow, now, e.tz, horizonMs));
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return all.slice(0, cap);
}
