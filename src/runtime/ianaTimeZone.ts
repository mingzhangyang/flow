// IANA 时区适配器：按时区名（如 "Asia/Shanghai"、"America/New_York"）实现 TimeZone。
// 给定名字与时刻，偏移由 IANA 时区数据库唯一确定——确定性、可在 node 测试中直接验证，
// 因此不违反 E3：时区名依然是显式注入的输入，这里只是把「名字 → 偏移函数」翻译出来。

import type { Instant, TimeZone } from './clock';
import { MS_PER_MINUTE } from './clock';

/** 时区名是否为宿主认识的 IANA 名。 */
export function isValidTimeZoneName(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** 由 IANA 名构造 TimeZone；名字无效时抛错（调用方在输入边界校验，见 isValidTimeZoneName）。 */
export function ianaTimeZone(name: string): TimeZone {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: name, // 无效名在此抛 RangeError，尽早失败
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const offsetAt = (at: Instant): number => {
    const parts = fmt.formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    // 把「该时区的本地钟面」当作 UTC 重组，与真实时刻之差即偏移。
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - at) / MS_PER_MINUTE);
  };

  return { offsetAt };
}

/**
 * 一个 Flow 应使用的时区：锚定了 timeZone（IANA 名）则按锚定时区，
 * 否则回退（通常传设备时区）。名字无效也回退——导入的坏数据不应让界面崩溃。
 */
export function timeZoneForFlow(flow: { timeZone?: string }, fallback: TimeZone): TimeZone {
  if (!flow.timeZone) return fallback;
  try {
    return ianaTimeZone(flow.timeZone);
  } catch {
    return fallback;
  }
}
