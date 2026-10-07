// UI 回归：日程型打卡（Phase 2 创始场景验收路径的固化）。
// 各剂量相互独立、漏一颗不影响其它（C5）；刷新后打卡状态保留（C6）；免责显式（E6）。
// 假时钟固定在 09:00：08:00 剂在宽限期内（可服用），14:00 / 22:00 未到点（待服）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, expectText, type E2E } from './harness';

let e2e: E2E;
before(async () => {
  e2e = await startE2E();
});
after(async () => {
  await e2e.close();
});

test('服药：逐剂打卡互不影响，刷新后保留', async (t) => {
  const page = await e2e.openApp();

  await page.getByText('每日服药提醒', { exact: true }).first().click();
  assert.equal(await page.getByRole('button', { name: '‹ 返回' }).count(), 1);
  assert.equal(await page.getByText('‹ 返回', { exact: true }).count(), 0);
  await expectText(page, /今天 · 每天/); // flow 级节律（ADR-0003）
  await expectText(page, /网页版不支持定时提醒/); // 提醒能力诚实提示（E6）：web 无定时通知
  await expectText(page, '可服用'); // 08:00 剂：09:00 仍在 120min 宽限内
  assert.equal(await page.getByText('待服', { exact: true }).count(), 2); // 14:00 / 22:00
  await expectText(page, /请以医嘱为准/); // E6 免责

  // 打卡 08:00 剂（列表按时刻排序，第一个打卡按钮即早晨剂）
  await page.getByText('打卡', { exact: true }).first().click();
  await expectText(page, '已服 · 09:00'); // 记录的是实际打卡时刻
  assert.equal(await page.getByText('待服', { exact: true }).count(), 2); // 其它剂不受影响

  // 整页刷新 → 重开 → 打卡状态保留、其余仍待服
  await page.reload();
  await page.getByText('准时', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '已服 · 09:00');
  assert.equal(await page.getByText('待服', { exact: true }).count(), 2);

  await t.diagnostic('check-in persisted across reload');
});
