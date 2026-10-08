// Calendar fields for an explicitly injected time zone, independent of device-local Date getters.
// Shared with UI projections; recurrence and notification scheduling are unchanged (E3/E4).
import { asTimeZone, type Instant, type TimeZoneLike, MS_PER_MINUTE } from './clock';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0=Sunday
}

export function calendarDateAt(at: Instant, tzLike: TimeZoneLike): CalendarDate {
  const tz = asTimeZone(tzLike);
  const wall = new Date(at + tz.offsetAt(at) * MS_PER_MINUTE);
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
  };
}
