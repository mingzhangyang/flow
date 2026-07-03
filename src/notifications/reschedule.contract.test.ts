// 提醒登记与重排的契约测试（C10），基于内存 KV 与记录型 Notifier。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { fixedTimeZone, MS_PER_DAY } from '../runtime/clock';
import { medicationFlow } from '../examples/medication';
import { coffeeFlow } from '../examples/coffee';
import { type Reminder } from './plan';
import { type Notifier } from './notifier';
import { enrollFlow, enrolledFlowIds, rescheduleReminders, RESCHEDULE_CAP } from './reschedule';

/** 记录型 Notifier：断言排入/取消了什么。 */
function recordingNotifier() {
  const scheduled: Reminder[][] = [];
  const cancelled: string[][] = [];
  const notifier: Notifier = {
    async schedule(reminders) {
      scheduled.push(reminders);
    },
    async cancel(ids) {
      cancelled.push(ids);
    },
    async cancelAll() {},
    async status() {
      return 'ready';
    },
  };
  return { notifier, scheduled, cancelled };
}

const NOW = 25_200_000; // 1970-01-01 07:00 UTC
const tz = fixedTimeZone(0);

test('enroll 幂等，登记清单可读回', async () => {
  const kv = createInMemoryKV();
  await enrollFlow(kv, 'a');
  await enrollFlow(kv, 'a');
  await enrollFlow(kv, 'b');
  assert.deepEqual(await enrolledFlowIds(kv), ['a', 'b']);
});

test('只为已登记的日程型 flow 排提醒；未登记/顺序型不排', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await enrollFlow(kv, medicationFlow.id);

  await rescheduleReminders({
    kv,
    notifier,
    flows: [coffeeFlow, medicationFlow],
    now: NOW,
    deviceTz: tz,
  });

  const batch = scheduled.at(-1) ?? [];
  // 跟随设备时区的 daily → 系统级重复触发器：每节点 1 条，长期有效、不断档
  assert.equal(batch.length, 3);
  assert.ok(batch.every((r) => r.repeat?.kind === 'daily'));
  assert.ok(batch.every((r) => r.id.startsWith('example.medication:')));
});

test('锚定非设备时区的 flow 走多日预排窗口（重复触发器无法表达异地墙钟）', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const anchored = { ...medicationFlow, id: 'anchored', timeZone: 'UTC' };
  await enrollFlow(kv, anchored.id);

  await rescheduleReminders({ kv, notifier, flows: [anchored], now: NOW, deviceTz: tz });
  const batch = scheduled.at(-1) ?? [];
  assert.ok(batch.length >= 3 * 7); // 3 剂 × 7 天窗口
  assert.ok(batch.every((r) => r.repeat === undefined));
});

test('重排先取消上一批的 id——不留孤儿，也不触碰别人的提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await enrollFlow(kv, medicationFlow.id);

  const opts = { kv, notifier, flows: [medicationFlow], now: NOW, deviceTz: tz };
  await rescheduleReminders(opts);
  await rescheduleReminders({ ...opts, now: NOW + MS_PER_DAY });

  const firstBatchIds = (scheduled[0] ?? []).map((r) => r.id);
  assert.deepEqual(cancelled[1], firstBatchIds); // 第二次重排取消的正是第一批
});

test('已登记但已被删除的 flow 不再排提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await enrollFlow(kv, 'gone');

  await rescheduleReminders({ kv, notifier, flows: [medicationFlow], now: NOW, deviceTz: tz });
  assert.deepEqual(scheduled.at(-1), []);
});

test('提醒总量截断到 RESCHEDULE_CAP（平台待决上限）', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  // 锚定时区（走预排窗口）：4 条各 3 剂/日 × 7 天 = 84 > cap
  const flows = [0, 1, 2, 3].map((i) => ({ ...medicationFlow, id: `med-${i}`, timeZone: 'UTC' }));
  for (const f of flows) await enrollFlow(kv, f.id);

  await rescheduleReminders({ kv, notifier, flows, now: NOW, deviceTz: tz });
  const batch = scheduled.at(-1) ?? [];
  assert.equal(batch.length, RESCHEDULE_CAP);
  for (let i = 1; i < batch.length; i++) assert.ok(batch[i - 1].at <= batch[i].at); // 最近优先
});
