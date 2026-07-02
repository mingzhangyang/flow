// IANA 时区适配器契约测试（C10）：名字 + 时刻 → 偏移由时区数据库唯一确定（确定性，E4）。
// 用真实的 2026 年美东 DST 切换点验证，与 dst.contract.test.ts 的合成阶跃时区互为印证。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ianaTimeZone, isValidTimeZoneName, timeZoneForFlow } from './ianaTimeZone';
import { fixedTimeZone, timeOfDay, instantAtTimeOfDay, MS_PER_MINUTE } from './clock';
import { nextEvents } from './engine';
import { type Flow } from '../domain/types';
import { serializeFlow, deserializeFlow } from '../domain/serialize';
import { validateFlow } from '../domain/validate';
import { setMeta } from '../domain/editing';

const MIN = MS_PER_MINUTE;

// 2026 年美东：3 月 8 日 07:00Z 进入夏令时（EST -300 → EDT -240），11 月 1 日 06:00Z 退出。
const NY_SPRING = Date.UTC(2026, 2, 8, 7, 0);
const NY_FALL = Date.UTC(2026, 10, 1, 6, 0);

test('偏移随时刻取值：纽约跨春令时，上海恒定 +480', () => {
  const ny = ianaTimeZone('America/New_York');
  assert.equal(ny.offsetAt(NY_SPRING - 1), -300); // EST
  assert.equal(ny.offsetAt(NY_SPRING), -240); // EDT
  assert.equal(ny.offsetAt(NY_FALL - 1), -240);
  assert.equal(ny.offsetAt(NY_FALL), -300);

  const sh = ianaTimeZone('Asia/Shanghai');
  assert.equal(sh.offsetAt(NY_SPRING), 480);
  assert.equal(sh.offsetAt(NY_FALL), 480);
});

test('instantAtTimeOfDay 配合 IANA 时区：被跳过的 02:30 落到 03:00 EDT', () => {
  const ny = ianaTimeZone('America/New_York');
  const anchor = Date.UTC(2026, 2, 8, 6, 0); // 当地 01:00 EST
  const at = instantAtTimeOfDay(anchor, 150, ny); // 02:30 当天不存在
  assert.equal(at, NY_SPRING); // 03:00 EDT
  assert.equal(timeOfDay(at, ny), 180);
});

test('instantAtTimeOfDay 配合 IANA 时区：出现两次的 01:30 取第一次（EDT）', () => {
  const ny = ianaTimeZone('America/New_York');
  const anchor = Date.UTC(2026, 10, 1, 4, 0); // 当地 00:00 EDT
  const at = instantAtTimeOfDay(anchor, 90, ny); // 01:30 出现两次
  assert.equal(at, Date.UTC(2026, 10, 1, 5, 30)); // 第一次：01:30 EDT
  assert.equal(timeOfDay(Date.UTC(2026, 10, 1, 6, 30), ny), 90); // 第二次也是 01:30（EST）
});

test('nextEvents 用 IANA 时区跨切换日：提醒钉在墙钟 08:00', () => {
  const flow: Flow = {
    schemaVersion: 2,
    id: 'ny-med',
    title: '纽约服药',
    topology: 'scheduled',
    timeZone: 'America/New_York',
    repeat: { kind: 'daily' },
    nodes: [{ kind: 'scheduled', id: 'a', label: '早餐药', at: 480 }],
  };
  const tz = timeZoneForFlow(flow, fixedTimeZone(0));
  // now = 3 月 7 日当地 09:00 EST（14:00Z），当天 08:00 已过
  const now = Date.UTC(2026, 2, 7, 14, 0);
  const [occ] = nextEvents(flow, now, tz, 2 * 24 * 60 * MIN);
  assert.equal(occ.at, Date.UTC(2026, 2, 8, 12, 0)); // 3 月 8 日 08:00 EDT
  assert.equal(timeOfDay(occ.at, tz), 480);
  // 与前一天 08:00 EST（13:00Z）的绝对间隔是 23 小时
  assert.equal(occ.at - Date.UTC(2026, 2, 7, 13, 0), 23 * 60 * MIN);
});

test('timeZoneForFlow：未锚定或名字无效时回退', () => {
  const fallback = fixedTimeZone(480);
  assert.equal(timeZoneForFlow({}, fallback), fallback);
  assert.equal(timeZoneForFlow({ timeZone: 'Not/A_Zone' }, fallback), fallback);
  assert.equal(timeZoneForFlow({ timeZone: 'Asia/Tokyo' }, fallback).offsetAt(NY_SPRING), 540);
});

test('isValidTimeZoneName', () => {
  assert.equal(isValidTimeZoneName('Asia/Shanghai'), true);
  assert.equal(isValidTimeZoneName('America/New_York'), true);
  assert.equal(isValidTimeZoneName('Not/A_Zone'), false);
  assert.equal(isValidTimeZoneName(''), false);
});

// ---- 领域侧：字段校验、编辑与序列化 round-trip ----

const anchored: Flow = {
  schemaVersion: 2,
  id: 'f',
  title: 't',
  topology: 'scheduled',
  timeZone: 'Asia/Shanghai',
  repeat: { kind: 'daily' },
  nodes: [{ kind: 'scheduled', id: 'a', label: 'A', at: 480 }],
};

test('validateFlow：timeZone 形状校验（空串非法、缺省合法）', () => {
  assert.deepEqual(validateFlow(anchored), []);
  assert.ok(validateFlow({ ...anchored, timeZone: '  ' }).some((i) => i.path === 'timeZone'));
  const { timeZone: _omit, ...noTz } = anchored;
  assert.deepEqual(validateFlow(noTz), []);
});

test('serialize round-trip 保留 timeZone（E5 无损）', () => {
  const back = deserializeFlow(serializeFlow(anchored));
  assert.equal(back.timeZone, 'Asia/Shanghai');
});

test('setMeta：可设置锚定，空串清除（回到跟随设备）', () => {
  const set = setMeta(anchored, { timeZone: 'America/New_York' });
  assert.equal(set.timeZone, 'America/New_York');
  const cleared = setMeta(set, { timeZone: '' });
  assert.equal(cleared.timeZone, undefined);
  const untouched = setMeta(set, { title: 'x' });
  assert.equal(untouched.timeZone, 'America/New_York');
});
