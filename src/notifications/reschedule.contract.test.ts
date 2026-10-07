import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV, type KVStore } from '../storage/kv';
import { fixedTimeZone, MS_PER_DAY } from '../runtime/clock';
import { medicationFlow } from '../examples/medication';
import { coffeeFlow } from '../examples/coffee';
import { catalogDefinitionKey } from '../session/flowCatalog';
import { type Reminder } from './plan';
import { type Notifier } from './notifier';
import { dailyReminderId, sequentialReminderId } from './notificationIdentity';
import { cancelScheduledRemindersForDefinition, enrollFlow, enrolledFlowKeys, rescheduleReminders, unenrollFlow, RESCHEDULE_CAP } from './reschedule';

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
  await assert.rejects(() => cancelScheduledRemindersForDefinition({ kv, notifier, definitionKey: medKey }));
  assert.deepEqual(cancelled, []);
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
    await assert.rejects(() => cancelScheduledRemindersForDefinition({ kv, notifier, definitionKey: medKey }));
    assert.deepEqual(cancelled, []);
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

for (const recovery of ['retry', 'remove'] as const) {
  test(`mid-batch failure tracks every candidate ID for ${recovery}`, async () => {
    const kv = createInMemoryKV();
    await enrollFlow(kv, medKey);
    const oldId = dailyReminderId(medKey, 'old-dose');
    await kv.setItem('notif:scheduled-ids:v1', JSON.stringify([oldId]));
    const pending = new Set([oldId]);
    let fail = true;
    let expectedIds: string[] = [];
    const notifier: Notifier = {
      ...recordingNotifier().notifier,
      async cancel(ids) { for (const id of ids) pending.delete(id); },
      async schedule(reminders) {
        expectedIds = reminders.map((r) => r.id);
        if (reminders.length > 0) {
          const durable = JSON.parse((await kv.getItem('notif:scheduled-ids:v1')) as string) as string[];
          assert.ok(expectedIds.every((id) => durable.includes(id)), 'all IDs must be durable before native scheduling');
        }
        for (const [i, reminder] of reminders.entries()) {
          pending.add(reminder.id);
          if (fail && i === 0) throw new Error('native batch failed after one scheduled item');
        }
      },
    };
    const opts = { kv, notifier, flows: [{ flow: medicationFlow, definitionKey: medKey }], now: NOW, deviceTz: tz };
    await assert.rejects(() => rescheduleReminders(opts));
    const registry = JSON.parse((await kv.getItem('notif:scheduled-ids:v1')) as string) as string[];
    assert.deepEqual(new Set(registry), new Set([oldId, ...expectedIds]));
    assert.ok([...pending].every((id) => registry.includes(id)));

    fail = false;
    if (recovery === 'remove') await unenrollFlow(kv, medKey);
    await rescheduleReminders(opts);
    assert.deepEqual(pending, new Set(recovery === 'retry' ? expectedIds : []));
    assert.deepEqual(JSON.parse((await kv.getItem('notif:scheduled-ids:v1')) as string), [...pending]);
  });
}

test('recovery-set persistence failure stops all platform side effects', async () => {
  const base = createInMemoryKV();
  await enrollFlow(base, medKey);
  const oldId = dailyReminderId(medKey, 'old-dose');
  const original = JSON.stringify([oldId]);
  await base.setItem('notif:scheduled-ids:v1', original);
  const kv: KVStore = { ...base, async setItem() { throw new Error('disk full'); } };
  const { notifier, scheduled, cancelled } = recordingNotifier();
  await assert.rejects(() => rescheduleReminders({ kv, notifier, flows: [{ flow: medicationFlow, definitionKey: medKey }], now: NOW, deviceTz: tz }), /disk full/);
  assert.deepEqual(scheduled, []);
  assert.deepEqual(cancelled, []);
  assert.equal(await base.getItem('notif:scheduled-ids:v1'), original);
});

