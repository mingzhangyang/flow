// 通知规划契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type RunEvent } from '../domain/types';
import { planSequentialReminder, planScheduledReminders, planScheduledBatch } from './plan';
import {
  dailyReminderId,
  scheduledOccurrenceReminderId,
  sequentialReminderId,
  weeklyReminderId,
} from './notificationIdentity';
import { MS_PER_DAY } from '../runtime/clock';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

const T0 = 1_000_000;

test('计时步进行中 → 生成结束时刻的提醒', () => {
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 }, // 进入 steep(240s)
  ];
  const r = planSequentialReminder(coffeeFlow, events, T0, 'run-1', 'zh');
  assert.ok(r);
  assert.equal(r.at, T0 + 240_000);
  assert.equal(r.id, sequentialReminderId('run-1'));
  assert.match(r.body, /浸泡/);
  const en = planSequentialReminder(coffeeFlow, events, T0, 'run-1', 'en');
  assert.ok(en);
  assert.match(en.body, /time's up/);
});

test('非计时步 / 未开始 / 已到点 → 无提醒', () => {
  // 未开始
  assert.equal(planSequentialReminder(coffeeFlow, [], T0, 'r', 'zh'), null);
  // 停在 instant(water)
  assert.equal(planSequentialReminder(coffeeFlow, [{ type: 'started', at: T0 }], T0, 'r', 'zh'), null);
  // 计时已到点
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
  ];
  assert.equal(planSequentialReminder(coffeeFlow, events, T0 + 240_000, 'r', 'zh'), null);
});

test('日程型 → 为每个 scheduled 事件生成提醒（id 含触发时刻）', () => {
  const rem = planScheduledReminders(medicationFlow, 36_000_000, 0, MS_PER_DAY);
  assert.equal(rem.length, 3);
  assert.deepEqual(
    rem.map((r) => r.id),
    [
      scheduledOccurrenceReminderId('example.medication', 'noon', 50_400_000),
      scheduledOccurrenceReminderId('example.medication', 'evening', 79_200_000),
      scheduledOccurrenceReminderId('example.medication', 'morning', 115_200_000),
    ],
  );
});

test('日程型 → 多日窗口展开每一天的提醒（App 数日不开也不断档）', () => {
  const rem = planScheduledReminders(medicationFlow, 25_200_000, 0, 3 * MS_PER_DAY);
  assert.equal(rem.length, 9); // 3 剂 × 3 天
  const ids = new Set(rem.map((r) => r.id));
  assert.equal(ids.size, 9); // 同一节点不同日的 id 互不覆盖
});

test('planScheduledBatch 合并多条 flow，按时间排序并截断到 cap', () => {
  const other = { ...medicationFlow, id: 'other', nodes: medicationFlow.nodes };
  const entries = [
    { flow: medicationFlow, tz: 0 },
    { flow: other, tz: 0 },
  ];
  const all = planScheduledBatch(entries, 25_200_000, 3 * MS_PER_DAY, 100);
  assert.equal(all.length, 18);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at <= all[i].at); // 时间有序

  const capped = planScheduledBatch(entries, 25_200_000, 3 * MS_PER_DAY, 5);
  assert.equal(capped.length, 5);
  assert.deepEqual(capped.map((r) => r.at), all.slice(0, 5).map((r) => r.at)); // 最近的优先
});

// ---- 系统级重复触发器（App 几周不开也不断档）----

test('daily + 重复触发器 → 每节点一条带 repeat 的提醒，id 稳定、at 为下一次触发', () => {
  const now = 36_000_000; // 第 0 天 10:00（tz 0）
  const rem = planScheduledReminders(medicationFlow, now, 0, MS_PER_DAY, { repeatingTriggers: true });
  assert.equal(rem.length, 3); // 每节点 1 条，而不是 3 × N 天

  const morning = rem.find((r) => r.id === dailyReminderId('example.medication', 'morning'));
  assert.ok(morning);
  assert.deepEqual(morning.repeat, { kind: 'daily', hour: 8, minute: 0 });
  assert.equal(morning.at, MS_PER_DAY + 8 * 3_600_000); // 今天 08:00 已过 → 明天

  const noon = rem.find((r) => r.id === dailyReminderId('example.medication', 'noon'));
  assert.deepEqual(noon?.repeat, { kind: 'daily', hour: 14, minute: 0 });
  assert.equal(noon?.at, 14 * 3_600_000); // 今天 14:00 未到
});

