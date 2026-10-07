// 日程提醒登记与重排：正式 v1 只保存 catalog definitionKey。
// 没有 bare flowId enrollment，也没有开发中间格式迁移。

import { type Flow } from '../domain/types';
import { assertDefinitionKey, parseDefinitionKey } from '../domain/definitionIdentity';
import { type Instant, type TimeZone, MS_PER_DAY } from '../runtime/clock';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { type KVStore } from '../storage/kv';
import { type Notifier } from './notifier';
import { isScheduledReminderId, parseNotificationIdentity } from './notificationIdentity';
import { planScheduledBatch } from './plan';

const ENROLLED_KEY = 'notif:enrolled:v1';
const LAST_IDS_KEY = 'notif:scheduled-ids:v1';
// Recovery set: all scheduled IDs that may exist on the platform, not just a successful batch.

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

/** Caller serializes registry mutations through the catalog coordinator. */
export async function cancelScheduledRemindersForDefinition(opts: {
  kv: KVStore;
  notifier: Pick<Notifier, 'cancel'>;
  definitionKey: string;
}): Promise<void> {
  assertDefinitionKey(opts.definitionKey);
  const ids = await readStringArray(opts.kv, LAST_IDS_KEY, isScheduledReminderId);
  const owned = ids.filter((id) => {
    const identity = parseNotificationIdentity(id);
    return identity !== null && identity.kind !== 'sequential' && identity.definitionKey === opts.definitionKey;
  });
  if (owned.length === 0) return;
  await opts.notifier.cancel(owned);
  const removed = new Set(owned);
  // A failed cancel or persistence step leaves the original recovery set intact for retry.
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(ids.filter((id) => !removed.has(id))));
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
  const nextIds = reminders.map((r) => r.id);
  // Write ahead of *both* platform operations. Partial cancellation/scheduling, process exit,
  // or failure of the final write must leave every possible platform ID recoverable.
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify([...new Set([...prevIds, ...nextIds])]));
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(nextIds));
}
