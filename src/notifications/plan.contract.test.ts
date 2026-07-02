// 通知规划契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type RunEvent } from '../domain/types';
import { planSequentialReminder, planScheduledReminders, planScheduledBatch } from './plan';
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
  assert.equal(r.id, 'run-1');
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
      'example.medication:noon:50400000',
      'example.medication:evening:79200000',
      'example.medication:morning:115200000',
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
