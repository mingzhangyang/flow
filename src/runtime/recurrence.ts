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

interface RecurrenceText {
  weekdays: string[];
  dayJoiner: string;
  once: string;
  daily: string;
  weekly: (days: string) => string;
  everyOther: string;
  everyN: (n: number) => string;
}

const TEXT: Record<Locale, RecurrenceText> = {
  zh: {
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    dayJoiner: '、',
    once: '仅今天',
    daily: '每天',
    weekly: (days) => `每周${days}`,
    everyOther: '隔天',
    everyN: (n) => `每 ${n} 天`,
  },
  'zh-Hant': {
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    dayJoiner: '、',
    once: '僅今天',
    daily: '每天',
    weekly: (days) => `每週${days}`,
    everyOther: '隔天',
    everyN: (n) => `每 ${n} 天`,
  },
  en: {
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dayJoiner: ', ',
    once: 'today only',
    daily: 'every day',
    weekly: (days) => `weekly on ${days}`,
    everyOther: 'every other day',
    everyN: (n) => `every ${n} days`,
  },
};

/** 重复方式的一句话描述（编辑器与解读共用）。语言显式注入（同 E3 思路）。 */
export function describeRecurrence(repeat: Recurrence, locale: Locale): string {
  const t = TEXT[locale];
  switch (repeat.kind) {
    case 'once':
      return t.once;
    case 'daily':
      return t.daily;
    case 'weekly':
      return t.weekly(
        [...repeat.days].sort((a, b) => a - b).map((d) => t.weekdays[d]).join(t.dayJoiner),
      );
    case 'everyNDays':
      return repeat.n === 2 ? t.everyOther : t.everyN(repeat.n);
  }
}
