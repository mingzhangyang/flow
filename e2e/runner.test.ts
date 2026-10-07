// UI 回归：顺序型运行（Phase 1 验收路径的固化）。
// 打开示例即跑（C4）；暂停/跳过/回退（C5）；整页刷新后重开恢复到原步骤、计时不重来（C6/E2）。

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

test('法压咖啡：开始 → 计时 → 暂停 → 刷新后恢复 → 跳过/回退', async () => {
  const page = await e2e.openApp();

  // 打开即可开始（C4）
  await page.getByText('法压咖啡', { exact: true }).first().click();
  assert.equal(await page.getByRole('button', { name: '‹ 返回' }).count(), 1);
  assert.equal(await page.getByText('‹ 返回', { exact: true }).count(), 0);
  await expectText(page, '共 5 步');
  await expectText(page, '04:30'); // 计时步骤合计 270s

  await page.getByText('开始', { exact: true }).click();
  await expectText(page, '加入热水'); // 第 1 步：瞬时
  await page.getByText('完成本步', { exact: true }).click();
  await expectText(page, '浸泡'); // 第 2 步：计时 240s
  await expectText(page, '让咖啡粉充分萃取'); // rationale 展示（C2）

  // 计时在走：拨快 10s 后剩余应落在 03:5x
  await page.clock.fastForward(10_000);
  await expectText(page, /03:[45]\d/);

  await page.getByText('暂停', { exact: true }).click();
  await expectText(page, /已暂停/);

  // 整页刷新 → 重开同一条 flow → 恢复到原步骤且保持暂停、计时未重来
  await page.reload();
  await page.getByText('准时', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('法压咖啡', { exact: true }).first().click();
  await expectText(page, /第 2 \/ 5 步/);
  await expectText(page, /已暂停/);
  await expectText(page, /03:[45]\d/); // 不是 04:00——计时状态从事件日志重建（E2/E4）

  // 恢复 → 跳过 → 回退（C5）
  await page.getByText('恢复', { exact: true }).click();
  await page.getByText('跳过', { exact: true }).click();
  await expectText(page, '搅拌'); // 第 3 步
  await page.getByText('上一步', { exact: true }).click();
  await expectText(page, /第 2 \/ 5 步/);
  assert.equal(await page.getByText('浸泡', { exact: true }).count() > 0, true);
});
