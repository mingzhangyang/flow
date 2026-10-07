import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyReminderId,
  scheduledOccurrenceReminderId,
  sequentialReminderId,
  weeklyReminderId,
  parseNotificationIdentity,
  isScheduledReminderId,
} from './notificationIdentity';

test('开放 ID 中的分隔符不能造成 identifier 碰撞', () => {
  assert.notEqual(
    scheduledOccurrenceReminderId('a:b', 'c', 1),
    scheduledOccurrenceReminderId('a', 'b:c', 1),
  );
  assert.notEqual(
    dailyReminderId('a:b', 'c'),
    dailyReminderId('a', 'b:c'),
  );
  assert.notEqual(
    weeklyReminderId('a:b', 'c', 1),
    weeklyReminderId('a', 'b:c', 1),
  );
});

test('不同 reminder 类别共享同一开放 ID 也不会碰撞', () => {
  const id = 'same';
  const values = new Set([
    sequentialReminderId(id),
    dailyReminderId(id, id),
    weeklyReminderId(id, id, 1),
    scheduledOccurrenceReminderId(id, id, 1),
  ]);
  assert.equal(values.size, 4);
});


test('identifier parser 只接受 canonical versioned tuple，并区分 sequential / scheduled 域', () => {
  const sequential = sequentialReminderId('run');
  const scheduled = scheduledOccurrenceReminderId('flow', 'node', 123);
  const daily = dailyReminderId('flow', 'node');
  const weekly = weeklyReminderId('flow', 'node', 2);

  assert.deepEqual(parseNotificationIdentity(sequential), { kind: 'sequential', runId: 'run' });
  assert.equal(parseNotificationIdentity(` ${scheduled}`), null);
  assert.equal(parseNotificationIdentity(JSON.stringify(['notif-v1', 'weekly', 'flow', 'node', 9])), null);

  assert.equal(isScheduledReminderId(sequential), false);
  assert.equal(isScheduledReminderId(scheduled), true);
  assert.equal(isScheduledReminderId(daily), true);
  assert.equal(isScheduledReminderId(weekly), true);
  assert.equal(isScheduledReminderId('unrelated'), false);
});
