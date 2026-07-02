// 重复规则的纯逻辑：某条规则在某个本地日是否发生 + 人类可读的描述。
// 供 engine（排下一次触发）与 adherence（今日清单过滤）共用；时区显式注入（E3）。

import { type Recurrence } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant, type TimeZoneLike, localDayIndex, weekdayOfDayIndex } from './clock';

/**
 * repeat 是否发生在 anchor 所在的本地日。
 * once 恒为 true：它的语义是「仅今天这一次」——发生在“被询问的那一天”，
 * 但只发生一次由 engine 保证（不排未来的日子）。
 */
export function occursOnDay(repeat: Recurrence, anchor: Instant, tz: TimeZoneLike): boolean {
  switch (repeat.kind) {
    case 'once':
    case 'daily':
      return true;
    case 'weekly':
      return repeat.days.includes(weekdayOfDayIndex(localDayIndex(anchor, tz)));
    case 'everyNDays': {
      const diff = localDayIndex(anchor, tz) - repeat.fromDay;
      return ((diff % repeat.n) + repeat.n) % repeat.n === 0;
    }
  }
}

const WEEKDAY_NAMES: Record<Locale, string[]> = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** 重复方式的一句话描述（编辑器与解读共用）。语言显式注入（同 E3 思路）。 */
export function describeRecurrence(repeat: Recurrence, locale: Locale): string {
  const days = (ds: number[]): string =>
    [...ds].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[locale][d]).join(locale === 'zh' ? '、' : ', ');
  switch (repeat.kind) {
    case 'once':
      return locale === 'zh' ? '仅今天' : 'today only';
    case 'daily':
      return locale === 'zh' ? '每天' : 'every day';
    case 'weekly':
      return locale === 'zh' ? `每周${days(repeat.days)}` : `weekly on ${days(repeat.days)}`;
    case 'everyNDays':
      if (locale === 'zh') return repeat.n === 2 ? '隔天' : `每 ${repeat.n} 天`;
      return repeat.n === 2 ? 'every other day' : `every ${repeat.n} days`;
  }
}
