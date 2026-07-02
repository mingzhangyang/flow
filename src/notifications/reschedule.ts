// 日程提醒的登记与重排编排（C5：现实里 App 可能几天不被打开，提醒不能因此断档）。
//
// - 登记（enroll）：用户打开某条日程型 flow 的运行视图 = 为它开启提醒。
//   不自动为库里所有 flow 排提醒——未被打开过的示例/导入不该突然开始推送。
// - 重排（reschedule）：App 启动、回到前台、库变更时，把已登记 flow 未来数日的
//   提醒整批重排。上一批的 id 记在 KV：先取消再排入，不留孤儿通知，
//   也不触碰顺序型运行的计时提醒（那些 id 不在这份清单里）。
// 时钟与时区依旧显式注入（E3）；计划本身是纯函数（plan.ts），本模块只做编排。

import { type Flow } from '../domain/types';
import { type Instant, type TimeZone, MS_PER_DAY } from '../runtime/clock';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { type KVStore } from '../storage/kv';
import { type Notifier } from './notifier';
import { planScheduledBatch } from './plan';

const ENROLLED_KEY = 'notif:enrolled';
const LAST_IDS_KEY = 'notif:scheduled-ids';

/** 一次重排覆盖的天数。到期前用户任何一次打开 App 都会续上。 */
export const RESCHEDULE_HORIZON_MS = 7 * MS_PER_DAY;
/** 单批提醒上限：iOS 待决通知上限为 64，留出顺序型计时提醒等余量。 */
export const RESCHEDULE_CAP = 48;

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

/** 已开启提醒的 flow id 清单。 */
export function enrolledFlowIds(kv: KVStore): Promise<string[]> {
  return readStringArray(kv, ENROLLED_KEY);
}

/** 为某条 flow 开启提醒（幂等）。 */
export async function enrollFlow(kv: KVStore, flowId: string): Promise<void> {
  const ids = await enrolledFlowIds(kv);
  if (ids.includes(flowId)) return;
  await kv.setItem(ENROLLED_KEY, JSON.stringify([...ids, flowId]));
}

/**
 * 重排全部已登记 flow 的日程提醒。
 * @param flows 候选全集（示例 + 库中全部）；已登记但不在其中的（已删除）自然不再排。
 */
export async function rescheduleReminders(opts: {
  kv: KVStore;
  notifier: Notifier;
  flows: Flow[];
  now: Instant;
  deviceTz: TimeZone;
}): Promise<void> {
  const enrolled = new Set(await enrolledFlowIds(opts.kv));
  const entries = opts.flows
    .filter((f) => f.topology === 'scheduled' && enrolled.has(f.id))
    .map((flow) => ({ flow, tz: timeZoneForFlow(flow, opts.deviceTz) }));
  const reminders = planScheduledBatch(entries, opts.now, RESCHEDULE_HORIZON_MS, RESCHEDULE_CAP);

  const prevIds = await readStringArray(opts.kv, LAST_IDS_KEY);
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(reminders.map((r) => r.id)));
}
