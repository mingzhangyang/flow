// 提醒登记与重排契约：覆盖结构化身份、legacy 迁移、碰撞隔离与取消。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { fixedTimeZone, MS_PER_DAY } from '../runtime/clock';
import { medicationFlow } from '../examples/medication';
import { coffeeFlow } from '../examples/coffee';
import { reminderEnrollmentIdentity } from '../session/flowCatalog';
import { type Reminder } from './plan';
import { type Notifier } from './notifier';
import { enrollFlow, enrolledFlowKeys, rescheduleReminders, unenrollFlow, RESCHEDULE_CAP } from './reschedule';

function recordingNotifier() {
  const scheduled: Reminder[][] = [];
  const cancelled: string[][] = [];
  const notifier: Notifier = {
    async schedule(reminders) { scheduled.push(reminders); },
    async cancel(ids) { cancelled.push(ids); },
    async cancelAll() {},
    async status() { return 'ready'; },
  };
  return { notifier, scheduled, cancelled };
}

const NOW = 25_200_000;
const tz = fixedTimeZone(0);
const exampleIdentity = reminderEnrollmentIdentity(medicationFlow.id, 'example', [medicationFlow]);

test('新 enrollment 用结构化记录，enroll / unenroll 幂等', async () => {
  const kv = createInMemoryKV();
  await enrollFlow(kv, exampleIdentity.key);
  await enrollFlow(kv, exampleIdentity.key);
  assert.deepEqual(await enrolledFlowKeys(kv), [exampleIdentity.key]);

  await unenrollFlow(kv, exampleIdentity.key, exampleIdentity.legacyId);
  await unenrollFlow(kv, exampleIdentity.key, exampleIdentity.legacyId);
  assert.deepEqual(await enrolledFlowKeys(kv), []);
});

test('legacy bare ID 在来源无歧义时迁移为 v2 并继续排提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await kv.setItem('notif:enrolled', JSON.stringify([medicationFlow.id]));

  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: medicationFlow, enrollmentKey: exampleIdentity.key, legacyEnrollmentId: medicationFlow.id }],
    now: NOW,
    deviceTz: tz,
  });

  assert.equal((scheduled.at(-1) ?? []).length, 3);
  assert.deepEqual(await enrolledFlowKeys(kv), [exampleIdentity.key]);
  const raw = JSON.parse((await kv.getItem('notif:enrolled')) ?? '[]') as unknown[];
  assert.equal(typeof raw[0], 'object');
});

test('开放 ID 即使文本等于别人的 canonical key，也不会继承其结构化 enrollment', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const shadowKey = reminderEnrollmentIdentity('x', 'owned', [{ ...medicationFlow, id: 'x' }]).key;
  const collidingFlow = { ...medicationFlow, id: shadowKey, title: 'literal collision id' };
  const collidingIdentity = reminderEnrollmentIdentity(collidingFlow.id, 'owned', [medicationFlow]);

  await enrollFlow(kv, shadowKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{
      flow: collidingFlow,
      enrollmentKey: collidingIdentity.key,
      legacyEnrollmentId: collidingFlow.id,
    }],
    now: NOW,
    deviceTz: tz,
  });

  assert.deepEqual(scheduled.at(-1), []);
});

test('shadowing owned 不会继承示例 legacy bare enrollment', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const owned = { ...medicationFlow, title: 'owned shadow' };
  const ownedIdentity = reminderEnrollmentIdentity(owned.id, 'owned', [medicationFlow]);
  assert.equal(ownedIdentity.legacyId, undefined);
  await kv.setItem('notif:enrolled', JSON.stringify([medicationFlow.id]));

  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: owned, enrollmentKey: ownedIdentity.key }],
    now: NOW,
    deviceTz: tz,
  });

  assert.deepEqual(scheduled.at(-1), []);
  assert.deepEqual(await enrolledFlowKeys(kv), [medicationFlow.id]);
});

test('重排先取消上一批 id，不留孤儿通知', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await enrollFlow(kv, exampleIdentity.key);
  const opts = {
    kv,
    notifier,
    flows: [{ flow: medicationFlow, enrollmentKey: exampleIdentity.key, legacyEnrollmentId: medicationFlow.id }],
    now: NOW,
    deviceTz: tz,
  };
  await rescheduleReminders(opts);
  await rescheduleReminders({ ...opts, now: NOW + MS_PER_DAY });

  assert.deepEqual(cancelled[1], (scheduled[0] ?? []).map((r) => r.id));
});

test('未登记或顺序型 entry 不排提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const coffeeIdentity = reminderEnrollmentIdentity(coffeeFlow.id, 'example', [coffeeFlow]);
  await enrollFlow(kv, coffeeIdentity.key);

  await rescheduleReminders({
    kv,
    notifier,
    flows: [
      { flow: coffeeFlow, enrollmentKey: coffeeIdentity.key, legacyEnrollmentId: coffeeFlow.id },
      { flow: medicationFlow, enrollmentKey: exampleIdentity.key, legacyEnrollmentId: medicationFlow.id },
    ],
    now: NOW,
    deviceTz: tz,
  });
  assert.deepEqual(scheduled.at(-1), []);
});

test('提醒总量截断到 RESCHEDULE_CAP', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const flows = [0, 1, 2, 3].map((i) => ({ ...medicationFlow, id: `med-${i}`, timeZone: 'UTC' }));
  const entries = flows.map((flow) => {
    const identity = reminderEnrollmentIdentity(flow.id, 'owned', [medicationFlow]);
    return { flow, enrollmentKey: identity.key, legacyEnrollmentId: identity.legacyId };
  });
  for (const item of entries) await enrollFlow(kv, item.enrollmentKey);

  await rescheduleReminders({ kv, notifier, flows: entries, now: NOW, deviceTz: tz });
  const batch = scheduled.at(-1) ?? [];
  assert.equal(batch.length, RESCHEDULE_CAP);
});
