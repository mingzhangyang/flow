// Runtime 黄金测试（E4）：给定「Flow 定义 + 注入时钟 + 事件日志」→ 确定的可观察状态/事件序列。
// 这批用例同时是模块重构时的黄金主测试（C10）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Run, type RunEvent } from '../domain/types';
import { reduce, project, nextEvents } from './engine';
import { MS_PER_DAY } from './clock';
import { coffeeFlow } from '../examples/coffee';
import { medicationFlow } from '../examples/medication';

const T0 = 1_000_000;
const sec = (n: number): number => n * 1000;

function play(events: RunEvent[]): Run {
  return events.reduce<Run>((run, ev) => reduce(run, ev), { id: 'r', flow: coffeeFlow, events: [] });
}

// ---- 顺序型（法压咖啡）----

test('未开始时为 idle', () => {
  const s = project(coffeeFlow, [], T0);
  assert.equal(s.status, 'idle');
  assert.equal(s.currentIndex, 0);
});

test('开始后停在第一个 instant 节点，等待操作', () => {
  const run = play([{ type: 'started', at: T0 }]);
  const s = project(coffeeFlow, run.events, T0);
  assert.equal(s.status, 'running');
  assert.equal(s.currentIndex, 0); // water
  assert.equal(s.awaitingAction, true);
});

test('计时节点随 now 递减，并在到点后钳制为 0', () => {
  const run = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 }, // 进入 steep(240s)
  ]);
  assert.equal(project(coffeeFlow, run.events, T0).remainingSec, 240);
  assert.equal(project(coffeeFlow, run.events, T0 + sec(100)).remainingSec, 140);

  const done = project(coffeeFlow, run.events, T0 + sec(240));
  assert.equal(done.remainingSec, 0);
  assert.equal(done.awaitingAction, true);

  assert.equal(project(coffeeFlow, run.events, T0 + sec(300)).remainingSec, 0); // 钳制
});

test('暂停冻结计时，恢复后按暂停时长顺延', () => {
  const paused = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
    { type: 'paused', at: T0 + sec(100) },
  ]);
  const sp = project(coffeeFlow, paused.events, T0 + sec(200));
  assert.equal(sp.status, 'paused');
  assert.equal(sp.elapsedSec, 100); // 冻结在暂停点
  assert.equal(sp.remainingSec, 140);

  const resumed = reduce(paused, { type: 'resumed', at: T0 + sec(200) });
  const sr = project(coffeeFlow, resumed.events, T0 + sec(260));
  assert.equal(sr.status, 'running');
  assert.equal(sr.elapsedSec, 160); // 260 - 100(暂停) = 160
  assert.equal(sr.remainingSec, 80);
});

test('跳过当前步会前进到下一节点', () => {
  const run = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
    { type: 'skipped', index: 1, at: T0 + sec(10) },
  ]);
  assert.equal(project(coffeeFlow, run.events, T0 + sec(10)).currentIndex, 2); // stir
});

test('回退会重置目标步的计时', () => {
  const run = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
    { type: 'stepCompleted', index: 1, at: T0 + sec(240) },
    { type: 'wentBack', toIndex: 1, at: T0 + sec(300) },
  ]);
  const s = project(coffeeFlow, run.events, T0 + sec(300));
  assert.equal(s.currentIndex, 1);
  assert.equal(s.elapsedSec, 0); // 计时从回退时刻重新开始
});

test('走完所有节点后进入 completed', () => {
  const run = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
    { type: 'stepCompleted', index: 1, at: T0 + sec(240) },
    { type: 'stepCompleted', index: 2, at: T0 + sec(241) },
    { type: 'stepCompleted', index: 3, at: T0 + sec(271) },
    { type: 'gateConfirmed', index: 4, at: T0 + sec(280) },
  ]);
  const s = project(coffeeFlow, run.events, T0 + sec(280));
  assert.equal(s.status, 'completed');
  assert.equal(s.currentIndex, coffeeFlow.nodes.length);
});

test('project 是确定性的：同样输入两次调用结果一致', () => {
  const run = play([
    { type: 'started', at: T0 },
    { type: 'stepCompleted', index: 0, at: T0 },
  ]);
  const now = T0 + sec(123);
  assert.deepEqual(project(coffeeFlow, run.events, now), project(coffeeFlow, run.events, now));
});

test('reduce 守卫非法转移', () => {
  const empty: Run = { id: 'r', flow: coffeeFlow, events: [] };
  assert.throws(() => reduce(empty, { type: 'paused', at: T0 })); // 未开始
  const started = reduce(empty, { type: 'started', at: T0 });
  assert.throws(() => reduce(started, { type: 'started', at: T0 })); // 重复开始
});

// ---- 日程型（每日服药）----

test('nextEvents 计算各药的下一次触发，且互相独立', () => {
  const now = 36_000_000; // 1970-01-01 10:00 UTC
  const occ = nextEvents(medicationFlow, now, 0, MS_PER_DAY);
  assert.deepEqual(occ, [
    { nodeId: 'noon', label: '午餐后：二甲双胍 1 片', at: 50_400_000 }, // 今天 14:00
    { nodeId: 'evening', label: '睡前：他汀 1 片', at: 79_200_000 }, // 今天 22:00
    { nodeId: 'morning', label: '早餐后：降压药 1 片', at: 115_200_000 }, // 明天 08:00（今天已过）
  ]);
});

test('清晨（08:00 前）三种药都落在今天', () => {
  const now = 25_200_000; // 07:00 UTC
  const occ = nextEvents(medicationFlow, now, 0, MS_PER_DAY);
  assert.deepEqual(
    occ.map((o) => o.at),
    [28_800_000, 50_400_000, 79_200_000], // 今天 08:00 / 14:00 / 22:00
  );
});

test('nextEvents 是确定性的', () => {
  const now = 36_000_000;
  assert.deepEqual(
    nextEvents(medicationFlow, now, 0, MS_PER_DAY),
    nextEvents(medicationFlow, now, 0, MS_PER_DAY),
  );
});

test('顺序型 Flow 不产生 scheduled 事件', () => {
  assert.deepEqual(nextEvents(coffeeFlow, T0, 0, MS_PER_DAY), []);
});
