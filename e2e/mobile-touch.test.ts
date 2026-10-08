import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, type E2E } from './harness';
import { assertMobileGeometry } from './mobileGeometry';

let e2e: E2E;
before(async () => { e2e = await startE2E(); });
after(async () => { await e2e.close(); });

test('owned Home card has four non-overlapping 44dp secondary actions and isolated navigation', async () => {
  const page = await e2e.openApp({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  try {
    await page.getByText('导入', { exact: true }).click();
    await page.locator('textarea').fill(JSON.stringify({
      schemaVersion: 2, id: 'mobile-touch-owned',
      title: 'Owned mobile card', topology: 'sequential',
      nodes: [{ id: 'step', kind: 'instant', label: 'Do the step' }],
    }));
    await page.getByText('确认导入', { exact: true }).click();
    await page.getByText('Owned mobile card', { exact: true }).first().waitFor();
    await assertMobileGeometry(page, 'Home with owned toolbar');

    const actions = ['解读', '编辑', '分享', '删除'];
    const boxes = [];
    for (const action of actions) {
      const button = page.getByRole('button', { name: action + ': Owned mobile card' });
      const box = await button.boundingBox();
      assert.ok(box, 'missing action ' + action);
      assert.ok(box.width >= 43.5 && box.height >= 43.5, action + ' touch box too small');
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let k = i + 1; k < boxes.length; k++) {
        const a = boxes[i]!, b = boxes[k]!;
        const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(overlapW <= 0.5 || overlapH <= 0.5, 'secondary hit areas overlap');
      }
    }
    await page.getByRole('button', { name: '解读: Owned mobile card' }).click();
    await page.getByText('AI 助手', { exact: true }).first().waitFor();
    // Navigating via the secondary action must not open Runner (card primary).
    assert.equal(await page.getByText('开始', { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});
