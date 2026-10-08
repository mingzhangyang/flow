// A catalog change must sample current time even if no clock boundary refreshed Home.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, expectText, type E2E } from './harness';

let e2e: E2E;
before(async () => { e2e = await startE2E(); });
after(async () => { await e2e.close(); });

const owned = {
  schemaVersion: 2, id: 'catalog-clock-owned', title: 'Owned evening schedule',
  topology: 'scheduled', repeat: { kind: 'daily' },
  nodes: [{ kind: 'scheduled', id: 'evening', label: 'Owned 22:00 event', at: 22 * 60 }],
};
const seed = `localStorage.setItem('flow:catalog-clock-owned', ${JSON.stringify(JSON.stringify(owned))});`;

test('deleting last owned schedule after hours on Home uses current time for examples', async () => {
  const page = await e2e.openApp({ initScripts: [seed] });
  const upNext = page.getByTestId('home-up-next');
  await upNext.getByText('Owned 22:00 event', { exact: true }).waitFor();

  // Ordinary watchdog heartbeats sample time without changing React state.
  // The owned 22:00 event and midnight deadlines have not been crossed.
  await page.clock.runFor(6 * 60 * 60_000);
  await page.getByText('删除', { exact: true }).click();
  await upNext.getByText('每日服药提醒', { exact: true }).waitFor();
  assert.equal(await upNext.getByText('22:00', { exact: true }).count(), 1);
  assert.equal(await upNext.getByText('14:00', { exact: true }).count(), 0);
});

test('catalog changes after a clock jump project header and Up Next from the same time', async () => {
  const page = await e2e.openApp({ initScripts: [seed] });
  const upNext = page.getByTestId('home-up-next');
  await upNext.getByText('Owned 22:00 event', { exact: true }).waitFor();

  // Jump the wall clock without advancing timers: catalog invalidation, rather
  // than a watchdog callback or page remount, must update this projection.
  await page.clock.setSystemTime(new Date('2026-07-16T07:00:00+08:00'));
  await page.getByText('删除', { exact: true }).click();
  await upNext.getByText('每日服药提醒', { exact: true }).waitFor();
  assert.equal(await upNext.getByText('08:00', { exact: true }).count(), 1);
  await expectText(page, /7 月 16 日 · 周四/);
});
