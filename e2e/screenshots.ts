// Deterministic browser screenshot smoke: fixed clock, explicit locale/zone and reduced motion.
// Web screenshots are layout evidence only, not native release screenshots.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { startE2E } from './harness';
import { assertMobileGeometry } from './mobileGeometry';

const ROOT = fileURLToPath(new URL('../shots', import.meta.url));
const SMOKE = process.argv.includes('--smoke');
const SCREENS = SMOKE
  ? [{ width: 320, height: 740 }, { width: 430, height: 932 }]
  : [{ width: 430, height: 932 }];

const LOCALES = [
  { tag: 'zh-CN', dir: 'zh', brand: '准时', coffee: '法压咖啡', steep: '浸泡',
    med: '每日服药提醒', start: '开始', done: '完成本步', checkIn: '打卡',
    taken: '已服 · 09:00', insight: '解读', insightTitle: 'AI 助手',
    add: '＋ 顺序', name: '流程名称', generate: '✨ AI 生成',
    provider: 'OpenAI 兼容', back: '返回' },
  { tag: 'zh-TW', dir: 'zh-Hant', brand: '準時', coffee: '法壓咖啡', steep: '浸泡',
    med: '每日服藥提醒', start: '開始', done: '完成本步', checkIn: '打卡',
    taken: '已服 · 09:00', insight: '解讀', insightTitle: 'AI 助手',
    add: '＋ 順序', name: '流程名稱', generate: '✨ AI 生成',
    provider: 'OpenAI 相容', back: '返回' },
  { tag: 'en-US', dir: 'en', brand: 'Zhunshi', coffee: 'French press coffee', steep: 'Steep',
    med: 'Daily medication reminders', start: 'Start', done: 'Complete step', checkIn: 'Check in',
    taken: 'Taken · 09:00', insight: 'Insight', insightTitle: 'AI Assistant',
    add: '＋ Sequence', name: 'Flow name', generate: '✨ AI draft',
    provider: 'OpenAI-compatible', back: 'Back' },
] as const;

async function screenshot(page: Page, folder: string, name: string): Promise<void> {
  const directory = path.join(ROOT, folder);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name + '.png'), animations: 'disabled' });
  console.log('captured ' + folder + '/' + name);
  // Keep the diagnostic frame even when geometry validation fails. CI uploads
  // the `shots/` directory on failure, so the assertion must run afterwards.
  await assertMobileGeometry(page, folder + '/' + name);
}

async function capture(
  page: Page,
  folder: string,
  l: (typeof LOCALES)[number],
): Promise<void> {
  // The catalog must be committed, not merely a visible splash/header.
  await page.getByText(l.coffee, { exact: true }).first().waitFor({ timeout: 30000 });
  await screenshot(page, folder, '1-home');

  // Runner: wait for an actual stepped Run, never screenshot a loading shell.
  await page.getByText(l.coffee, { exact: true }).first().click();
  await page.getByText(l.start, { exact: true }).click();
  await page.getByText(l.done, { exact: true }).click();
  await page.getByText(l.steep, { exact: true }).first().waitFor();
  await page.clock.fastForward(20000);
  // The clock label proves the Run has projected the new step and elapsed time;
  // a 'Steep' timeline label alone is not proof of runner readiness.
  await page.getByText(/^03:4[01]$/, { exact: true }).first().waitFor();
  await screenshot(page, folder, '2-runner');
  await page.getByRole('button', { name: '‹ ' + l.back }).click();

  // Check-in must be DURABLE before the schedule screenshot (PR #15 contract).
  await page.getByText(l.med, { exact: true }).first().click();
  await page.getByText(l.checkIn, { exact: true }).first().click();
  await page.getByText(l.taken, { exact: true }).first().waitFor();
  await screenshot(page, folder, '3-schedule');
  await page.getByRole('button', { name: '‹ ' + l.back }).click();

  await page.getByText(l.insight, { exact: true }).first().click();
  await page.getByText(l.insightTitle, { exact: true }).first().waitFor();
  await screenshot(page, folder, '4-insight');
  await page.getByRole('button', { name: '‹ ' + l.back }).click();

  await page.getByText(l.add, { exact: true }).first().click();
  await page.getByPlaceholder(l.name, { exact: true }).waitFor();
  await screenshot(page, folder, '5-editor');
  await page.getByRole('button', { name: '‹ ' + l.back }).click();

  await page.getByText(l.generate, { exact: true }).first().click();
  await page.getByRole('button', { name: l.provider }).click();
  // A preset must be on screen before capturing the provider layout.
  await page.getByText('DeepSeek', { exact: true }).first().waitFor();
  await screenshot(page, folder, '6-generate');
}

async function main(): Promise<void> {
  const e2e = await startE2E();
  try {
    for (const l of LOCALES) {
      for (const viewport of SCREENS) {
        const folder = SMOKE ? 'smoke/' + l.dir + '/w' + viewport.width : l.dir;
        const page = await e2e.openApp({
          locale: l.tag, brand: l.brand, viewport,
          deviceScaleFactor: SMOKE ? 1 : 3,
          reducedMotion: 'reduce',
          colorScheme: 'light',
        });
        try {
          await capture(page, folder, l);
        } finally {
          await page.close();
        }
      }
    }
    console.log('Screenshots ready: ' + ROOT);
  } finally {
    await e2e.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
