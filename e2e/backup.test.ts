// UI 回归：整库备份 → 全新环境恢复（C6 兜底的端到端）。
// 设备 A 打卡后备份（Web 无分享面板 → 剪贴板回退）；设备 B（全新 localStorage）
// 粘贴备份 → 自动识别 → 恢复后打卡记录回来。

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

test('打卡 → 备份到剪贴板 → 新环境导入 → 打卡记录恢复', async () => {
  // 设备 A：打一剂卡，然后备份
  const a = await e2e.openApp();
  await a.getByText('每日服药提醒', { exact: true }).first().click();
  await a.getByText('打卡', { exact: true }).first().click();
  await expectText(a, '已服 · 09:00');
  await a.getByText('‹ 返回', { exact: true }).click();

  await a.getByText('备份', { exact: true }).click();
  await expectText(a, /已复制备份数据/); // headless 无 Web Share → 剪贴板回退
  const text = await a.evaluate(() =>
    (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } })
      .navigator.clipboard.readText(),
  );
  const backup = JSON.parse(text) as {
    kind: string;
    backupVersion: number;
    checkIns?: Record<string, unknown[]>;
  };
  assert.equal(backup.kind, 'zhunshi-backup');
  assert.equal(backup.backupVersion, 1);
  assert.equal(
    Object.values(backup.checkIns ?? {}).reduce((count, log) => count + log.length, 0),
    1,
  );

  // 设备 B：全新环境，粘贴备份 → 自动识别 → 恢复
  const b = await e2e.openApp();
  await b.getByText('导入', { exact: true }).click();
  await b.locator('textarea').fill(text);
  await expectText(b, /检测到整库备份/);
  await b.getByText('确认导入', { exact: true }).click();
  await b.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(b, '已服 · 09:00'); // 打卡记录跨设备回来了（C6）
});
