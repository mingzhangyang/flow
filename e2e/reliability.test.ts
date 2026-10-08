// Regression for confirmed check-in writes, stale async navigation, and Home time projection.
// External AI service and storage failures are deterministic injected adapters (C10/E3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, expectText, type E2E } from './harness';
import { catalogDefinitionKey } from '../src/session/flowCatalog';

let e2e: E2E;
before(async () => { e2e = await startE2E(); });
after(async () => { await e2e.close(); });

test('failed check-in never displays as taken; retry commits and survives reload', async () => {
  const page = await e2e.openApp({
    initScripts: [`
      (() => {
        const original = Storage.prototype.setItem;
        let fail = true;
        Storage.prototype.setItem = function (key, value) {
          if (fail && String(key).includes('checkins:v1:')) {
            fail = false;
            throw new Error('simulated durable-write failure');
          }
          return original.call(this, key, value);
        };
      })();
    `],
  });
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '可服用');
  await page.getByText('打卡', { exact: true }).first().click();
  await expectText(page, /打卡未确认保存/);
  assert.equal(await page.getByText(/已服 · 09:00/).count(), 0);
  await page.getByText('重试', { exact: true }).last().click();
  await expectText(page, '已服 · 09:00');
  await page.reload();
  await page.getByText('准时', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '已服 · 09:00');
});

test('Schedule undo remains removed after restoring an older backup containing that same dose', async () => {
  const page = await e2e.openApp();
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '可服用');
  await page.getByText('打卡', { exact: true }).first().click();
  await expectText(page, '已服 · 09:00');
  await page.getByText('撤销', { exact: true }).first().click();
  await expectText(page, '可服用');
  await page.getByRole('button', { name: '‹ 返回' }).click();

  const oldDose = {
    nodeId: 'morning', scheduledFor: Date.parse('2026-07-15T08:00:00+08:00'),
    taken: true, at: Date.parse('2026-07-15T09:00:00+08:00'),
  };
  const key = catalogDefinitionKey('example.medication', 'example');
  await page.getByText('导入', { exact: true }).click();
  await page.locator('textarea').fill(JSON.stringify({
    kind: 'zhunshi-backup', backupVersion: 1, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [oldDose] },
  }));
  await page.getByText('确认导入', { exact: true }).click();
  await page.getByText('每日服药提醒', { exact: true }).first().waitFor();
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '可服用');
  assert.equal(await page.getByText('已服 · 09:00', { exact: true }).count(), 0);
  await page.reload();
  await page.getByText('每日服药提醒', { exact: true }).first().click();
  await expectText(page, '可服用');
  assert.equal(await page.getByText('已服 · 09:00', { exact: true }).count(), 0);
});

test('AI Generate old successful response after Back cannot navigate to Editor', async () => {
  const page = await e2e.openApp();
  let release!: () => void;
  let arrived!: () => void;
  let completed!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  const done = new Promise<void>((resolve) => { completed = resolve; });
  await page.route('**/v1/messages', async (route) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': '*',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    arrived();
    await hold;
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        content: [{
          type: 'text',
          text: JSON.stringify({
            title: 'Stale generated flow',
            topology: 'sequential',
            nodes: [{ kind: 'instant', label: 'Late step' }],
          }),
        }],
      }),
    });
    completed();
  });
  await page.getByText('✨ AI 生成', { exact: true }).click();
  await page.getByPlaceholder('例：法压咖啡——倒 92 度热水，浸泡 4 分钟，压下压杆再倒出').fill('做咖啡');
  await page.getByPlaceholder('sk-...').fill('fake-key');
  await page.getByText('生成草稿', { exact: true }).click();
  await started;
  await page.getByRole('button', { name: '‹ 返回' }).click();
  await expectText(page, '示例');
  release();
  await done;
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText('Stale generated flow').count(), 0);
  assert.equal(await page.getByPlaceholder('流程名称').count(), 0);
});

test('Home Up Next follows occurrence boundaries and local midnight without a remount', async () => {
  const page = await e2e.openApp();
  const upNext = page.getByTestId('home-up-next');
  await upNext.getByText('14:00', { exact: true }).waitFor();
  await page.clock.fastForward(5 * 60 * 60_000 + 1);
  await upNext.getByText('22:00', { exact: true }).waitFor();
  await page.clock.fastForward(10 * 60 * 60_000);
  await expectText(page, /7 月 16 日 · 周四/);
  await upNext.getByText('08:00', { exact: true }).waitFor();
});

test('Home watchdog survives a backward wall-clock jump with the same Up Next deadline', async () => {
  const page = await e2e.openApp();
  const upNext = page.getByTestId('home-up-next');
  await upNext.getByText('14:00', { exact: true }).waitFor();

  // Changing the system clock without advancing timers models an OS/user clock
  // correction. The same upcoming 14:00 event stays authoritative, so a React
  // effect depending only on nextRefreshAt would *not* be reinstalled.
  await page.clock.setSystemTime(new Date(Date.parse('2026-07-15T08:00:00+08:00')));
  await page.clock.fastForward(60_000);
  await upNext.getByText('14:00', { exact: true }).waitFor();

  // At 08:01, the same deadline is still 14:00:00.001, 5h59m later.
  // The next boundary must still fire without navigating away or remounting.
  await page.clock.fastForward(5 * 60 * 60_000 + 59 * 60_000 + 1);
  await upNext.getByText('22:00', { exact: true }).waitFor();
});

test('Import double-click does not commit the same flow twice', async () => {
  const page = await e2e.openApp();
  await page.getByText('导入', { exact: true }).click();
  await page.locator('textarea').fill(JSON.stringify({
    schemaVersion: 2, id: 'reliability-import', title: 'Imported once',
    topology: 'sequential', nodes: [{ kind: 'instant', id: 'a', label: 'Step' }],
  }));
  await page.getByText('确认导入', { exact: true }).dblclick();
  await expectText(page, 'Imported once');
  await page.getByText('Imported once', { exact: true }).click();
  await expectText(page, /开始|随时开始/);
  await page.getByRole('button', { name: '‹ 返回' }).click();
  await expectText(page, 'v1');
});
