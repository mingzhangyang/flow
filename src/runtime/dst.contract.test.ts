// DST（夏令时）契约测试：时区是「偏移随时刻变化」的注入函数（E3），
// 跨切换日的墙钟换算、日程推进与打卡都必须正确且确定（E4）。
// 用自构造的阶跃时区模拟切换，不依赖宿主环境。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type TimeZone,
  fixedTimeZone,
  timeOfDay,
  localMidnight,
  instantAtTimeOfDay,
  MS_PER_MINUTE,
  MS_PER_DAY,
} from './clock';
import { nextEvents } from './engine';
import { todayDoses } from './adherence';
import { type Flow } from '../domain/types';

const MIN = MS_PER_MINUTE;

/** 在 transitionAt 时刻偏移从 before 跳到 after 的阶跃时区。 */
const stepZone = (transitionAt: number, before: number, after: number): TimeZone => ({
  offsetAt: (at) => (at < transitionAt ? before : after),
});

// ---- 春令时（偏移 +60 → +120，本地 02:00 跳到 03:00）----
// D 日本地午夜的 Instant：M。切换点 T = M + 120min（本地 02:00）。
const M = 100 * MS_PER_DAY - 60 * MIN; // localMs(M) = 100*DAY，整日边界
const T = M + 120 * MIN;
const springZone = stepZone(T, 60, 120);

test('timeOfDay：切换点前后按各自偏移换算', () => {
  assert.equal(timeOfDay(M + 60 * MIN, springZone), 60); // 本地 01:00
  assert.equal(timeOfDay(T, springZone), 180); // 跳变后即本地 03:00
});

test('instantAtTimeOfDay：切换日 08:00 用新偏移换算（绝对时刻比往常早一小时）', () => {
  const at8 = instantAtTimeOfDay(M + 30 * MIN, 480, springZone);
  assert.equal(timeOfDay(at8, springZone), 480); // 墙钟仍是 08:00
  assert.equal(at8, M + 420 * MIN); // 午夜后仅 7 个绝对小时
});

test('instantAtTimeOfDay：被跳过的 02:30 落到切换后第一个时刻（本地 03:00）', () => {
  const at = instantAtTimeOfDay(M + 30 * MIN, 150, springZone);
  assert.equal(at, T);
  assert.equal(timeOfDay(at, springZone), 180);
});

test('localMidnight：切换日当天与次日都正确', () => {
  assert.equal(localMidnight(M + 300 * MIN, springZone), M);
  // 次日午夜：距 M 只有 23 个绝对小时
  const nextMidnight = localMidnight(M + 23.5 * 60 * MIN, springZone);
  assert.equal(nextMidnight, M + 23 * 60 * MIN);
  assert.equal(timeOfDay(nextMidnight, springZone), 0);
});

// ---- 秋令时（偏移 +120 → +60，本地 03:00 拨回 02:00）----
const M2 = 200 * MS_PER_DAY - 120 * MIN;
const T2 = M2 + 180 * MIN; // 本地 03:00 的瞬间拨回 02:00
const fallZone = stepZone(T2, 120, 60);

test('instantAtTimeOfDay：出现两次的 02:30 取第一次', () => {
  const at = instantAtTimeOfDay(M2 + 30 * MIN, 150, fallZone);
  assert.equal(at, M2 + 150 * MIN); // 第一次（切换前）
  assert.ok(at < T2);
  assert.equal(timeOfDay(at, fallZone), 150);
  // 第二次出现于 T2 + 30min，确为同一墙钟时刻
  assert.equal(timeOfDay(T2 + 30 * MIN, fallZone), 150);
});

// ---- 日程推进跨切换日 ----

const medFlow: Flow = {
  schemaVersion: 2,
  id: 'med',
  title: '服药',
  topology: 'scheduled',
  repeat: { kind: 'daily' },
  nodes: [{ kind: 'scheduled', id: 'a', label: '早餐药', at: 480 }],
};

test('nextEvents：每天 08:00 跨春令时——次日提醒仍在墙钟 08:00（绝对间隔 23h）', () => {
  // now = 切换前一天 09:00（当天 08:00 已过）
  const prevMidnight = M - MS_PER_DAY;
  const now = prevMidnight + 540 * MIN;
  const [occ] = nextEvents(medFlow, now, springZone, 2 * MS_PER_DAY);
  assert.ok(occ);
  assert.equal(occ.at, M + 420 * MIN); // 切换日的 08:00
  assert.equal(timeOfDay(occ.at, springZone), 480);
  // 与前一天 08:00 的绝对间隔是 23 小时，而不是 24
  assert.equal(occ.at - (prevMidnight + 480 * MIN), 23 * 60 * MIN);
});

test('nextEvents：跨秋令时——次日提醒仍在墙钟 08:00（绝对间隔 25h）', () => {
  const prevMidnight = M2 - MS_PER_DAY;
  const now = prevMidnight + 540 * MIN;
  const [occ] = nextEvents(medFlow, now, fallZone, 2 * MS_PER_DAY);
  assert.ok(occ);
  assert.equal(timeOfDay(occ.at, fallZone), 480);
  assert.equal(occ.at - (prevMidnight + 480 * MIN), 25 * 60 * MIN);
});

test('nextEvents：固定偏移标量仍兼容（原行为不变）', () => {
  const midnightUtc8 = 300 * MS_PER_DAY - 480 * MIN;
  const now = midnightUtc8 + 60 * MIN;
  const [occ] = nextEvents(medFlow, now, 480, MS_PER_DAY);
  assert.equal(occ.at, midnightUtc8 + 480 * MIN);
  // TimeZone 对象形式给出同样结果
  const [occ2] = nextEvents(medFlow, now, fixedTimeZone(480), MS_PER_DAY);
  assert.equal(occ2.at, occ.at);
});

// ---- 打卡跨切换日 ----

test('todayDoses：切换日的剂量钉在墙钟 08:00，打卡键（scheduledFor）一致', () => {
  const now = M + 600 * MIN; // 切换日（绝对轴）上午
  const [dose] = todayDoses(medFlow, [], now, springZone, 120);
  assert.ok(dose);
  assert.equal(dose.scheduledFor, M + 420 * MIN);
  assert.equal(timeOfDay(dose.scheduledFor, springZone), 480);
  // 已到点且超过 120min 宽限 → missed（600 - 420 = 180min）
  assert.equal(dose.status, 'missed');
});

test('todayDoses：被跳过的时刻（02:30）当天顺延到 03:00，不会凭空消失', () => {
  const skipFlow: Flow = {
    ...medFlow,
    id: 'skip',
    nodes: [{ kind: 'scheduled', id: 's', label: '夜间药', at: 150 }],
  };
  // now = 本地 01:50（切换前）：02:30 不存在，剂量顺延到 03:00，仍是待服
  const [dose] = todayDoses(skipFlow, [], M + 110 * MIN, springZone, 120);
  assert.equal(dose.scheduledFor, T); // 本地 03:00
  assert.equal(dose.status, 'upcoming');
  // now = 本地 03:10（切换后 10 分钟）：已到点、宽限内 → 可服
  const [dose2] = todayDoses(skipFlow, [], M + 130 * MIN, springZone, 120);
  assert.equal(dose2.status, 'due');
});
