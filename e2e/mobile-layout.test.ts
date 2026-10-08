// Layout regression is deterministic web evidence, not Android/iOS rendering proof.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, type E2E } from './harness';
import { assertMobileGeometry } from './mobileGeometry';

let e2e: E2E;
before(async () => { e2e = await startE2E(); });
after(async () => { await e2e.close(); });

const locales = [
  { tag: 'zh-CN', brand: '准时', coffee: '法压咖啡', med: '每日服药提醒',
    back: '返回', gen: '✨ AI 生成', provider: 'OpenAI 兼容', add: '＋ 顺序',
    flowName: '流程名称' },
  { tag: 'zh-TW', brand: '準時', coffee: '法壓咖啡', med: '每日服藥提醒',
    back: '返回', gen: '✨ AI 生成', provider: 'OpenAI 相容', add: '＋ 順序',
    flowName: '流程名稱' },
  { tag: 'en-US', brand: 'Zhunshi', coffee: 'French press coffee',
    med: 'Daily medication reminders', back: 'Back', gen: '✨ AI draft',
    provider: 'OpenAI-compatible', add: '＋ Sequence', flowName: 'Flow name' },
] as const;

for (const width of [320, 360, 393, 430]) {
  for (const locale of locales) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test('responsive ' + width + 'dp / ' + locale.tag + ' / ' + colorScheme, async () => {
        const page = await e2e.openApp({
          locale: locale.tag,
          brand: locale.brand,
          viewport: { width, height: 740 },
          reducedMotion: 'reduce',
          colorScheme,
        });
        try {
          await page.getByText(locale.coffee, { exact: true }).first().waitFor();
          await assertMobileGeometry(page, 'Home');
          // A late card is reachable through ScrollView, not clipped under its footer.
          await page.getByText(locale.med, { exact: true }).first().click();
          await page.getByText(locale.med, { exact: true }).first().waitFor();
          await assertMobileGeometry(page, 'Schedule');
          if (width === 320 && locale.tag === 'en-US') {
            // Overflow-only tests miss extreme word-by-word wrapping.
            // The label itself must retain meaningful reading width alongside actions.
            const medicine = await page.getByText('After lunch: metformin', { exact: true }).boundingBox();
            assert.ok(medicine && medicine.width >= 100,
              'Schedule medicine name squeezed below readable width at 320dp');
          }
          await page.getByRole('button', { name: '‹ ' + locale.back }).click();

          await page.getByText(locale.gen, { exact: true }).first().click();
          await page.getByRole('button', { name: locale.provider }).click();
          await page.getByText('DeepSeek', { exact: true }).first().waitFor();
          await assertMobileGeometry(page, 'Generate');
          await page.getByRole('button', { name: '‹ ' + locale.back }).click();

          await page.getByText(locale.add, { exact: true }).first().click();
          const title = page.getByPlaceholder(locale.flowName, { exact: true });
          await title.waitFor();
          await assertMobileGeometry(page, 'Editor');
          await title.fill(locale.coffee.repeat(8));
          await assertMobileGeometry(page, 'Editor with long title');
        } finally {
          await page.close();
        }
      });
    }
  }
}
