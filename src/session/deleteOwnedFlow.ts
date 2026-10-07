// 删除用户 Flow 与提醒登记的事务式编排。
// 先删除定义，避免“删除失败但提醒已关闭”；若后续 unenroll 失败，则恢复原 Flow。

import { type Flow } from '../domain/types';

export interface DeleteOwnedFlowDeps {
  removeFlow(id: string): Promise<void>;
  restoreFlow(flow: Flow): Promise<void>;
  unenroll(enrollmentKey: string, legacyEnrollmentId?: string): Promise<void>;
}

export async function deleteOwnedFlowSafely(
  flow: Flow,
  enrollmentKey: string,
  legacyEnrollmentId: string | undefined,
  deps: DeleteOwnedFlowDeps,
): Promise<void> {
  await deps.removeFlow(flow.id);
  try {
    await deps.unenroll(enrollmentKey, legacyEnrollmentId);
  } catch (error) {
    try {
      await deps.restoreFlow(flow);
    } catch {
      // 原始 unenroll 错误更能解释失败原因；恢复失败仍由调用方的后续刷新暴露状态。
    }
    throw error;
  }
}
