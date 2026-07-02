// 时钟层。宪章 E3：时钟是显式输入，绝不隐读环境。
// 本层（以及 domain / runtime）永远不调用 Date.now()——调用方注入当前 Instant。
// 这正是让 Run 可重放、可验证（E4）的前提：给定同样的注入时钟，必得同样的结果。
//
// 时区同样是显式输入。为了正确跨越 DST（夏令时）切换日，时区不再只是一个固定
// 偏移标量，而是一个「偏移随时刻变化」的函数（TimeZone）。固定偏移仍然兼容
// （number 即固定时区），因此确定性测试不受影响。

/** 一个时间点，Unix 毫秒（UTC）。 */
export type Instant = number;

/** 一天中的时刻，自本地午夜起的分钟数，取值 [0, 1440)。 */
export type TimeOfDay = number;

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** 时区：给定时刻，返回该时刻本地相对 UTC 的偏移（分钟，东为正）。DST 即偏移的阶跃。 */
export interface TimeZone {
  offsetAt(at: Instant): number;
}

/** 时区参数：固定偏移标量（如东八区 +480），或随时刻变化的 TimeZone。 */
export type TimeZoneLike = number | TimeZone;

/** 固定偏移时区（无 DST）。 */
export function fixedTimeZone(offsetMinutes: number): TimeZone {
  return { offsetAt: () => offsetMinutes };
}

export function asTimeZone(tz: TimeZoneLike): TimeZone {
  return typeof tz === 'number' ? fixedTimeZone(tz) : tz;
}

/** at 在本地毫秒轴上的位置（用该时刻的偏移换算）。 */
function localMs(at: Instant, tz: TimeZone): number {
  return at + tz.offsetAt(at) * MS_PER_MINUTE;
}

/** 在给定时区下，取某个 Instant 的本地时刻（自午夜起的分钟数）。 */
export function timeOfDay(at: Instant, tzLike: TimeZoneLike): TimeOfDay {
  const tz = asTimeZone(tzLike);
  const mod = ((localMs(at, tz) % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(mod / MS_PER_MINUTE);
}

/**
 * anchor 所在本地日中，墙钟时刻 tod 对应的 Instant（DST 正确）。
 * 切换日的两种边界情形有确定语义：
 * - 春令时被跳过的时刻（如 02:30 不存在）→ 返回切换后的第一个时刻（本地时间首次 ≥ 目标）；
 * - 秋令时出现两次的时刻 → 返回第一次出现。
 */
export function instantAtTimeOfDay(anchor: Instant, tod: TimeOfDay, tzLike: TimeZoneLike): Instant {
  const tz = asTimeZone(tzLike);
  const dayStartLocal = Math.floor(localMs(anchor, tz) / MS_PER_DAY) * MS_PER_DAY;
  const targetLocal = dayStartLocal + tod * MS_PER_MINUTE;

  // 求不动点 g = targetLocal - offset(g)。偏移是阶跃函数，迭代至多在两个候选间往返。
  const iterates: Instant[] = [];
  let g = targetLocal - tz.offsetAt(anchor) * MS_PER_MINUTE;
  for (let i = 0; i < 4; i++) {
    if (!iterates.includes(g)) iterates.push(g);
    g = targetLocal - tz.offsetAt(g) * MS_PER_MINUTE;
  }

  const hits = iterates.filter((c) => localMs(c, tz) === targetLocal);
  if (hits.length > 0) {
    let best = Math.min(...hits);
    // 秋令时回拨：同一墙钟时刻出现两次，取更早那次。切换幅度 ≤ 2 小时，
    // 采样 3 小时前的偏移必落在切换之前，用它构造「前一侧」候选并验证。
    const earlier = targetLocal - tz.offsetAt(best - 180 * MS_PER_MINUTE) * MS_PER_MINUTE;
    if (earlier < best && localMs(earlier, tz) === targetLocal) best = earlier;
    return best;
  }

  // 无命中 ⇒ 目标时刻被春令时跳过。两个候选分居切换两侧，二分找切换点，
  // 切换点本身即当天第一个本地时间 ≥ 目标的时刻。
  let lo = Math.min(...iterates);
  let hi = Math.max(...iterates);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (tz.offsetAt(mid) === tz.offsetAt(lo)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** 包含 `at` 的那个本地日的开始时刻（通常是本地 00:00；若午夜被跳过则是当天第一个时刻）。 */
export function localMidnight(at: Instant, tzLike: TimeZoneLike): Instant {
  return instantAtTimeOfDay(at, 0, tzLike);
}
