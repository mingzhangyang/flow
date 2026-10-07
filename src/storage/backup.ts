// 整库备份正式 v1：Flow、历史修订、definition-scoped check-ins。
// 项目尚未发布，因此不解析任何开发中间备份格式；未来版本升级时再显式新增迁移器。

import { type Flow } from '../domain/types';
import { coerceFlow } from '../domain/serialize';
import { type CheckIn, isCheckIn } from '../runtime/adherence';
import { type Instant } from '../runtime/clock';
import { setStringRecordValue } from './stringRecord';

export const BACKUP_KIND = 'zhunshi-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  kind: typeof BACKUP_KIND;
  backupVersion: typeof BACKUP_VERSION;
  exportedAt: Instant;
  flows: Flow[];
  /** owned Flow history，按 flowId。 */
  revisions: Record<string, Flow[]>;
  /** 正式 v1：按 catalog definitionKey。 */
  checkIns: Record<string, CheckIn[]>;
}

export function buildBackup(data: {
  flows: Flow[];
  revisions: Record<string, Flow[]>;
  checkIns: Record<string, CheckIn[]>;
  exportedAt: Instant;
}): string {
  const backup: Backup = {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAt: data.exportedAt,
    flows: data.flows,
    revisions: data.revisions,
    checkIns: data.checkIns,
  };
  return JSON.stringify(backup, null, 2) + '\n';
}

export function parseBackup(text: string): Backup | null {
  let raw: {
    kind?: unknown;
    backupVersion?: unknown;
    exportedAt?: unknown;
    flows?: unknown;
    revisions?: unknown;
    checkIns?: unknown;
  };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    return null;
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    raw.kind !== BACKUP_KIND ||
    raw.backupVersion !== BACKUP_VERSION
  ) {
    return null;
  }

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
          const revision = coerceFlow(item);
          if (revision.id === id) kept.push(revision);
        } catch {
          // skip invalid or mis-keyed snapshot
        }
      }
      if (kept.length > 0) setStringRecordValue(revisions, id, kept);
    }
  }

  const checkIns: Record<string, CheckIn[]> = {};
  if (typeof raw.checkIns === 'object' && raw.checkIns !== null) {
    for (const [definitionKey, list] of Object.entries(raw.checkIns as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter(isCheckIn);
      if (kept.length > 0) setStringRecordValue(checkIns, definitionKey, kept);
    }
  }

  return {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    flows,
    revisions,
    checkIns,
  };
}

/** 同一占位本机记录优先；恢复备份绝不覆盖设备上更新的打卡状态。 */
export function mergeCheckIns(local: CheckIn[], incoming: CheckIn[]): CheckIn[] {
  const merged = [...local];
  for (const entry of incoming) {
    if (!local.some((c) => c.nodeId === entry.nodeId && c.scheduledFor === entry.scheduledFor)) {
      merged.push(entry);
    }
  }
  return merged;
}
