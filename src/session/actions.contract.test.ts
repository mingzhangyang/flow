// 动作层契约测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Run, type RunEvent } from '../domain/types';
import { reduce } from '../runtime/engine';
import { coffeeFlow } from '../examples/coffee';
import {
  startAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from './actions';

const T0 = 1_000_000;

function runWith(events: RunEvent[]): Run {
  return events.reduce<Run>((r, ev) => reduce(r, ev), { id: 'r', flow: coffeeFlow, events: [] });
}

test('startAction 产生 started', () => {
  assert.deepEqual(startAction(T0), { type: 'started', at: T0 });
});

test('completeCurrent 对 instant/timed 记为完成，对 gate 记为确认', () => {
  const started = runWith([startAction(T0)]);
  // index 0 = instant(water)
  assert.deepEqual(completeCurrentAction(coffeeFlow, started.events, T0), { type: 'stepCompleted', index: 0, at: T0 });

  // 推进到 index 4 = gate(press)
  const atGate = runWith([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
    { type: 'stepCompleted', index: 1, at: T0 },
    { type: 'stepCompleted', index: 2, at: T0 },
    { type: 'stepCompleted', index: 3, at: T0 },
  ]);
  assert.deepEqual(completeCurrentAction(coffeeFlow, atGate.events, T0), { type: 'gateConfirmed', index: 4, at: T0 });
});

test('未开始或已完成时，完成/跳过动作返回 null', () => {
  assert.equal(completeCurrentAction(coffeeFlow, [], T0), null);
  assert.equal(skipCurrentAction(coffeeFlow, [], T0), null);
});

test('skip 产生带当前下标的 skipped', () => {
  const started = runWith([startAction(T0)]);
  assert.deepEqual(skipCurrentAction(coffeeFlow, started.events, T0), { type: 'skipped', index: 0, at: T0 });
});

test('pause 仅在 running 时、resume 仅在 paused 时有效', () => {
  const started = runWith([startAction(T0)]);
  assert.deepEqual(pauseAction(coffeeFlow, started.events, T0), { type: 'paused', at: T0 });
  assert.equal(resumeAction(coffeeFlow, started.events, T0), null);

  const paused = runWith([startAction(T0), { type: 'paused', at: T0 }]);
  assert.equal(pauseAction(coffeeFlow, paused.events, T0), null);
  assert.deepEqual(resumeAction(coffeeFlow, paused.events, T0), { type: 'resumed', at: T0 });
});

test('back 在第一步返回 null，靠后步返回 wentBack', () => {
  const atFirst = runWith([startAction(T0)]);
  assert.equal(backAction(coffeeFlow, atFirst.events, T0), null);

  const atSecond = runWith([startAction(T0), { type: 'stepCompleted', index: 0, at: T0 }]);
  assert.deepEqual(backAction(coffeeFlow, atSecond.events, T0), { type: 'wentBack', toIndex: 0, at: T0 });
});
