// 服药依从契约测试（C10）。tz=0，以 1970-01-01 当天为基准，时刻为整齐的毫秒值。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { todayDoses, recordCheckIn, checkIn, type CheckIn } from './adherence';
import { medicationFlow } from '../examples/medication';

const MIN = 60_000;
const H = (h: number) => h * 60 * MIN; // 当天 h 点的 Instant（tz=0，午夜=0）
const GRACE = 120; // 分钟

test('未到点为 upcoming，到点宽限内为 due，超出为 missed', () => {
  // 09:00：morning(08:00) 到点且在 2h 宽限内 → due；noon/evening 未到 → upcoming
  const at9 = todayDoses(medicationFlow, [], H(9), 0, GRACE);
  assert.deepEqual(at9.map((d) => [d.nodeId, d.status]), [
    ['morning', 'due'],
    ['noon', 'upcoming'],
    ['evening', 'upcoming'],
  ]);

  // 11:00：morning 超过 08:00+2h=10:00 宽限 → missed
  const at11 = todayDoses(medicationFlow, [], H(11), 0, GRACE);
  assert.equal(at11.find((d) => d.nodeId === 'morning')?.status, 'missed');
});

test('打卡后为 taken，且记录实际时间', () => {
  const log = recordCheckIn([], checkIn('morning', H(8), true, H(8) + 5 * MIN));
  const doses = todayDoses(medicationFlow, log, H(9), 0, GRACE);
  const m = doses.find((d) => d.nodeId === 'morning');
  assert.equal(m?.status, 'taken');
  assert.equal(m?.takenAt, H(8) + 5 * MIN);
});

test('各剂量相互独立：漏服 morning 不影响 noon 打卡', () => {
  const log = recordCheckIn([], checkIn('noon', H(14), true, H(14)));
  // 15:00：morning 早已漏服，noon 已打卡，evening 未到
  const doses = todayDoses(medicationFlow, log, H(15), 0, GRACE);
  assert.deepEqual(doses.map((d) => [d.nodeId, d.status]), [
    ['morning', 'missed'],
    ['noon', 'taken'],
    ['evening', 'upcoming'],
  ]);
});

test('显式标记未服 → missed', () => {
  const log = recordCheckIn([], checkIn('morning', H(8), false, H(9)));
  const m = todayDoses(medicationFlow, log, H(9), 0, GRACE).find((d) => d.nodeId === 'morning');
  assert.equal(m?.status, 'missed');
});

test('recordCheckIn 覆盖同一占位而非追加', () => {
  let log: CheckIn[] = [];
  log = recordCheckIn(log, checkIn('morning', H(8), false, H(9)));
  log = recordCheckIn(log, checkIn('morning', H(8), true, H(9) + MIN)); // 改主意：其实服了
  assert.equal(log.length, 1);
  assert.equal(log[0].taken, true);
});

test('todayDoses 是确定性的', () => {
  assert.deepEqual(
    todayDoses(medicationFlow, [], H(9), 0, GRACE),
    todayDoses(medicationFlow, [], H(9), 0, GRACE),
  );
});
