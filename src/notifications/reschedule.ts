// 日程提醒登记与重排：正式 v1 只保存 catalog definitionKey。
// 没有 bare flowId enrollment，也没有开发中间格式迁移。

import { type Flow } from '../domain/types';
import { assertDefinitionKey, parseDefinitionKey } from '../domain/definitionIdentity';
import { type Instant, type TimeZone, MS_PER_DAY } from '../runtime/clock';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { type KVStore } from '../storage/kv';
import { type Notifier } from './notifier';
import { isScheduledReminderId } from './notificationIdentity';
import { planScheduledBatch } from './plan';

const ENROLLED_KEY = 'notif:enrolled:v1';
const LAST_IDS_KEY = 'notif:scheduled-ids:v1';

export const RESCHEDULE_HORIZON_MS = 7 * MS_PER_DAY;
export const RESCHEDULE_CAP = 48;

export interface ScheduledCatalogEntry {
  flow: Flow;
  definitionKey: string;
}

async function readStringArray(
  kv: KVStore,
  key: string,
  isValid: (value: string) => boolean = () => true,
): Promise<string[]> {
  const text = await kv.getItem(key);
  if (text === null) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`invalid string registry: ${key}`);
  }
  if (
    !Array.isArray(raw) ||
    !raw.every((value): value is string => typeof value === 'string' && isValid(value))
  ) {
    throw new Error(`invalid string registry: ${key}`);
  }
  return raw;
}

export function enrolledFlowKeys(kv: KVStore): Promise<string[]> {
  return readStringArray(kv, ENROLLED_KEY, (value) => parseDefinitionKey(value) !== null);
}

export async function enrollFlow(kv: KVStore, definitionKey: string): Promise<void> {
  assertDefinitionKey(definitionKey);
  const keys = await enrolledFlowKeys(kv);
  if (keys.includes(definitionKey)) return;
  await kv.setItem(ENROLLED_KEY, JSON.stringify([...keys, definitionKey]));
}

export async function unenrollFlow(kv: KVStore, definitionKey: string): Promise<void> {
  assertDefinitionKey(definitionKey);
  const keys = await enrolledFlowKeys(kv);
  if (!keys.includes(definitionKey)) return;
  await kv.setItem(ENROLLED_KEY, JSON.stringify(keys.filter((key) => key !== definitionKey)));
}

export async function rescheduleReminders(opts: {
  kv: KVStore;
  notifier: Notifier;
  flows: ScheduledCatalogEntry[];
  now: Instant;
  deviceTz: TimeZone;
}): Promise<void> {
  const enrolled = new Set(await enrolledFlowKeys(opts.kv));
  const entries = opts.flows
    .filter((entry) => entry.flow.topology === 'scheduled' && enrolled.has(entry.definitionKey))
    .map(({ flow, definitionKey }) => ({
      flow,
      definitionKey,
      tz: timeZoneForFlow(flow, opts.deviceTz),
      repeatingTriggers: !flow.timeZone,
    }));

  const reminders = planScheduledBatch(entries, opts.now, RESCHEDULE_HORIZON_MS, RESCHEDULE_CAP);
  const prevIds = await readStringArray(opts.kv, LAST_IDS_KEY, isScheduledReminderId);
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(reminders.map((r) => r.id)));
}
