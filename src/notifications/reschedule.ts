// 日程提醒的登记与重排编排（C5）。
//
// 新 enrollment 以对象记录 {v:2,key} 持久化；旧版本 string[] 作为 legacy bare flowId 读取。
// 结构化记录与字符串在 JSON 类型层面分离，因此开放 Flow ID 无法与新 catalog key 碰撞。
// legacy bare ID 只在 catalog entry 显式声明 legacyEnrollmentId 时迁移；shadowing owned 不声明，
// 从而不会把示例旧登记转给同 id 用户 Flow。

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
  enrollmentKey: string;
  legacyEnrollmentId?: string;
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

/** 调试/测试视图：legacy 返回原字符串，v2 返回其 canonical key。 */
export async function enrolledFlowKeys(kv: KVStore): Promise<string[]> {
  return (await readEnrollments(kv)).map((record) =>
    typeof record === 'string' ? record : record.key);
}

/** 为某个 catalog 定义开启提醒（幂等）；新数据永远写结构化 v2 记录。 */
export async function enrollFlow(kv: KVStore, enrollmentKey: string): Promise<void> {
  const records = await readEnrollments(kv);
  if (records.some((record) => typeof record !== 'string' && record.key === enrollmentKey)) return;
  await writeEnrollments(kv, [...records, { v: 2, key: enrollmentKey }]);
}

/**
 * 关闭某个 catalog 定义的提醒登记（幂等）。
 * legacyEnrollmentId 只在来源无歧义时传入，因此不会误删另一个 catalog 定义的旧登记。
 */
export async function unenrollFlow(
  kv: KVStore,
  enrollmentKey: string,
  legacyEnrollmentId?: string,
): Promise<void> {
  const records = await readEnrollments(kv);
  const next = records.filter((record) => {
    if (typeof record === 'string') return record !== legacyEnrollmentId;
    return record.key !== enrollmentKey;
  });
  if (next.length !== records.length) await writeEnrollments(kv, next);
}

/**
 * 重排全部已登记 catalog 定义的日程提醒。
 * 匹配到无歧义 legacy bare ID 时会原地迁移为 v2 结构化记录。
 */
export async function rescheduleReminders(opts: {
  kv: KVStore;
  notifier: Notifier;
  flows: ScheduledCatalogEntry[];
  now: Instant;
  deviceTz: TimeZone;
}): Promise<void> {
  const records = await readEnrollments(opts.kv);
  const current = new Set(
    records.flatMap((record) => typeof record === 'string' ? [] : [record.key]),
  );
  const legacy = new Set(
    records.flatMap((record) => typeof record === 'string' ? [record] : []),
  );

  const migratedLegacy = new Set<string>();
  const migratedKeys = new Set<string>();
  const activeEntries = opts.flows.filter((entry) => {
    if (current.has(entry.enrollmentKey)) return true;
    if (entry.legacyEnrollmentId && legacy.has(entry.legacyEnrollmentId)) {
      migratedLegacy.add(entry.legacyEnrollmentId);
      migratedKeys.add(entry.enrollmentKey);
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
    .map(({ flow }) => ({
      flow,
      tz: timeZoneForFlow(flow, opts.deviceTz),
      repeatingTriggers: !flow.timeZone,
    }));
  const reminders = planScheduledBatch(entries, opts.now, RESCHEDULE_HORIZON_MS, RESCHEDULE_CAP);

  const prevIds = await readStringArray(opts.kv, LAST_IDS_KEY);
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(reminders.map((r) => r.id)));
}
