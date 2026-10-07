// 日程提醒登记与重排。新 enrollment 保存 catalog definitionKey；
// bare flowId 只在 entry 提供 legacyFlowId 时迁移，shadowing 状态不自动继承。

import { type Flow } from '../domain/types';
import { type Instant, type TimeZone, MS_PER_DAY } from '../runtime/clock';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { type KVStore } from '../storage/kv';
import { type Notifier } from './notifier';
import { planScheduledBatch } from './plan';

const ENROLLED_KEY = 'notif:enrolled';
const LAST_IDS_KEY = 'notif:scheduled-ids';

export const RESCHEDULE_HORIZON_MS = 7 * MS_PER_DAY;
export const RESCHEDULE_CAP = 48;

export interface ScheduledCatalogEntry {
  flow: Flow;
  definitionKey: string;
  legacyFlowId?: string;
}

interface EnrollmentRecordV2 {
  v: 2;
  key: string;
}
type StoredEnrollment = string | EnrollmentRecordV2;

function isEnrollmentRecordV2(value: unknown): value is EnrollmentRecordV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as { v?: unknown; key?: unknown };
  return raw.v === 2 && typeof raw.key === 'string';
}

async function readStringArray(kv: KVStore, key: string): Promise<string[]> {
  const text = await kv.getItem(key);
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function readEnrollments(kv: KVStore): Promise<StoredEnrollment[]> {
  const text = await kv.getItem(ENROLLED_KEY);
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is StoredEnrollment =>
      typeof item === 'string' || isEnrollmentRecordV2(item));
  } catch {
    return [];
  }
}

async function writeEnrollments(kv: KVStore, records: StoredEnrollment[]): Promise<void> {
  await kv.setItem(ENROLLED_KEY, JSON.stringify(records));
}

export async function enrolledFlowKeys(kv: KVStore): Promise<string[]> {
  return (await readEnrollments(kv)).map((record) =>
    typeof record === 'string' ? record : record.key);
}

export async function enrollFlow(kv: KVStore, definitionKey: string): Promise<void> {
  const records = await readEnrollments(kv);
  if (records.some((record) => typeof record !== 'string' && record.key === definitionKey)) return;
  await writeEnrollments(kv, [...records, { v: 2, key: definitionKey }]);
}

export async function unenrollFlow(
  kv: KVStore,
  definitionKey: string,
  legacyFlowId?: string,
): Promise<void> {
  const records = await readEnrollments(kv);
  const next = records.filter((record) => {
    if (typeof record === 'string') return record !== legacyFlowId;
    return record.key !== definitionKey;
  });
  if (next.length !== records.length) await writeEnrollments(kv, next);
}

export async function rescheduleReminders(opts: {
  kv: KVStore;
  notifier: Notifier;
  flows: ScheduledCatalogEntry[];
  now: Instant;
  deviceTz: TimeZone;
}): Promise<void> {
  const records = await readEnrollments(opts.kv);
  const current = new Set(records.flatMap((record) => typeof record === 'string' ? [] : [record.key]));
  const legacy = new Set(records.flatMap((record) => typeof record === 'string' ? [record] : []));

  const migratedLegacy = new Set<string>();
  const migratedKeys = new Set<string>();
  const activeEntries = opts.flows.filter((entry) => {
    if (current.has(entry.definitionKey)) return true;
    if (entry.legacyFlowId && legacy.has(entry.legacyFlowId)) {
      migratedLegacy.add(entry.legacyFlowId);
      migratedKeys.add(entry.definitionKey);
      return true;
    }
    return false;
  });

  if (migratedLegacy.size > 0) {
    const next: StoredEnrollment[] = records.filter(
      (record) => typeof record !== 'string' || !migratedLegacy.has(record),
    );
    for (const key of migratedKeys) {
      if (!next.some((record) => typeof record !== 'string' && record.key === key)) {
        next.push({ v: 2, key });
      }
    }
    await writeEnrollments(opts.kv, next);
  }

  const entries = activeEntries
    .filter((entry) => entry.flow.topology === 'scheduled')
    .map(({ flow, definitionKey }) => ({
      flow,
      definitionKey,
      tz: timeZoneForFlow(flow, opts.deviceTz),
      repeatingTriggers: !flow.timeZone,
    }));
  const reminders = planScheduledBatch(entries, opts.now, RESCHEDULE_HORIZON_MS, RESCHEDULE_CAP);

  const prevIds = await readStringArray(opts.kv, LAST_IDS_KEY);
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(reminders.map((r) => r.id)));
}
