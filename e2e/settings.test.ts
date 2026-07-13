// UI 回归：设置面板——语言/外观覆盖即点即生效、重载后持久（settings:v1）。
// 语言自称不翻译（在英文界面下也点得到「简体中文」）；外观断言深色调色板的根背景。

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

test('切语言：面板即时切换 → 首页生效 → 重载后持久', async () => {
  const page = await e2e.openApp();
  await page.getByText('⚙︎', { exact: true }).click();
  await expectText(page, '设置');

  await page.getByText('English', { exact: true }).click();
  await expectText(page, 'Language'); // 面板自身立即切英文
  await page.getByText('‹ Back', { exact: true }).click();
  await expectText(page, 'Zhunshi'); // 首页品牌随之切换（ADR-0002）

  await page.reload();
  await expectText(page, 'Zhunshi'); // 覆盖已持久化，浏览器仍是 zh-CN 也不回退

  // 恢复跟随系统：中文界面回来（两个区块都有该选项，语言区在前）
  await page.getByText('⚙︎', { exact: true }).click();
  await page.getByText('Follow system', { exact: true }).first().click();
  await expectText(page, '设置');
});

test('切外观：深色即点即生效（根背景换深色调色板）', async () => {
  // evaluate 回调在浏览器里跑，但类型检查在 node 环境（无 DOM lib）——经 globalThis 断言（同 backup.test.ts 的剪贴板写法）
  const darkBg = async (page: Awaited<ReturnType<E2E['openApp']>>): Promise<boolean> =>
    page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelectorAll(sel: string): Iterable<unknown> };
        getComputedStyle(el: unknown): { backgroundColor: string };
      };
      // theme.darkScheme.bg #141614
      return [...g.document.querySelectorAll('div')].some(
        (d) => g.getComputedStyle(d).backgroundColor === 'rgb(20, 22, 20)',
      );
    });

  const page = await e2e.openApp();
  assert.equal(await darkBg(page), false); // 浏览器偏好浅色 → 默认浅色

  await page.getByText('⚙︎', { exact: true }).click();
  await page.getByText('深色', { exact: true }).click();
  assert.equal(await darkBg(page), true);

  await page.getByText('浅色', { exact: true }).click();
  assert.equal(await darkBg(page), false);
});
