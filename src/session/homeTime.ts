// Pure Home time projection. The UI supplies now and the device time zone (E3).
// Keep owned-scheduled precedence and the existing 24-hour Up Next visibility window.
import { type Flow } from '../domain/types';
import { nextEvents, type ScheduledOccurrence } from '../runtime/engine';
import { type TimeZone, localMidnight, MS_PER_DAY } from '../runtime/clock';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';

export interface HomeNext {
  flow: Flow;
  own: boolean;
  occ: ScheduledOccurrence;
}
export interface HomeTimeProjection {
  upNext: HomeNext | null;
  nextRefreshAt: number;
}

export function projectHomeTime(
  mine: Flow[], visibleExamples: Flow[], now: number, deviceTz: TimeZone,
): HomeTimeProjection {
  const mineSched = mine.filter((flow) => flow.topology === 'scheduled');
  const pool = mineSched.length
    ? mineSched.map((flow) => ({ flow, own: true }))
    : visibleExamples.filter((flow) => flow.topology === 'scheduled')
      .map((flow) => ({ flow, own: false }));
  let best: HomeNext | null = null;
  for (const candidate of pool) {
    // Look past the display window to know when an event first enters it.
    const [occ] = nextEvents(candidate.flow, now, timeZoneForFlow(candidate.flow, deviceTz), 400 * MS_PER_DAY);
    if (occ && (!best || occ.at < best.occ.at)) best = { ...candidate, occ };
  }
  const tomorrow = localMidnight(localMidnight(now, deviceTz) + 36 * 60 * 60_000, deviceTz);
  const nextRefreshAt = Math.max(now + 1, Math.min(
    tomorrow,
    best ? (best.occ.at <= now + MS_PER_DAY ? best.occ.at + 1 : best.occ.at - MS_PER_DAY) : Infinity,
  ));
  return {
    upNext: best && best.occ.at <= now + MS_PER_DAY ? best : null,
    nextRefreshAt,
  };
}

/** Detect due boundaries, wall-clock jumps and system-zone changes without per-second renders. */
export function homeClockShouldRefresh(
  actual: number, expected: number, deadline: number, zoneChanged: boolean,
): boolean {
  return actual >= deadline || Math.abs(actual - expected) > 2_000 || zoneChanged;
}
