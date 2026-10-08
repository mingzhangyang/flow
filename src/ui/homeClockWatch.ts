// UI-side timer ownership for Home projections. Scheduling remains live even when
// a clock/zone refresh does not change React's nextRefreshAt dependency.
// No domain time is stored here: the projection owns the deadline (E3/C9).

import { homeClockShouldRefresh } from '../session/homeTime';

const WATCHDOG_INTERVAL_MS = 60_000;

export interface HomeClockWatch {
  start(nextRefreshAt: number): void;
  updateDeadline(nextRefreshAt: number): void;
  foreground(): void;
  stop(): void;
}

export function createHomeClockWatch<TimerHandle>(deps: {
  now(): number;
  zoneId(): string;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
  refresh(at: number): void;
}): HomeClockWatch {
  let running = false;
  let timer: TimerHandle | undefined;
  let deadline = Infinity;
  let zone = '';

  const clear = (): void => {
    if (timer !== undefined) deps.cancel(timer);
    timer = undefined;
  };

  const arm = (): void => {
    if (!running) return;
    const current = deps.now();
    const untilDeadline = deadline - current;
    // When React has not yet committed an updated projection for an expired
    // deadline, retain a bounded heartbeat rather than spinning at 1ms.
    const delay = untilDeadline > 0
      ? Math.min(WATCHDOG_INTERVAL_MS, Math.max(1, untilDeadline))
      : WATCHDOG_INTERVAL_MS;
    const expected = current + delay;
    timer = deps.schedule(() => {
      timer = undefined;
      if (!running) return;
      const actual = deps.now();
      const currentZone = deps.zoneId();
      const shouldRefresh = homeClockShouldRefresh(
        actual, expected, deadline, currentZone !== zone,
      );
      zone = currentZone;
      // Never couple the next heartbeat to a React dependency change. In
      // particular, a backwards wall-clock jump can leave deadline unchanged.
      arm();
      if (shouldRefresh) deps.refresh(actual);
    }, delay);
  };

  return {
    start(nextRefreshAt) {
      if (running) return;
      running = true;
      deadline = nextRefreshAt;
      zone = deps.zoneId();
      arm();
    },
    updateDeadline(nextRefreshAt) {
      if (deadline === nextRefreshAt) return;
      deadline = nextRefreshAt;
      if (!running) return;
      clear();
      arm();
    },
    foreground() {
      if (!running) return;
      zone = deps.zoneId();
      clear();
      arm();
      deps.refresh(deps.now());
    },
    stop() {
      running = false;
      clear();
    },
  };
}
