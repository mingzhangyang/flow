// 时钟层。宪章 E3：时钟是显式输入，绝不隐读环境。
// 本层（以及 domain / runtime）永远不调用 Date.now()——调用方注入当前 Instant。
// 这正是让 Run 可重放、可验证（E4）的前提：给定同样的注入时钟，必得同样的结果。

/** 一个时间点，Unix 毫秒（UTC）。 */
export type Instant = number;

/** 一天中的时刻，自本地午夜起的分钟数，取值 [0, 1440)。 */
export type TimeOfDay = number;

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/**
 * 在给定时区偏移下，取某个 Instant 的本地时刻（自午夜起的分钟数）。
 * 时区是显式输入（E3），绝不从宿主环境读取。
 * @param tzOffsetMinutes 由 UTC 加到本地所需的分钟数，例如东八区为 +480。
 */
export function timeOfDay(at: Instant, tzOffsetMinutes: number): TimeOfDay {
  const localMs = at + tzOffsetMinutes * MS_PER_MINUTE;
  const mod = ((localMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(mod / MS_PER_MINUTE);
}

/** 包含 `at` 的那个本地日的午夜（本地 00:00）所对应的 Instant。 */
export function localMidnight(at: Instant, tzOffsetMinutes: number): Instant {
  const offsetMs = tzOffsetMinutes * MS_PER_MINUTE;
  const localMs = at + offsetMs;
  const midnightLocalMs = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  return midnightLocalMs - offsetMs;
}
