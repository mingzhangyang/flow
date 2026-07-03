// 通知规划：纯函数，把「Flow + 状态 + now」算成一组待排的提醒。
// 与运行时一样，时钟显式注入（E3），结果确定、可测。真正的下发交给 Notifier 适配器。

import { type Flow, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import {
  type Instant,
  type TimeZoneLike,
  timeOfDay,
  localDayIndex,
  weekdayOfDayIndex,
  MS_PER_DAY,
} from '../runtime/clock';
import { project, upcomingEvents } from '../runtime/engine';

/**
 * 系统级重复触发器（按**设备墙钟**的时/分表达；weekday 同 JS getDay，0=周日）。
 * 交给 OS 长期重复——App 几周不开提醒也不断档，这是有限预排窗口做不到的。
 * 只用于跟随设备时区的 flow：锚定非设备时区（Flow.timeZone）的墙钟时刻
 * 无法用设备墙钟的重复规则表达，仍走多日预排。
 */
export type ReminderRepeat =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number };

export interface Reminder {
  id: string;
  /** 下一次触发时刻。带 repeat 时仅作排序/展示参考，长期重复由 repeat 表达。 */
  at: Instant;
  title: string;
  body: string;
  repeat?: ReminderRepeat;
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
  const body: Record<Locale, string> = {
    zh: `“${node.label}”计时完成`,
    'zh-Hant': `「${node.label}」計時完成`,
    en: `"${node.label}" — time's up`,
  };
  return {
    id: runId, // 每个运行实例仅保留一个“下一步计时”提醒，便于替换/取消
    at: now + s.remainingSec * 1000,
    title: flow.title,
    body: body[locale],
  };
}

/**
 * 日程型提醒计划。两种形态：
 * - **重复触发器**（repeatingTriggers=true 且节律为 daily/weekly）：每个「节点 × 星期槽位」
 *   一条带 repeat 的提醒，交给系统长期重复——App 几周不开也不断档（C5）。id 稳定
 *   （…:daily / …:w3），重排即同 id 替换。
 * - **多日预排窗口**（其余：once / everyNDays / 锚定非设备时区）：未来 horizon 内每个
 *   scheduled 事件的全部触发（可跨多日，各自独立）；id 含触发时刻，同一节点的
 *   不同日提醒互不覆盖。
 */
export function planScheduledReminders(
  flow: Flow,
  now: Instant,
  tz: TimeZoneLike,
  horizonMs: number,
  opts?: { repeatingTriggers?: boolean },
): Reminder[] {
  const repeat = flow.repeat;
  if (opts?.repeatingTriggers && (repeat?.kind === 'daily' || repeat?.kind === 'weekly')) {
    // 未来 7 天内每个「节点 × 星期」槽位恰好出现一次：一趟展开即枚举全部重复槽位，
    // 且每条的 at 就是该槽位的下一次触发（墙钟换算沿用 instantAtTimeOfDay，DST 语义一致）。
    const seen = new Set<string>();
    const reminders: Reminder[] = [];
    for (const o of upcomingEvents(flow, now, tz, 7 * MS_PER_DAY)) {
      const weekday = weekdayOfDayIndex(localDayIndex(o.at, tz));
      const key = repeat.kind === 'daily' ? `${o.nodeId}:daily` : `${o.nodeId}:w${weekday}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const minutes = timeOfDay(o.at, tz);
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      reminders.push({
        id: `${flow.id}:${key}`,
        at: o.at,
        title: flow.title,
        body: o.label,
        repeat:
          repeat.kind === 'daily'
            ? { kind: 'daily', hour, minute }
            : { kind: 'weekly', weekday, hour, minute },
      });
    }
    return reminders;
  }

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
 * 重复触发器条目每槽位仅 1 条且下一次触发都在近期，天然排在前、几乎不会被截掉。
 */
export function planScheduledBatch(
  entries: ReadonlyArray<{ flow: Flow; tz: TimeZoneLike; repeatingTriggers?: boolean }>,
  now: Instant,
  horizonMs: number,
  cap: number,
): Reminder[] {
  const all = entries.flatMap((e) =>
    planScheduledReminders(e.flow, now, e.tz, horizonMs, { repeatingTriggers: e.repeatingTriggers ?? false }),
  );
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return all.slice(0, cap);
}
