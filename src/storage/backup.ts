// 整库备份正式 v1：Flow、历史修订、definition-scoped check-ins。
// 项目尚未发布，因此不解析任何开发中间备份格式；未来版本升级时再显式新增迁移器。

import { type Flow } from '../domain/types';
import { coerceFlow } from '../domain/serialize';
import { parseDefinitionKey } from '../domain/definitionIdentity';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBackup(text: string): Backup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;
  if (
    raw.kind !== BACKUP_KIND ||
    raw.backupVersion !== BACKUP_VERSION ||
    typeof raw.exportedAt !== 'number' ||
    !Number.isFinite(raw.exportedAt) ||
    !Array.isArray(raw.flows) ||
    !isRecord(raw.revisions) ||
    !isRecord(raw.checkIns)
  ) {
    return null;
  }

  const flows: Flow[] = [];
  for (const item of raw.flows) {
    try {
      flows.push(coerceFlow(item));
    } catch {
      // Envelope is valid; individual unusable Flow records may be skipped.
    }
  }

  const revisions: Record<string, Flow[]> = {};
  for (const [id, list] of Object.entries(raw.revisions)) {
    if (!Array.isArray(list)) continue;
    const kept: Flow[] = [];
    for (const item of list) {
      try {
        const revision = coerceFlow(item);
        if (revision.id === id) kept.push(revision);
      } catch {
        // Envelope is valid; one unusable or mis-keyed revision may be skipped.
      }
    }
    if (kept.length > 0) setStringRecordValue(revisions, id, kept);
  }

  const checkIns: Record<string, CheckIn[]> = {};
  for (const [definitionKey, list] of Object.entries(raw.checkIns)) {
    if (parseDefinitionKey(definitionKey) === null || !Array.isArray(list)) continue;
    const kept = list.filter(isCheckIn);
    if (kept.length > 0) setStringRecordValue(checkIns, definitionKey, kept);
  }

  return {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAt: raw.exportedAt,
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
