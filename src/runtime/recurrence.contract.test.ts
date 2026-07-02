// 重复规则契约测试（C10）：occursOnDay / describeRecurrence 纯函数，
// 以及 engine（下一次触发跳到正确的日子）与 adherence（今日清单过滤）的集成。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { occursOnDay, describeRecurrence } from './recurrence';
import { localDayIndex, weekdayOfDayIndex, MS_PER_DAY, MS_PER_MINUTE } from './clock';
import { nextEvents } from './engine';
import { todayDoses } from './adherence';
import { type Flow, type Recurrence, type ScheduledNode } from '../domain/types';
import { validateFlow } from '../domain/validate';

const MIN = MS_PER_MINUTE;
const TZ = 480; // 东八区固定偏移

// 1970-01-01（日序号 0）是周四。取一个周四的本地中午作基准。
const THURSDAY_NOON = 0 * MS_PER_DAY + 12 * 60 * MIN - TZ * MIN;

test('weekdayOfDayIndex：日序号 0 是周四，负数也正确', () => {
  assert.equal(weekdayOfDayIndex(0), 4);
  assert.equal(weekdayOfDayIndex(3), 0); // 周日
  assert.equal(weekdayOfDayIndex(-1), 3); // 前一天是周三
});

test('occursOnDay：weekly 只在指定星期发生', () => {
  const thu: Recurrence = { kind: 'weekly', days: [4] };
  assert.equal(occursOnDay(thu, THURSDAY_NOON, TZ), true);
  assert.equal(occursOnDay(thu, THURSDAY_NOON + MS_PER_DAY, TZ), false); // 周五
  assert.equal(occursOnDay(thu, THURSDAY_NOON + 7 * MS_PER_DAY, TZ), true); // 下周四
});

test('occursOnDay：everyNDays 按起算日取模，起算日之前也成立', () => {
  const every3: Recurrence = { kind: 'everyNDays', n: 3, fromDay: 10 };
  const day = (i: number): number => i * MS_PER_DAY + 12 * 60 * MIN - TZ * MIN;
  assert.equal(occursOnDay(every3, day(10), TZ), true);
  assert.equal(occursOnDay(every3, day(11), TZ), false);
  assert.equal(occursOnDay(every3, day(13), TZ), true);
  assert.equal(occursOnDay(every3, day(7), TZ), true); // 10 - 3
  assert.equal(occursOnDay(every3, day(6), TZ), false);
});

test('occursOnDay：once 与 daily 恒为真（once 只发生一次由 engine 保证）', () => {
  assert.equal(occursOnDay({ kind: 'once' }, THURSDAY_NOON, TZ), true);
  assert.equal(occursOnDay({ kind: 'daily' }, THURSDAY_NOON, TZ), true);
});

test('describeRecurrence：人类可读', () => {
  assert.equal(describeRecurrence({ kind: 'once' }), '仅今天');
  assert.equal(describeRecurrence({ kind: 'daily' }), '每天');
  assert.equal(describeRecurrence({ kind: 'weekly', days: [5, 1] }), '每周一、五');
  assert.equal(describeRecurrence({ kind: 'everyNDays', n: 2, fromDay: 0 }), '隔天');
  assert.equal(describeRecurrence({ kind: 'everyNDays', n: 3, fromDay: 0 }), '每 3 天');
});

// ---- engine 集成：下一次触发跳到正确的日子 ----

const scheduledFlow = (node: Partial<ScheduledNode> & { repeat: Recurrence }): Flow => ({
  schemaVersion: 1,
  id: 'f',
  title: 't',
  topology: 'scheduled',
  nodes: [{ kind: 'scheduled', id: 'a', label: 'A', at: 480, repeat: node.repeat }],
});

test('nextEvents：weekly 跳到下一个匹配的星期（周四 09:00 → 下周四 08:00）', () => {
  const flow = scheduledFlow({ repeat: { kind: 'weekly', days: [4] } });
  const now = THURSDAY_NOON - 3 * 60 * MIN; // 周四 09:00（当天 08:00 已过）
  const [occ] = nextEvents(flow, now, TZ, 8 * MS_PER_DAY);
  assert.equal(localDayIndex(occ.at, TZ), 7); // 下周四
  assert.equal(occ.at - now, 7 * MS_PER_DAY - 60 * MIN);
});

test('nextEvents：everyNDays 隔天推进', () => {
  const flow = scheduledFlow({ repeat: { kind: 'everyNDays', n: 2, fromDay: 0 } });
  const now = THURSDAY_NOON; // 日序号 0 匹配，但 08:00 已过 → 下一次是日序号 2
  const [occ] = nextEvents(flow, now, TZ, 8 * MS_PER_DAY);
  assert.equal(localDayIndex(occ.at, TZ), 2);
});

test('nextEvents：once 过时不候（不排明天）', () => {
  const flow = scheduledFlow({ repeat: { kind: 'once' } });
  const past = nextEvents(flow, THURSDAY_NOON, TZ, 8 * MS_PER_DAY); // 08:00 已过
  assert.deepEqual(past, []);
  const early = nextEvents(flow, THURSDAY_NOON - 5 * 60 * MIN, TZ, MS_PER_DAY); // 07:00
  assert.equal(early.length, 1);
  assert.equal(localDayIndex(early[0].at, TZ), 0); // 就在今天
});

// ---- adherence 集成：今日清单只列今天会发生的 ----

test('todayDoses：weekly 节点在不匹配的日子不出现', () => {
  const flow: Flow = {
    schemaVersion: 1,
    id: 'f',
    title: 't',
    topology: 'scheduled',
    nodes: [
      { kind: 'scheduled', id: 'thu', label: '周四药', at: 480, repeat: { kind: 'weekly', days: [4] } },
      { kind: 'scheduled', id: 'day', label: '每日药', at: 540, repeat: { kind: 'daily' } },
    ],
  };
  const thursday = todayDoses(flow, [], THURSDAY_NOON, TZ, 120);
  assert.deepEqual(thursday.map((d) => d.nodeId), ['thu', 'day']);
  const friday = todayDoses(flow, [], THURSDAY_NOON + MS_PER_DAY, TZ, 120);
  assert.deepEqual(friday.map((d) => d.nodeId), ['day']);
});

// ---- 校验 ----

test('validateFlow：weekly 空数组 / 越界 / 重复 与 everyNDays n<1 均被拒', () => {
  const bad = (repeat: unknown): boolean =>
    validateFlow(scheduledFlow({ repeat: repeat as Recurrence })).length > 0;
  assert.equal(bad({ kind: 'weekly', days: [] }), true);
  assert.equal(bad({ kind: 'weekly', days: [7] }), true);
  assert.equal(bad({ kind: 'weekly', days: [1, 1] }), true);
  assert.equal(bad({ kind: 'everyNDays', n: 0, fromDay: 0 }), true);
  assert.equal(bad({ kind: 'everyNDays', n: 2 }), true); // 缺 fromDay
  assert.equal(bad({ kind: 'magic' }), true);
  assert.equal(bad({ kind: 'weekly', days: [0, 6] }), false);
  assert.equal(bad({ kind: 'everyNDays', n: 2, fromDay: 20600 }), false);
});
