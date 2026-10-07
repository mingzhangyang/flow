import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { fixedTimeZone, MS_PER_DAY } from '../runtime/clock';
import { medicationFlow } from '../examples/medication';
import { coffeeFlow } from '../examples/coffee';
import { catalogDefinitionKey } from '../session/flowCatalog';
import { type Reminder } from './plan';
import { type Notifier } from './notifier';
import { sequentialReminderId } from './notificationIdentity';
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
const medKey = catalogDefinitionKey(medicationFlow.id, 'example');

test('enroll / unenroll 仅保存 definitionKey 且幂等', async () => {
  const kv = createInMemoryKV();
  await enrollFlow(kv, medKey);
  await enrollFlow(kv, medKey);
  assert.deepEqual(await enrolledFlowKeys(kv), [medKey]);
  await unenrollFlow(kv, medKey);
  await unenrollFlow(kv, medKey);
  assert.deepEqual(await enrolledFlowKeys(kv), []);
});

test('只为已登记的日程 definition 排提醒', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  await enrollFlow(kv, medKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [
      { flow: coffeeFlow, definitionKey: catalogDefinitionKey(coffeeFlow.id, 'example') },
      { flow: medicationFlow, definitionKey: medKey },
    ],
    now: NOW,
    deviceTz: tz,
  });
  assert.equal((scheduled.at(-1) ?? []).length, 3);
  assert.ok((scheduled.at(-1) ?? []).every((r) => r.data?.definitionKey === medKey));
});

test('same-id example / owned enrollment 完全隔离', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const owned = { ...medicationFlow, title: 'owned' };
  const exampleKey = catalogDefinitionKey(medicationFlow.id, 'example');
  const ownedKey = catalogDefinitionKey(owned.id, 'owned');

  await enrollFlow(kv, exampleKey);
  await rescheduleReminders({
    kv,
    notifier,
    flows: [{ flow: owned, definitionKey: ownedKey }],
    now: NOW,
    deviceTz: tz,
  });
  assert.deepEqual(scheduled.at(-1), []);
});

test('重排先取消上一批 id', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await enrollFlow(kv, medKey);
  const opts = {
    kv,
    notifier,
    flows: [{ flow: medicationFlow, definitionKey: medKey }],
    now: NOW,
    deviceTz: tz,
  };
  await rescheduleReminders(opts);
  await rescheduleReminders({ ...opts, now: NOW + MS_PER_DAY });
  assert.deepEqual(cancelled[1], (scheduled[0] ?? []).map((r) => r.id));
});

test('提醒总量截断到 RESCHEDULE_CAP', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled } = recordingNotifier();
  const flows = [0, 1, 2, 3].map((i) => ({ ...medicationFlow, id: `med-${i}`, timeZone: 'UTC' }));
  const entries = flows.map((flow) => ({
    flow,
    definitionKey: catalogDefinitionKey(flow.id, 'owned'),
  }));
  for (const item of entries) await enrollFlow(kv, item.definitionKey);
  await rescheduleReminders({ kv, notifier, flows: entries, now: NOW, deviceTz: tz });
  assert.equal((scheduled.at(-1) ?? []).length, RESCHEDULE_CAP);
});

test('损坏 enrollment registry fail closed，enroll / unenroll 不覆盖原值', async () => {
  for (const malformed of [
    '',
    '{not json',
    JSON.stringify({ not: 'array' }),
    JSON.stringify([medKey, 7]),
    JSON.stringify([medicationFlow.id]),
  ]) {
    const kv = createInMemoryKV();
    await kv.setItem('notif:enrolled:v1', malformed);

    await assert.rejects(() => enrolledFlowKeys(kv));
    await assert.rejects(() => enrollFlow(kv, medKey));
    await assert.rejects(() => unenrollFlow(kv, medKey));
    assert.equal(await kv.getItem('notif:enrolled:v1'), malformed);
  }
});

test('损坏 previous notification id registry 时重排 fail closed，不取消也不覆盖', async () => {
  const kv = createInMemoryKV();
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await enrollFlow(kv, medKey);
  const malformed = JSON.stringify(['valid-id', 7]);
  await kv.setItem('notif:scheduled-ids:v1', malformed);

  await assert.rejects(() =>
    rescheduleReminders({
      kv,
      notifier,
      flows: [{ flow: medicationFlow, definitionKey: medKey }],
      now: NOW,
      deviceTz: tz,
    }),
  );

  assert.deepEqual(cancelled, []);
  assert.deepEqual(scheduled, []);
  assert.equal(await kv.getItem('notif:scheduled-ids:v1'), malformed);
});


test('previous-ID registry 拒绝 sequential / unrelated identifier，绝不误取消计时器', async () => {
  for (const unsafeId of [sequentialReminderId('active-run'), 'unrelated-id']) {
    const kv = createInMemoryKV();
    const { notifier, scheduled, cancelled } = recordingNotifier();
    await enrollFlow(kv, medKey);
    const persisted = JSON.stringify([unsafeId]);
    await kv.setItem('notif:scheduled-ids:v1', persisted);

    await assert.rejects(() =>
      rescheduleReminders({
        kv,
        notifier,
        flows: [{ flow: medicationFlow, definitionKey: medKey }],
        now: NOW,
        deviceTz: tz,
      }),
    );

    assert.deepEqual(cancelled, []);
    assert.deepEqual(scheduled, []);
    assert.equal(await kv.getItem('notif:scheduled-ids:v1'), persisted);
  }
});


test('enroll / unenroll 在 read-modify-write 前拒绝非 canonical definitionKey', async () => {
  const kv = createInMemoryKV();

  await assert.rejects(() => enrollFlow(kv, medicationFlow.id));
  assert.equal(await kv.getItem('notif:enrolled:v1'), null);

  await enrollFlow(kv, medKey);
  const persisted = await kv.getItem('notif:enrolled:v1');
  await assert.rejects(() => enrollFlow(kv, ` ${medKey}`));
  await assert.rejects(() => unenrollFlow(kv, medicationFlow.id));
  assert.equal(await kv.getItem('notif:enrolled:v1'), persisted);
});