test('weekly + 重复触发器 → 每「节点 × 星期」一条，weekday 同 JS getDay', () => {
  const weekly: Flow = {
    ...medicationFlow,
    id: 'wk',
    repeat: { kind: 'weekly', days: [1, 4] }, // 周一、周四
    nodes: [{ kind: 'scheduled', id: 'dose', label: '剂', at: 9 * 60 }],
  };
  const now = 36_000_000; // 第 0 天（1970-01-01 = 周四）10:00——今天 09:00 已过
  const rem = planScheduledReminders(weekly, now, 0, MS_PER_DAY, { repeatingTriggers: true });
  assert.deepEqual(
    rem.map((r) => r.id).sort(),
    [weeklyReminderId('wk', 'dose', 1), weeklyReminderId('wk', 'dose', 4)].sort(),
  );
  const monday = rem.find((r) => r.id === weeklyReminderId('wk', 'dose', 1));
  assert.deepEqual(monday?.repeat, { kind: 'weekly', weekday: 1, hour: 9, minute: 0 });
  assert.equal(monday?.at, 4 * MS_PER_DAY + 9 * 3_600_000); // 下周一 = 第 4 天
  const thursday = rem.find((r) => r.id === weeklyReminderId('wk', 'dose', 4));
  assert.equal(thursday?.at, 7 * MS_PER_DAY + 9 * 3_600_000); // 今天已过 → 下周四
});

test('once / everyNDays 即便允许重复触发器也走预排窗口（无 repeat 字段）', () => {
  const once: Flow = { ...medicationFlow, repeat: undefined };
  const onceRem = planScheduledReminders(once, 25_200_000, 0, 3 * MS_PER_DAY, { repeatingTriggers: true });
  assert.ok(onceRem.length > 0);
  assert.ok(onceRem.every((r) => r.repeat === undefined));

  const everyN: Flow = { ...medicationFlow, id: 'e2', repeat: { kind: 'everyNDays', n: 2, fromDay: 0 } };
  const everyNRem = planScheduledReminders(everyN, 25_200_000, 0, 4 * MS_PER_DAY, { repeatingTriggers: true });
  assert.equal(everyNRem.length, 6); // 3 剂 × 2 个符合节律的日子
  assert.ok(everyNRem.every((r) => r.repeat === undefined));
});


test('开放 flow/node id 含冒号时，scheduled reminder identifier 仍唯一', () => {
  const a: Flow = {
    ...medicationFlow,
    id: 'a:b',
    nodes: [{ kind: 'scheduled', id: 'c', label: 'A', at: 9 * 60 }],
  };
  const b: Flow = {
    ...medicationFlow,
    id: 'a',
    nodes: [{ kind: 'scheduled', id: 'b:c', label: 'B', at: 9 * 60 }],
  };
  const ar = planScheduledReminders(a, 0, 0, MS_PER_DAY);
  const br = planScheduledReminders(b, 0, 0, MS_PER_DAY);
  assert.notEqual(ar[0]?.id, br[0]?.id);
});


test('同 flowId 的不同 catalog definition 使用不同通知 identifier 与 route identity', () => {
  const exampleKey = JSON.stringify(['v2', 'example', medicationFlow.id]);
  const ownedKey = JSON.stringify(['v2', 'owned', medicationFlow.id]);
  const exampleRem = planScheduledReminders(medicationFlow, 36_000_000, 0, MS_PER_DAY, {
    definitionKey: exampleKey,
  });
  const ownedRem = planScheduledReminders(
    { ...medicationFlow, title: 'owned' },
    36_000_000,
    0,
    MS_PER_DAY,
    { definitionKey: ownedKey },
  );
  assert.notEqual(exampleRem[0]?.id, ownedRem[0]?.id);
  assert.equal(exampleRem[0]?.data?.definitionKey, exampleKey);
  assert.equal(ownedRem[0]?.data?.definitionKey, ownedKey);
});
