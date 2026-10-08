// Browser-only responsive contract. Native hit testing and Dynamic Type require devices.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export async function assertMobileGeometry(page: Page, scene: string): Promise<void> {
  const result = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const undersized: string[] = [];
    const buttons = [...document.querySelectorAll<HTMLElement>('[role="button"]')];
    for (const button of buttons) {
      const style = getComputedStyle(button);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 43.5 || rect.height < 43.5) {
        undersized.push(
          (button.getAttribute('aria-label') || button.textContent || '<unnamed>').trim().slice(0, 55)
          + ': ' + rect.width.toFixed(1) + 'x' + rect.height.toFixed(1),
        );
      }
      if (!button.getAttribute('aria-label') && !button.textContent?.trim()) {
        undersized.push('<button missing accessible name>');
      }
    }
    return { viewport, documentWidth, undersized };
  });
  assert.ok(
    result.documentWidth <= result.viewport + 1,
    scene + ': horizontal document overflow ' + result.documentWidth + ' > ' + result.viewport,
  );
  assert.deepEqual(result.undersized, [], scene + ': button touch areas / names');
}
