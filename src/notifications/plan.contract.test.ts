// 通知规划契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type RunEvent } from '../domain/types';
import { planSequentialReminder, planScheduledReminders } from './plan';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

const T0 = 1_000_000;

test('计时步进行中 → 生成结束时刻的提醒', () => {
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 }, // 进入 steep(240s)
  ];
  const r = planSequentialReminder(coffeeFlow, events, T0, 'run-1');
  assert.ok(r);
  assert.equal(r.at, T0 + 240_000);
  assert.equal(r.id, 'run-1');
  assert.match(r.body, /浸泡/);
});

test('非计时步 / 未开始 / 已到点 → 无提醒', () => {
  // 未开始
  assert.equal(planSequentialReminder(coffeeFlow, [], T0, 'r'), null);
  // 停在 instant(water)
  assert.equal(planSequentialReminder(coffeeFlow, [{ type: 'started', at: T0 }], T0, 'r'), null);
  // 计时已到点
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
  ];
  assert.equal(planSequentialReminder(coffeeFlow, events, T0 + 240_000, 'r'), null);
});

test('日程型 → 为每个 scheduled 事件生成提醒', () => {
  const rem = planScheduledReminders(medicationFlow, 36_000_000, 0, 24 * 60 * 60 * 1000);
  assert.equal(rem.length, 3);
  assert.deepEqual(
    rem.map((r) => r.id),
    ['example.medication:noon', 'example.medication:evening', 'example.medication:morning'],
  );
});