for (const failure of ['cancel', 'final registry write'] as const) {
  test(`${failure} failure preserves recovery IDs until a subsequent cleanup succeeds`, async () => {
    const base = createInMemoryKV();
    await enrollFlow(base, medKey);
    const oldId = dailyReminderId(medKey, 'old-dose');
    await base.setItem('notif:scheduled-ids:v1', JSON.stringify([oldId]));
    const pending = new Set([oldId]);
    let writes = 0;
    let fail = true;
    const kv: KVStore = {
      ...base,
      async setItem(key, value) {
        if (key === 'notif:scheduled-ids:v1' && ++writes === 2 && failure === 'final registry write' && fail) {
          throw new Error('registry commit failed');
        }
        await base.setItem(key, value);
      },
    };
    const notifier: Notifier = {
      ...recordingNotifier().notifier,
      async cancel(ids) {
        for (const id of ids) {
          pending.delete(id);
          if (fail && failure === 'cancel') throw new Error('partial cancellation');
        }
      },
      async schedule(reminders) { for (const r of reminders) pending.add(r.id); },
    };
    const opts = { kv, notifier, flows: [{ flow: medicationFlow, definitionKey: medKey }], now: NOW, deviceTz: tz };
    await assert.rejects(() => rescheduleReminders(opts));
    const registry = JSON.parse((await base.getItem('notif:scheduled-ids:v1')) as string) as string[];
    assert.ok(registry.includes(oldId));
    assert.ok([...pending].every((id) => registry.includes(id)));
    fail = false;
    await unenrollFlow(base, medKey);
    await rescheduleReminders(opts);
    assert.equal(pending.size, 0);
    assert.deepEqual(JSON.parse((await base.getItem('notif:scheduled-ids:v1')) as string), []);
  });
}

test('definition cancellation removes only exact owned IDs, preserving same-ID example and other flows', async () => {
  const kv = createInMemoryKV();
  const ownedKey = catalogDefinitionKey(medicationFlow.id, 'owned');
  const target = dailyReminderId(ownedKey, 'dose');
  const kept = [dailyReminderId(medKey, 'dose'), dailyReminderId(catalogDefinitionKey('other', 'owned'), 'dose')];
  await kv.setItem('notif:scheduled-ids:v1', JSON.stringify([target, ...kept]));
  const { notifier, cancelled } = recordingNotifier();
  await cancelScheduledRemindersForDefinition({ kv, notifier, definitionKey: ownedKey });
  assert.deepEqual(cancelled, [[target]]);
  assert.deepEqual(JSON.parse((await kv.getItem('notif:scheduled-ids:v1')) as string), kept);
});

for (const failure of ['platform', 'registry'] as const) {
  test(`definition cancellation ${failure} failure leaves the original recovery set for retry`, async () => {
    const base = createInMemoryKV();
    const ids = [dailyReminderId(medKey, 'dose-a'), dailyReminderId(medKey, 'dose-b')];
    const original = JSON.stringify(ids);
    await base.setItem('notif:scheduled-ids:v1', original);
    const pending = new Set(ids);
    let fail = true;
    const kv: KVStore = {
      ...base,
      async setItem(key, value) {
        if (fail && failure === 'registry') throw new Error('registry write failed');
        await base.setItem(key, value);
      },
    };
    const notifier: Notifier = {
      ...recordingNotifier().notifier,
      async cancel(ids) {
        for (const id of ids) {
          pending.delete(id);
          if (fail && failure === 'platform') throw new Error('partial platform cancel');
        }
      },
    };
    await assert.rejects(() => cancelScheduledRemindersForDefinition({ kv, notifier, definitionKey: medKey }));
    assert.equal(await base.getItem('notif:scheduled-ids:v1'), original);
    fail = false;
    await cancelScheduledRemindersForDefinition({ kv, notifier, definitionKey: medKey });
    assert.equal(pending.size, 0);
    assert.equal(await base.getItem('notif:scheduled-ids:v1'), '[]');
  });
}
