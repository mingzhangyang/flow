// 商店截图草稿：复用 e2e harness，在手机视口（430×932 @3x ≈ iPhone 6.7"）截取
// 三种语言的核心界面。产出到 shots/<locale>/（不入库）——正式商店截图仍需真机，
// 但构图、文案与状态在这里先定稿。用法：npm run shots
//
// 与 e2e 同一确定性：假时钟 2026-07-15 09:00、时区 Asia/Shanghai——每次截图内容一致。

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { startE2E } from './harness';

const OUT = fileURLToPath(new URL('../shots', import.meta.url));
const VIEWPORT = { width: 430, height: 932 };
const SCALE = 3;

const LOCALES = [
  { tag: 'zh-CN', dir: 'zh', brand: '准时', coffee: '法压咖啡', med: '每日服药提醒', start: '开始', done: '完成本步', checkIn: '打卡', insight: '解读' },
  { tag: 'zh-TW', dir: 'zh-Hant', brand: '準時', coffee: '法壓咖啡', med: '每日服藥提醒', start: '開始', done: '完成本步', checkIn: '打卡', insight: '解讀' },
  { tag: 'en-US', dir: 'en', brand: 'Zhunshi', coffee: 'French press coffee', med: 'Daily medication reminders', start: 'Start', done: 'Complete step', checkIn: 'Check in', insight: 'Insight' },
] as const;

async function shot(page: Page, dir: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, dir, `${name}.png`) });
  console.log(`  ✓ ${dir}/${name}.png`);
}

async function main(): Promise<void> {
  const e2e = await startE2E();
  try {
    await capture(e2e);
    console.log(`\n完成：${OUT}`);
  } finally {
    await e2e.close();
  }
}

async function capture(e2e: Awaited<ReturnType<typeof startE2E>>): Promise<void> {
  for (const l of LOCALES) {
    console.log(`▸ ${l.dir}`);
    await mkdir(path.join(OUT, l.dir), { recursive: true });
    const page = await e2e.openApp({
      locale: l.tag,
      brand: l.brand,
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      reducedMotion: 'reduce',
    });

    // 1. 首页（接下来 + 库）
    await shot(page, l.dir, '1-home');

    // 2. 运行中（沉浸计时：浸泡步骤）
    await page.getByText(l.coffee, { exact: true }).first().click();
    await page.getByText(l.start, { exact: true }).click();
    await page.getByText(l.done, { exact: true }).click();
    await page.clock.fastForward(20_000);
    await shot(page, l.dir, '2-runner');
    await page.getByText('‹', { exact: false }).first().click();

    // 3. 日程（打一剂卡后的今日清单）
    await page.getByText(l.med, { exact: true }).first().click();
    await page.getByText(l.checkIn, { exact: true }).first().click();
    await shot(page, l.dir, '3-schedule');
    await page.getByText('‹', { exact: false }).first().click();

    // 4. AI 解读（解读 + 洞察）
    await page.getByText(l.insight, { exact: true }).first().click();
    await shot(page, l.dir, '4-insight');
    await page.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
