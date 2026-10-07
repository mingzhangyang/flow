// 整库备份的纯逻辑（C6「Flow 永远属于用户」的兜底）：把用户的全部数据——
// flow 定义、历史修订、打卡日志——组装成一份开放格式 JSON（E5），可存文件、可发给自己；
// 读回时逐条过闸门（迁移 + 校验，同 storage 的读入约定），坏条目跳过、绝不让坏数据流入纯核心。
// 不含进行中的 Run（瞬态），也不含 AI 密钥（机密只住系统安全存储，不随备份外泄）。

import { type Flow } from '../domain/types';
import { coerceFlow } from '../domain/serialize';
import { type CheckIn, isCheckIn } from '../runtime/adherence';
import { type Instant } from '../runtime/clock';
import { setStringRecordValue } from './stringRecord';

export const BACKUP_KIND = 'zhunshi-backup';
/** 备份信封自身的版本；flow 各自携带 schemaVersion，两者独立演进（E5 加法演进）。 */
export const BACKUP_VERSION = 2;

export interface Backup {
  kind: typeof BACKUP_KIND;
  backupVersion: number;
  exportedAt: Instant;
  flows: Flow[];
  /** 按 flowId 的历史修订快照。 */
  revisions: Record<string, Flow[]>;
  /** v1 legacy：按裸 flowId 的打卡日志。 */
  checkIns: Record<string, CheckIn[]>;
  /** v2 additive：按 catalog definitionKey 的打卡日志。旧 Backup 对此字段可缺省。 */
  definitionCheckIns?: Record<string, CheckIn[]>;
  /**
   * 曾经发生过 owned/example source 歧义的裸 Flow ID。
   * 这是迁移安全元数据：一旦进入 quarantine，跨设备恢复后也不能重新授予 legacy alias。
   */
  legacyAmbiguousFlowIds?: string[];
}

/** 组装备份文本（缩进 2、末尾换行，与 serializeFlow 同一可读约定）。 */
export function buildBackup(data: {
  flows: Flow[];
  revisions: Record<string, Flow[]>;
  checkIns: Record<string, CheckIn[]>;
  definitionCheckIns?: Record<string, CheckIn[]>;
  legacyAmbiguousFlowIds?: string[];
  exportedAt: Instant;
}): string {
  const backup: Backup = {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAt: data.exportedAt,
    flows: data.flows,
    revisions: data.revisions,
    checkIns: data.checkIns,
    definitionCheckIns: data.definitionCheckIns ?? {},
    legacyAmbiguousFlowIds: [...new Set(data.legacyAmbiguousFlowIds ?? [])].sort(),
  };
  return JSON.stringify(backup, null, 2) + '\n';
}

/**
 * 解析备份文本；不是备份（或整体损坏）返回 null——调用方以此区分「整库备份」与「单条 flow」。
 * 各部分逐条过闸门：坏 flow / 坏快照 / 坏打卡条目单独丢弃，尽量保住其余数据。
 */
export function parseBackup(text: string): Backup | null {
  let raw: {
    kind?: unknown;
    backupVersion?: unknown;
    exportedAt?: unknown;
    flows?: unknown;
    revisions?: unknown;
    checkIns?: unknown;
    definitionCheckIns?: unknown;
    legacyAmbiguousFlowIds?: unknown;
  };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || raw.kind !== BACKUP_KIND) return null;

  const flows: Flow[] = [];
  if (Array.isArray(raw.flows)) {
    for (const item of raw.flows) {
      try {
        flows.push(coerceFlow(item));
      } catch {
        // skip invalid flow
      }
    }
  }

  const revisions: Record<string, Flow[]> = {};
  if (typeof raw.revisions === 'object' && raw.revisions !== null) {
    for (const [id, list] of Object.entries(raw.revisions as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const kept: Flow[] = [];
      for (const item of list) {
        try {
          kept.push(coerceFlow(item));
        } catch {
          // skip invalid snapshot
        }
      }
      if (kept.length > 0) setStringRecordValue(revisions, id, kept);
    }
  }

  const checkIns: Record<string, CheckIn[]> = {};
  if (typeof raw.checkIns === 'object' && raw.checkIns !== null) {
    for (const [id, list] of Object.entries(raw.checkIns as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter(isCheckIn);
      if (kept.length > 0) setStringRecordValue(checkIns, id, kept);
    }
  }

  const definitionCheckIns: Record<string, CheckIn[]> = {};
  if (typeof raw.definitionCheckIns === 'object' && raw.definitionCheckIns !== null) {
    for (const [id, list] of Object.entries(raw.definitionCheckIns as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter(isCheckIn);
      // Empty arrays are meaningful v2 migration markers; preserve their presence.
      setStringRecordValue(definitionCheckIns, id, kept);
    }
  }

  let legacyAmbiguousFlowIds: string[] = [];
  if (raw.legacyAmbiguousFlowIds !== undefined) {
    // Safety metadata is all-or-nothing: silently dropping a malformed tombstone could
    // re-enable bare-ID migration on another device, so a malformed field invalidates backup.
    if (
      !Array.isArray(raw.legacyAmbiguousFlowIds) ||
      !raw.legacyAmbiguousFlowIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return null;
    }
    legacyAmbiguousFlowIds = [...new Set(raw.legacyAmbiguousFlowIds)].sort();
  }

  return {
    kind: BACKUP_KIND,
    backupVersion: typeof raw.backupVersion === 'number' ? raw.backupVersion : 1,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    flows,
    revisions,
    checkIns,
    definitionCheckIns,
    legacyAmbiguousFlowIds,
  };
}

/**
 * 合并打卡日志：同一占位（nodeId + scheduledFor）本机记录优先——
 * 恢复备份绝不覆盖设备上更新的打卡状态。
 */
export function mergeCheckIns(local: CheckIn[], incoming: CheckIn[]): CheckIn[] {
  const merged = [...local];
  for (const entry of incoming) {
    if (!local.some((c) => c.nodeId === entry.nodeId && c.scheduledFor === entry.scheduledFor)) {
      merged.push(entry);
    }
  }
  return merged;
}
