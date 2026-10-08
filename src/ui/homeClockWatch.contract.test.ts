import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeClockWatch } from './homeClockWatch';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = Date.parse('2026-07-15T09:00:00+08:00');
const FIRST_DEADLINE = Date.parse('2026-07-15T14:00:00.001+08:00');

/** Wall time can jump independently from monotonic timers, just like device clocks. */
function fakeClock(start = START) {
  let wall = start;
  let monotonic = 0;
  let nextId = 0;
  let zone = 'Asia/Shanghai';
  const timers = new Map<number, { at: number; fire: () => void }>();

  return {
    now: () => wall,
    zoneId: () => zone,
    changeZone: (next: string) => { zone = next; },
    jumpWall: (delta: number) => { wall += delta; },
    timerCount: () => timers.size,
    schedule(fire: () => void, delay: number): number {
      assert.ok(delay >= 1 && delay <= MINUTE, 'bounded watchdog delay');
      const id = ++nextId;
      timers.set(id, { at: monotonic + delay, fire });
      return id;
    },
    cancel(id: number) { timers.delete(id); },
    advance(elapsed: number) {
      const end = monotonic + elapsed;
      let count = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        if (++count > 10_000) throw new Error('runaway watchdog timer');
        const delta = next[1].at - monotonic;
        monotonic = next[1].at;
        wall += delta;
        timers.delete(next[0]);
        next[1].fire();
      }
      wall += end - monotonic;
      monotonic = end;
    },
  };
}

test('watchdog survives a backwards wall-clock jump with an UNCHANGED next deadline', () => {
  const clock = fakeClock();
  const updates: number[] = [];
  const watch = createHomeClockWatch({
    now: clock.now,
    zoneId: clock.zoneId,
    schedule: clock.schedule,
    cancel: clock.cancel,
    refresh: (at) => {
      updates.push(at);
      // The jump does NOT alter the same anchored Up Next occurrence; React's
      // [nextRefreshAt] effect would not rerun. Only an expired event changes it.
      if (at >= FIRST_DEADLINE) watch.updateDeadline(FIRST_DEADLINE + 24 * HOUR);
    },
  });
  watch.start(FIRST_DEADLINE);
  clock.advance(MINUTE);
  assert.equal(updates.length, 0);
  clock.jumpWall(-HOUR);
  clock.advance(MINUTE); // drift detected, but deadline stays exactly the same
  assert.deepEqual(updates, [START - HOUR + 2 * MINUTE]);
  watch.updateDeadline(FIRST_DEADLINE); // same dependency -> no React re-arm
  assert.equal(clock.timerCount(), 1, 'watchdog must still have its next heartbeat');
  clock.advance(MINUTE);
  assert.equal(updates.length, 1, 'ordinary watchdog sampling never rerenders React');
  clock.advance(FIRST_DEADLINE - clock.now());
  assert.equal(updates.length, 2, 'the next occurrence boundary must still refresh');
  assert.equal(updates[1], FIRST_DEADLINE);
  assert.equal(clock.timerCount(), 1);
  watch.stop();
  assert.equal(clock.timerCount(), 0);
});

test('timezone changes trigger only a relevant refresh and never terminate monitoring', () => {
  const clock = fakeClock();
  const updates: number[] = [];
  const watch = createHomeClockWatch({
    now: clock.now,
    zoneId: clock.zoneId,
    schedule: clock.schedule,
    cancel: clock.cancel,
    refresh: (at) => updates.push(at),
  });
  watch.start(FIRST_DEADLINE);
  clock.advance(MINUTE);
  clock.changeZone('America/New_York');
  clock.advance(MINUTE);
  assert.equal(updates.length, 1);
  assert.equal(clock.timerCount(), 1);
  clock.advance(MINUTE);
  assert.equal(updates.length, 1);
  watch.foreground();
  assert.equal(updates.length, 2, 'foreground always projects current wall time');
  assert.equal(clock.timerCount(), 1, 'foreground cannot create duplicate timers');
  watch.stop();
  clock.advance(2 * HOUR);
  assert.equal(updates.length, 2, 'unmounted Home must not update state');
});

test('a changed Up Next deadline reschedules one timer and cleanup cancels it', () => {
  const clock = fakeClock();
  const updates: number[] = [];
  const watch = createHomeClockWatch({
    now: clock.now,
    zoneId: clock.zoneId,
    schedule: clock.schedule,
    cancel: clock.cancel,
    refresh: (at) => {
      updates.push(at);
      watch.updateDeadline(at + HOUR);
    },
  });
  watch.start(FIRST_DEADLINE);
  clock.advance(10_000);
  watch.updateDeadline(clock.now() + 5_000);
  assert.equal(clock.timerCount(), 1);
  clock.advance(5_000);
  assert.deepEqual(updates, [START + 15_000]);
  assert.equal(clock.timerCount(), 1);
  watch.stop();
  assert.equal(clock.timerCount(), 0);
  // Strict Mode can stop/start the same stable instance on a dev effect replay.
  watch.start(clock.now() + MINUTE);
  assert.equal(clock.timerCount(), 1);
  watch.stop();
  assert.equal(clock.timerCount(), 0);
});
