import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionKey } from '../domain/definitionIdentity';
import {
  dailyReminderId,
  scheduledOccurrenceReminderId,
  sequentialReminderId,
  sequentialReminderIdsForRun,
  weeklyReminderId,
  parseNotificationIdentity,
  isScheduledReminderId,
} from './notificationIdentity';

const key = (flowId: string): string => definitionKey({ source: 'owned', flowId });

test('开放 ID 中的分隔符不能造成 identifier 碰撞', () => {
  assert.notEqual(
    scheduledOccurrenceReminderId(key('a:b'), 'c', 1),
    scheduledOccurrenceReminderId(key('a'), 'b:c', 1),
  );
  assert.notEqual(
    dailyReminderId(key('a:b'), 'c'),
    dailyReminderId(key('a'), 'b:c'),
  );
  assert.notEqual(
    weeklyReminderId(key('a:b'), 'c', 1),
    weeklyReminderId(key('a'), 'b:c', 1),
  );
});

test('不同 reminder 类别共享同一开放 ID 也不会碰撞', () => {
  const id = 'same';
  const values = new Set([
    sequentialReminderId(id),
    dailyReminderId(key(id), id),
    weeklyReminderId(key(id), id, 1),
    scheduledOccurrenceReminderId(key(id), id, 1),
  ]);
  assert.equal(values.size, 4);
});


test('identifier parser 只接受 canonical versioned tuple，并区分 sequential / scheduled 域', () => {
  const sequential = sequentialReminderId('run');
  const definition = key('flow');
  const scheduled = scheduledOccurrenceReminderId(definition, 'node', 123);
  const daily = dailyReminderId(definition, 'node');
  const weekly = weeklyReminderId(definition, 'node', 2);

  assert.deepEqual(parseNotificationIdentity(sequential), { kind: 'sequential', runId: 'run' });
  assert.equal(parseNotificationIdentity(` ${scheduled}`), null);
  assert.equal(parseNotificationIdentity(JSON.stringify(['notif-v1', 'weekly', 'flow', 'node', 9])), null);

  assert.equal(isScheduledReminderId(sequential), false);
  assert.equal(isScheduledReminderId(scheduled), true);
  assert.equal(isScheduledReminderId(daily), true);
  assert.equal(isScheduledReminderId(weekly), true);
  assert.equal(isScheduledReminderId('unrelated'), false);
});


test('definition-scoped notification writers 拒绝 bare identity；sequential cleanup 只有正式 v1 ID', () => {
  assert.throws(() => scheduledOccurrenceReminderId('flow', 'node', 1));
  assert.throws(() => dailyReminderId('flow', 'node'));
  assert.throws(() => weeklyReminderId('flow', 'node', 1));
  assert.throws(() => weeklyReminderId(key('flow'), 'node', 7));

  const runId = 'run';
  assert.deepEqual(sequentialReminderIdsForRun(runId), [sequentialReminderId(runId)]);
  assert.ok(!sequentialReminderIdsForRun(runId).includes(runId));
});
