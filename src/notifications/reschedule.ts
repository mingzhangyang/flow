// 日程提醒的登记与重排编排（C5：现实里 App 可能几天不被打开，提醒不能因此断档）。
//
// - 登记（enroll）：用户打开某条日程型 catalog 定义 = 为“该定义”开启提醒。
//   enrollmentKey 由 catalog 层提供；同 id 的示例/用户 Flow 可以拥有不同 key，互不转移。
// - 重排（reschedule）：App 启动、回到前台、库变更时，把已登记定义未来数日的
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

export interface ScheduledCatalogEntry {
  flow: Flow;
  enrollmentKey: string;
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

/** 已开启提醒的 catalog enrollment key 清单。 */
export function enrolledFlowKeys(kv: KVStore): Promise<string[]> {
  return readStringArray(kv, ENROLLED_KEY);
}

/** 旧名字保留给现有调用；值语义现为 enrollment key。 */
export const enrolledFlowIds = enrolledFlowKeys;

/** 为某个 catalog 定义开启提醒（幂等）。 */
export async function enrollFlow(kv: KVStore, enrollmentKey: string): Promise<void> {
  const keys = await enrolledFlowKeys(kv);
  if (keys.includes(enrollmentKey)) return;
  await kv.setItem(ENROLLED_KEY, JSON.stringify([...keys, enrollmentKey]));
}

/** 关闭某个 catalog 定义的提醒登记（幂等）。 */
export async function unenrollFlow(kv: KVStore, enrollmentKey: string): Promise<void> {
  const keys = await enrolledFlowKeys(kv);
  if (!keys.includes(enrollmentKey)) return;
  await kv.setItem(ENROLLED_KEY, JSON.stringify(keys.filter((key) => key !== enrollmentKey)));
}

/**
 * 重排全部已登记 catalog 定义的日程提醒。
 * 只有当前可见 entry 且其 enrollmentKey 已登记时才排入；
 * shadowing 不会让相同 flowId 的另一份定义继承登记。
 */
export async function rescheduleReminders(opts: {
  kv: KVStore;
  notifier: Notifier;
  flows: ScheduledCatalogEntry[];
  now: Instant;
  deviceTz: TimeZone;
}): Promise<void> {
  const enrolled = new Set(await enrolledFlowKeys(opts.kv));
  const entries = opts.flows
    .filter((entry) => entry.flow.topology === 'scheduled' && enrolled.has(entry.enrollmentKey))
    .map(({ flow }) => ({
      flow,
      tz: timeZoneForFlow(flow, opts.deviceTz),
      // 跟随设备时区的 daily/weekly 用系统重复触发器（App 几周不开也不断档）；
      // 锚定非设备时区（Flow.timeZone）的墙钟无法按设备墙钟重复，仍走多日预排窗口。
      repeatingTriggers: !flow.timeZone,
    }));
  const reminders = planScheduledBatch(entries, opts.now, RESCHEDULE_HORIZON_MS, RESCHEDULE_CAP);

  const prevIds = await readStringArray(opts.kv, LAST_IDS_KEY);
  await opts.notifier.cancel(prevIds);
  await opts.notifier.schedule(reminders);
  await opts.kv.setItem(LAST_IDS_KEY, JSON.stringify(reminders.map((r) => r.id)));
}
