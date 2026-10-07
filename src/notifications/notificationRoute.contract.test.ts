import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flowNotificationRoute, parseNotificationRoute } from './notificationRoute';
import { planSequentialReminder, planScheduledReminders } from './plan';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';
import { catalogDefinitionKey } from '../session/flowCatalog';
import { MS_PER_DAY } from '../runtime/clock';
import { type RunEvent } from '../domain/types';

const T0 = 1_000_000;
const coffeeKey = catalogDefinitionKey(coffeeFlow.id, 'example');
const medKey = catalogDefinitionKey(medicationFlow.id, 'example');

test('flowNotificationRoute 总是携带 definitionKey', () => {
  assert.deepEqual(flowNotificationRoute('flow-1', 'definition-1', 'node-2'), {
    kind: 'flow',
    flowId: 'flow-1',
    definitionKey: 'definition-1',
    nodeId: 'node-2',
  });
});

test('parseNotificationRoute 保留开放字符串原值；缺 key 可解析但 catalog 会 fail closed', () => {
  assert.deepEqual(parseNotificationRoute({ kind: 'flow', flowId: '   ', definitionKey: ' d ', nodeId: ' ' }), {
    kind: 'flow',
    flowId: '   ',
    definitionKey: ' d ',
    nodeId: ' ',
  });
  assert.deepEqual(parseNotificationRoute({ kind: 'flow', flowId: 'x' }), {
    kind: 'flow',
    flowId: 'x',
  });
  assert.equal(parseNotificationRoute({ kind: 'flow', flowId: '' }), null);
});

test('顺序型与日程型提醒都携带 definitionKey', () => {
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
  ];
  const sequential = planSequentialReminder(coffeeFlow, events, T0, 'run-1', 'zh', coffeeKey);
  assert.equal(sequential?.data?.definitionKey, coffeeKey);

  const scheduled = planScheduledReminders(
    medicationFlow,
    36_000_000,
    0,
    MS_PER_DAY,
    { definitionKey: medKey },
  );
  assert.equal(scheduled[0]?.data?.definitionKey, medKey);
});
