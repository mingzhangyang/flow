// UI 展示用的纯格式化函数。

import { type TimeOfDay } from '../runtime/clock';

/** 秒 → mm:ss。 */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 一天中的分钟数 → HH:mm。 */
export function fmtTimeOfDay(minutes: TimeOfDay): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
