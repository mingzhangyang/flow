import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyReminderId,
  scheduledOccurrenceReminderId,
  sequentialReminderId,
  weeklyReminderId,
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
