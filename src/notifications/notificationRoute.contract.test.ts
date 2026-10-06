// 通知点击路由契约测试（纯逻辑，不依赖 Expo 原生环境）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flowNotificationRoute, parseNotificationRoute } from './notificationRoute';
import { planSequentialReminder, planScheduledReminders } from './plan';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';
import { MS_PER_DAY } from '../runtime/clock';
import { type RunEvent } from '../domain/types';

const T0 = 1_000_000;

test('flowNotificationRoute 只携带稳定 id', () => {
  assert.deepEqual(flowNotificationRoute('flow-1'), { kind: 'flow', flowId: 'flow-1' });
  assert.deepEqual(flowNotificationRoute('flow-1', 'node-2'), {
    kind: 'flow',
    flowId: 'flow-1',
    nodeId: 'node-2',
  });
});

test('parseNotificationRoute 只用 trim 判断空值，但保留导入后的稳定 id 原值', () => {
  assert.deepEqual(parseNotificationRoute({ kind: 'flow', flowId: ' flow-1 ', nodeId: ' node-2 ' }), {
    kind: 'flow',
    flowId: ' flow-1 ',
    nodeId: ' node-2 ',
  });
});

test('parseNotificationRoute 拒绝坏数据，空 nodeId 安全降级到 Flow', () => {
  assert.equal(parseNotificationRoute(null), null);
  assert.equal(parseNotificationRoute([]), null);
  assert.equal(parseNotificationRoute({ kind: 'other', flowId: 'flow-1' }), null);
  assert.equal(parseNotificationRoute({ kind: 'flow', flowId: '   ' }), null);
  assert.deepEqual(parseNotificationRoute({ kind: 'flow', flowId: 'flow-1', nodeId: ' ' }), {
    kind: 'flow',
    flowId: 'flow-1',
  });
});

test('顺序型计时提醒携带 flowId，日程提醒额外携带 nodeId', () => {
  const events: RunEvent[] = [
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
  ];
  const sequential = planSequentialReminder(coffeeFlow, events, T0, 'run-1', 'zh');
  assert.deepEqual(sequential?.data, { kind: 'flow', flowId: coffeeFlow.id });

  const scheduled = planScheduledReminders(medicationFlow, 36_000_000, 0, MS_PER_DAY);
  assert.ok(scheduled.length > 0);
  assert.deepEqual(scheduled[0].data, {
    kind: 'flow',
    flowId: medicationFlow.id,
    nodeId: 'noon',
  });
});
