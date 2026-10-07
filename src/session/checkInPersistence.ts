// Scheduled check-ins 的 definition-scoped 读取/迁移。
// v2 key 的“存在性”本身是迁移状态：[] 表示已迁移且当前为空，不能等价于 missing。

import { type CheckIn } from '../runtime/adherence';

export interface CheckInPersistencePort {
  loadDefinitionCheckInsRecord(definitionKey: string): Promise<CheckIn[] | null>;
  saveDefinitionCheckIns(definitionKey: string, log: CheckIn[]): Promise<void>;
  loadCheckIns(flowId: string): Promise<CheckIn[]>;
  deleteCheckIns(flowId: string): Promise<void>;
}

export async function loadCheckInsForDefinition(
  port: CheckInPersistencePort,
  definitionKey: string,
  legacyFlowId?: string,
): Promise<CheckIn[]> {
  const current = await port.loadDefinitionCheckInsRecord(definitionKey);
  if (current !== null) {
    if (legacyFlowId) {
      await port.deleteCheckIns(legacyFlowId).catch(() => {
        // v2 presence marker is authoritative; stale legacy cleanup can retry later.
      });
    }
    return current;
  }

  const legacy = legacyFlowId ? await port.loadCheckIns(legacyFlowId) : [];
  // Write even []: this presence marker prevents a stale legacy record from being re-imported later.
  await port.saveDefinitionCheckIns(definitionKey, legacy);
  if (legacyFlowId) {
    await port.deleteCheckIns(legacyFlowId).catch(() => {
      // Safe because the v2 marker is already durable.
    });
  }
  return legacy;
}
