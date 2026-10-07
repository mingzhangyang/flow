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

test('flowNotificationRoute 只接受与 flowId 一致的 canonical definitionKey', () => {
  const key = catalogDefinitionKey('flow-1', 'owned');
  assert.deepEqual(flowNotificationRoute('flow-1', key, 'node-2'), {
    kind: 'flow',
    flowId: 'flow-1',
    definitionKey: key,
    nodeId: 'node-2',
  });
  assert.throws(() => flowNotificationRoute('flow-1', 'definition-1'));
  assert.throws(() => flowNotificationRoute('flow-1', catalogDefinitionKey('other', 'owned')));
});

test('parseNotificationRoute 对缺失、非 canonical 或错配 identity 全部 fail closed', () => {
  const spacedFlowId = '   ';
  const spacedKey = catalogDefinitionKey(spacedFlowId, 'example');
  assert.deepEqual(parseNotificationRoute({
    kind: 'flow',
    flowId: spacedFlowId,
    definitionKey: spacedKey,
    nodeId: ' ',
  }), {
    kind: 'flow',
    flowId: spacedFlowId,
    definitionKey: spacedKey,
    nodeId: ' ',
  });

  assert.equal(parseNotificationRoute({ kind: 'flow', flowId: 'x' }), null);
  assert.equal(parseNotificationRoute({ kind: 'flow', flowId: 'x', definitionKey: 'x' }), null);
  assert.equal(parseNotificationRoute({
    kind: 'flow',
    flowId: 'x',
    definitionKey: catalogDefinitionKey('other', 'example'),
  }), null);
  assert.equal(parseNotificationRoute({
    kind: 'flow',
    flowId: '',
    definitionKey: catalogDefinitionKey('x', 'example'),
  }), null);
});

test('顺序型与日程型提醒都携带 canonical definitionKey', () => {
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
