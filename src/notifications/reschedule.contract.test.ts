// 提醒登记与重排的契约测试（C10），基于内存 KV 与记录型 Notifier。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { fixedTimeZone, MS_PER_DAY } from '../runtime/clock';
import { medicationFlow } from '../examples/medication';
import { coffeeFlow } from '../examples/coffee';
import { type Reminder } from './plan';
import { type Notifier } from './notifier';
import { enrollFlow, enrolledFlowKeys, rescheduleReminders, unenrollFlow, RESCHEDULE_CAP } from './reschedule';

function entry(flow: typeof medicationFlow | typeof coffeeFlow, enrollmentKey = flow.id) {
  return { flow, enrollmentKey };
}

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

test('enroll / unenroll 幂等，登记清单可读回', async () => {
  const kv = createInMemoryKV();
  await enrollFlow(kv, 'a');
  await enrollFlow(kv, 'a');
  await enrollFlow(kv, 'b');
  await unenrollFlow(kv, 'a');
  await unenrollFlow(kv, 'a');
  assert.deepEqual(await enrolledFlowKeys(kv), ['b']);
});

test('只为已登记的日程型 catalog entry 排提醒；未登记/顺序型不排', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await enrollFlow(kv, medicationFlow.id);

  await rescheduleReminders({
    kv,
    notifier,
    flows: [entry(coffeeFlow), entry(medicationFlow)],
    now: NOW,
    deviceTz: tz,
  });

  const batch = scheduled.at(-1) ?? [];
  assert.equal(batch.length, 3);
  assert.ok(batch.every((r) => r.repeat?.kind === 'daily'));
  assert.ok(batch.every((r) => r.id.startsWith('example.medication:')));
});

test('锚定非设备时区的 flow 走多日预排窗口', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const anchored = { ...medicationFlow, id: 'anchored', timeZone: 'UTC' };
  await enrollFlow(kv, anchored.id);

  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: anchored, enrollmentKey: anchored.id }],
    now: NOW,
    deviceTz: tz,
  });
  const batch = scheduled.at(-1) ?? [];
  assert.ok(batch.length >= 3 * 7);
  assert.ok(batch.every((r) => r.repeat === undefined));
});

test('重排先取消上一批的 id——不留孤儿，也不触碰别人的提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await enrollFlow(kv, medicationFlow.id);

  const opts = { kv, notifier, flows: [entry(medicationFlow)], now: NOW, deviceTz: tz };
  await rescheduleReminders(opts);
  await rescheduleReminders({ ...opts, now: NOW + MS_PER_DAY });

  const firstBatchIds = (scheduled[0] ?? []).map((r) => r.id);
  assert.deepEqual(cancelled[1], firstBatchIds);
});

test('已登记但已被删除的 flow 不再排提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await enrollFlow(kv, 'gone');

  await rescheduleReminders({ kv, notifier, flows: [entry(medicationFlow)], now: NOW, deviceTz: tz });
  assert.deepEqual(scheduled.at(-1), []);
});

test('提醒总量截断到 RESCHEDULE_CAP（平台待决上限）', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const flows = [0, 1, 2, 3].map((i) => ({ ...medicationFlow, id: `med-${i}`, timeZone: 'UTC' }));
  for (const f of flows) await enrollFlow(kv, f.id);

  await rescheduleReminders({
    kv,
    notifier,
    flows: flows.map((flow) => ({ flow, enrollmentKey: flow.id })),
    now: NOW,
    deviceTz: tz,
  });
  const batch = scheduled.at(-1) ?? [];
  assert.equal(batch.length, RESCHEDULE_CAP);
  for (let i = 1; i < batch.length; i++) assert.ok(batch[i - 1].at <= batch[i].at);
});

test('删除 owned 定义只关闭 owned enrollment，fallback 示例不会继承', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  const owned = { ...medicationFlow, title: '用户版本' };
  const fallback = { ...medicationFlow, title: '内置示例' };
  const ownedKey = 'owned-shadow:example.medication';

  await enrollFlow(kv, ownedKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: owned, enrollmentKey: ownedKey }],
    now: NOW,
    deviceTz: tz,
  });
  const oldIds = (scheduled.at(-1) ?? []).map((r) => r.id);
  assert.ok(oldIds.length > 0);

  await unenrollFlow(kv, ownedKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: fallback, enrollmentKey: fallback.id }],
    now: NOW + 1,
    deviceTz: tz,
  });

  assert.deepEqual(cancelled.at(-1), oldIds);
  assert.deepEqual(scheduled.at(-1), []);
});

test('同 id 示例 enrollment 不会转移给 shadowing owned Flow', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  const example = { ...medicationFlow, title: '内置示例' };
  const owned = { ...medicationFlow, title: '用户导入版本' };
  const ownedKey = 'owned-shadow:example.medication';

  await enrollFlow(kv, example.id);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: example, enrollmentKey: example.id }],
    now: NOW,
    deviceTz: tz,
  });
  const exampleIds = (scheduled.at(-1) ?? []).map((r) => r.id);
  assert.ok(exampleIds.length > 0);

  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: owned, enrollmentKey: ownedKey }],
    now: NOW + 1,
    deviceTz: tz,
  });
  assert.deepEqual(cancelled.at(-1), exampleIds);
  assert.deepEqual(scheduled.at(-1), []);

  await enrollFlow(kv, ownedKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: owned, enrollmentKey: ownedKey }],
    now: NOW + 2,
    deviceTz: tz,
  });
  assert.ok((scheduled.at(-1) ?? []).length > 0);
});
