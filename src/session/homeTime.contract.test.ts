import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Flow } from '../domain/types';
import { projectHomeTime, homeClockShouldRefresh } from './homeTime';
import { calendarDateAt } from '../runtime/calendarDate';
import { fixedTimeZone, timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { ianaTimeZone, timeZoneForFlow } from '../runtime/ianaTimeZone';

const shanghai = fixedTimeZone(480);
const now = Date.parse('2026-07-15T09:00:00+08:00');
const daily = (id: string, times: number[]): Flow => ({
  schemaVersion: 2, id, title: id, topology: 'scheduled', repeat: { kind: 'daily' },
  nodes: times.map((at, i) => ({ kind: 'scheduled' as const, id: 'n'+i, label: 'Dose'+i, at })),
});

test('Home first projection, due boundary, and next event update deterministically', () => {
  const flow = daily('medical', [480, 840, 1320]);
  const first = projectHomeTime([flow], [], now, shanghai);
  assert.equal(first.upNext?.occ.at, Date.parse('2026-07-15T14:00:00+08:00'));
  assert.equal(first.nextRefreshAt, first.upNext.occ.at + 1);
  const later = projectHomeTime([flow], [], first.nextRefreshAt, shanghai);
  assert.equal(later.upNext?.occ.at, Date.parse('2026-07-15T22:00:00+08:00'));
  assert.equal(later.nextRefreshAt, later.upNext.occ.at + 1);
});

test('owned Flow priority beats example Flow; library changes recompute immediately', () => {
  const mine = daily('my-therapy', [1320]);
  const example = daily('sample', [840]);
  assert.equal(projectHomeTime([mine], [example], now, shanghai).upNext?.flow.id, 'my-therapy');
  assert.equal(projectHomeTime([], [example], now, shanghai).upNext?.flow.id, 'sample');
});

test('crossing local midnight causes date projection to change, not a stale memo', () => {
  const today = calendarDateAt(now, shanghai);
  const boundary = projectHomeTime([], [], now, shanghai).nextRefreshAt;
  assert.equal(boundary, Date.parse('2026-07-16T00:00:00+08:00'));
  assert.equal(today.day, 15);
  assert.equal(calendarDateAt(boundary, shanghai).day, 16);
});

test('an event entering the 24h window is scheduled for a refresh, not hidden forever', () => {
  const onlyTomorrowEvening = daily('night', [1320]);
  const todayMorning = Date.parse('2026-07-15T08:00:00+08:00');
  const first = projectHomeTime([onlyTomorrowEvening], [], todayMorning, shanghai);
  // Today's 22:00 is visible within 24h; tomorrow's 22:00 after today's event.
  assert.equal(first.upNext?.occ.at, Date.parse('2026-07-15T22:00:00+08:00'));
  const later = projectHomeTime([onlyTomorrowEvening], [], Date.parse('2026-07-15T22:00:00.001+08:00'), shanghai);
  assert.equal(later.upNext, null);
  assert.equal(later.nextRefreshAt, Date.parse('2026-07-16T00:00:00+08:00'));
});

test('foreground, system clock jump, and timezone change trigger refresh without ticking React', () => {
  const deadline = now + 60_000;
  assert.equal(homeClockShouldRefresh(now + 30_000, now + 30_000, deadline, false), false);
  assert.equal(homeClockShouldRefresh(deadline, deadline, deadline, false), true);
  assert.equal(homeClockShouldRefresh(now + 15_000, now + 60_000, deadline, false), true);
  assert.equal(homeClockShouldRefresh(now + 30_000, now + 30_000, deadline, true), true);
  // AppState.active refreshes immediately at the UI adapter boundary.
});

test('anchored calendar date and time both use the Flow zone, not host/device getters', () => {
  const ny = ianaTimeZone('America/New_York');
  const at = Date.UTC(2027, 0, 1, 0, 30);
  assert.deepEqual(calendarDateAt(at, ny), { year: 2026, month: 12, day: 31, weekday: 4 });
  assert.deepEqual(calendarDateAt(at, shanghai), { year: 2027, month: 1, day: 1, weekday: 5 });
  assert.equal(timeOfDay(at, ny), 19 * 60 + 30);
  assert.equal(timeOfDay(at, shanghai), 8 * 60 + 30);
  assert.equal(timeZoneForFlow({}, shanghai), shanghai);
});

test('IANA DST spring-forward and fall-back keep date/week/time consistent', () => {
  const ny = ianaTimeZone('America/New_York');
  const springBefore = Date.UTC(2026, 2, 8, 6, 30);
  const springAfter = Date.UTC(2026, 2, 8, 7, 30);
  assert.equal(timeOfDay(springBefore, ny), 90);
  assert.equal(timeOfDay(springAfter, ny), 210);
  assert.deepEqual(calendarDateAt(springBefore, ny), calendarDateAt(springAfter, ny));
  const fallFirst = Date.UTC(2026, 10, 1, 5, 30);
  const fallSecond = Date.UTC(2026, 10, 1, 6, 30);
  assert.equal(timeOfDay(fallFirst, ny), 90);
  assert.equal(timeOfDay(fallSecond, ny), 90);
  assert.deepEqual(calendarDateAt(fallFirst, ny), calendarDateAt(fallSecond, ny));
});

test('anchored Home event crosses DST without changing schedule semantics', () => {
  const flow = { ...daily('ny', [480]), timeZone: 'America/New_York' };
  const beforeSpring = Date.UTC(2026, 2, 7, 14);
  const projected = projectHomeTime([flow], [], beforeSpring, shanghai);
  assert.equal(projected.upNext?.occ.at, Date.UTC(2026, 2, 8, 12));
  assert.equal(projected.upNext?.occ.at && timeOfDay(projected.upNext.occ.at, timeZoneForFlow(flow, shanghai)), 480);
  assert.ok(projected.nextRefreshAt <= beforeSpring + MS_PER_DAY);
});
