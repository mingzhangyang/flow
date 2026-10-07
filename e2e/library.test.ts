// UI 回归：编辑 → 保存 → 导出 → 导入闭环（Phase 3 验收路径的固化，C2/C6/E5），
// once「过时不候」提示在编辑器可见（默认值的语义显式化），AI 解读入口可用（AI-C4①）。

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

test('新建顺序型 → 保存 → 导出 JSON → 改 id/标题后导入 → 库中新增一条', async () => {
  const page = await e2e.openApp();

  // 新建并保存（编辑可以复杂，C2）
  await page.getByText('＋ 顺序', { exact: true }).click();
  await page.getByPlaceholder('流程名称').fill('手冲滴滤');
  await page.getByText('＋ 添加步骤', { exact: true }).click();
  await page.getByPlaceholder('这一步做什么').last().fill('烧水到 92 度');
  await page.getByPlaceholder('为什么（可选）').last().fill('过烫会萃出焦苦');
  await page.getByText('保存', { exact: true }).click();
  await expectText(page, '我的');
  await expectText(page, '手冲滴滤');

  // 导出：数据区是合法 JSON 且 round-trip 出同一标题（E5）
  await page.getByText('分享', { exact: true }).first().click();
  await expectText(page, '仅数据（JSON）');
  const json = await page.locator('textarea').inputValue();
  const flow = JSON.parse(json) as { id: string; title: string; schemaVersion: number };
  assert.equal(flow.title, '手冲滴滤');
  assert.equal(typeof flow.schemaVersion, 'number');

  // 改 id / 标题后导入 → 库中新增一条（不覆盖原条目）
  const copy = json.replace(flow.id, `${flow.id}-copy`).replace('手冲滴滤', '手冲滴滤 复制版');
  await page.getByRole('button', { name: '‹ 返回' }).click();
  await page.getByText('导入', { exact: true }).click();
  await page.locator('textarea').fill(copy);
  await page.getByText('确认导入', { exact: true }).click();
  await expectText(page, '手冲滴滤 复制版');
  assert.equal(await page.getByText('手冲滴滤', { exact: true }).count(), 1); // 原条目还在
});

test('日程型编辑器：once「过时不候」提示可见，选每天后消失', async () => {
  const page = await e2e.openApp();

  await page.getByText('＋ 日程', { exact: true }).click();
  await expectText(page, /过时不候/); // 缺省即 once，语义在选择处说明
  await page.getByText('每天', { exact: true }).click();
  await page.getByText(/过时不候/).waitFor({ state: 'detached' });

  // 回到初始 once 语义后 draft 再次 clean；顶部返回应直接退出。
  await page.getByText('仅今天', { exact: true }).click();
  await expectText(page, /过时不候/);
  await page.getByText('‹ 返回', { exact: true }).click();
  await expectText(page, '示例');
});

test('AI 解读（本地解释器）对示例可用', async () => {
  const page = await e2e.openApp();

  await page.getByText('解读', { exact: true }).first().click();
  await expectText(page, 'AI 助手');
  await expectText(page, /顺序型|步/); // 解读文本生成
  await page.getByText('‹ 返回', { exact: true }).click();
  await expectText(page, '示例');
});

test('运行后退出并删除，重新导入相同 ID 得到新的空白运行', async () => {
  const page = await e2e.openApp();
  const flow = {
    schemaVersion: 2, id: 'deletion-lifecycle', title: '删除生命周期', topology: 'sequential',
    nodes: [{ id: 'step', kind: 'timed', label: '等待', durationSec: 60 }],
  };
  const importFlow = async (): Promise<void> => {
    await page.getByText('导入', { exact: true }).click();
    await page.locator('textarea').fill(JSON.stringify(flow));
    await page.getByText('确认导入', { exact: true }).click();
    await expectText(page, flow.title);
  };
  await importFlow();
  await page.getByText(flow.title, { exact: true }).click();
  await page.getByText('开始', { exact: true }).click();
  await page.getByText('暂停', { exact: true }).click();
  await page.getByText('‹ 返回', { exact: true }).click();
  await page.getByText('删除', { exact: true }).click();
  await page.getByText(flow.title, { exact: true }).waitFor({ state: 'detached' });

  await importFlow();
  await page.getByText(flow.title, { exact: true }).click();
  await expectText(page, '开始');
  assert.equal(await page.getByText('恢复', { exact: true }).count(), 0);
  await page.getByText('开始', { exact: true }).click();
  await expectText(page, '暂停');
});
