// Storage：Flow 定义与 Run 记录的持久化（C6 —— Flow 永远属于用户，可导出、离线可用）。
// 纯逻辑，建立在 KVStore 端口之上；不依赖任何平台 API。

import { type Flow, type Run, type RunEvent, type RunEventType } from '../domain/types';
import { serializeFlow, deserializeFlow, coerceFlow } from '../domain/serialize';
import { reduce } from '../runtime/engine';
import { activeRunId } from '../runtime/runIdentity';
import { type CheckIn, isCheckIn } from '../runtime/adherence';
import { type KVStore } from './kv';

const FLOW = 'flow:';
const RUN = 'run:';
const CHECKINS = 'checkins:';
const REV = 'rev:';

// ---- 持久数据回到纯核心前的闸门 ----
// Flow 快照走迁移 + 校验（coerceFlow）；事件日志用 reduce 从头重放来验证合法性——
// 重放即校验（E4）。读到坏数据返回 null/跳过，而不是让非法状态流入运行时。

const EVENT_TYPES = new Set<RunEventType>([
  'started',
  'stepCompleted',
  'skipped',
  'gateConfirmed',
  'paused',
  'resumed',
  'wentBack',
]);

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as { type?: unknown; at?: unknown };
  return typeof e.type === 'string' && EVENT_TYPES.has(e.type as RunEventType) &&
    typeof e.at === 'number' && Number.isFinite(e.at);
}

function parseRun(text: string): Run | null {
  try {
    const raw = JSON.parse(text) as { id?: unknown; flow?: unknown; events?: unknown };
    if (typeof raw.id !== 'string' || !Array.isArray(raw.events)) return null;
    if (!raw.events.every(isRunEvent)) return null;
    const flow = coerceFlow(raw.flow); // 旧 schema 快照在此迁移
    let run: Run = { id: raw.id, flow, events: [] };
    for (const event of raw.events) run = reduce(run, event);
    return run;
  } catch {
    return null;
  }
}

export interface Storage {
  saveFlow(flow: Flow): Promise<void>;
  loadFlow(id: string): Promise<Flow | null>;
  listFlows(): Promise<Flow[]>;
  deleteFlow(id: string): Promise<void>;
  /** 导出为开放格式文本（E5）。 */
  exportFlow(id: string): Promise<string | null>;
  /** 从开放格式文本导入并保存（校验后）。 */
  importFlow(text: string): Promise<Flow>;

  saveRun(run: Run): Promise<void>;
  loadRun(id: string): Promise<Run | null>;
  listRuns(): Promise<Run[]>;
  deleteRun(id: string): Promise<void>;

  /** 日程型 Flow 的打卡日志（按 flowId 存）。 */
  saveCheckIns(flowId: string, log: CheckIn[]): Promise<void>;
  loadCheckIns(flowId: string): Promise<CheckIn[]>;
  /** 全部打卡日志（含示例 flow 的——打卡是用户数据，不依附于 flow 是否入库）。 */
  listAllCheckIns(): Promise<Record<string, CheckIn[]>>;

  /** Flow 的历史修订快照（按 flowId 存，旧版本追加保留）。 */
  saveRevisions(flowId: string, revisions: Flow[]): Promise<void>;
  loadRevisions(flowId: string): Promise<Flow[]>;
}

export function createStorage(kv: KVStore): Storage {
  async function loadFlow(id: string): Promise<Flow | null> {
    const text = await kv.getItem(FLOW + id);
    if (!text) return null;
    try {
      return deserializeFlow(text);
    } catch {
      return null;
    }
  }
  async function saveFlow(flow: Flow): Promise<void> {
    await kv.setItem(FLOW + flow.id, serializeFlow(flow)); // serializeFlow 会校验
  }
  async function loadCheckIns(flowId: string): Promise<CheckIn[]> {
    const text = await kv.getItem(CHECKINS + flowId);
    if (!text) return [];
    try {
      const raw = JSON.parse(text) as unknown;
      // 每条打卡相互独立：坏条目单独丢弃，不拖累其余记录。
      return Array.isArray(raw) ? raw.filter(isCheckIn) : [];
    } catch {
      return [];
    }
  }

  return {
    saveFlow,
    loadFlow,
    async listFlows() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(FLOW));
      const flows: Flow[] = [];
      for (const k of keys) {
        const flow = await loadFlow(k.slice(FLOW.length));
        if (flow) flows.push(flow);
      }
      flows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return flows;
    },
    async deleteFlow(id) {
      // Run 携带 Flow 快照，不能只按 run id 猜归属；逐条过读入闸门后删除所有属于
      // 该 Flow 的运行实例。删除很少发生，这里的完整扫描换取不留孤儿用户数据。
      const runKeys = (await kv.keys()).filter((k) => k.startsWith(RUN));
      // active Run 的 id 是稳定约定，即使其内容已经损坏、无法 parse，也能按精确键清掉。
      const ownedRunKeys = new Set<string>([RUN + activeRunId(id)]);
      for (const key of runKeys) {
        const text = await kv.getItem(key);
        const run = text ? parseRun(text) : null;
        if (run?.flow.id === id) ownedRunKeys.add(key);
      }
      await Promise.all([
        kv.removeItem(FLOW + id),
        kv.removeItem(REV + id),
        kv.removeItem(CHECKINS + id),
        ...[...ownedRunKeys].map((key) => kv.removeItem(key)),
      ]);
    },
    async exportFlow(id) {
      const flow = await loadFlow(id);
      return flow ? serializeFlow(flow) : null;
    },
    async importFlow(text) {
      const flow = deserializeFlow(text);
      await saveFlow(flow);
      return flow;
    },

    async saveRun(run) {
      await kv.setItem(RUN + run.id, JSON.stringify(run));
    },
    async loadRun(id) {
      const text = await kv.getItem(RUN + id);
      return text ? parseRun(text) : null;
    },
    async listRuns() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(RUN));
      const runs: Run[] = [];
      for (const k of keys) {
        const text = await kv.getItem(k);
        const run = text ? parseRun(text) : null;
        if (run) runs.push(run);
      }
      return runs;
    },
    async deleteRun(id) {
      await kv.removeItem(RUN + id);
    },

    async saveCheckIns(flowId, log) {
      await kv.setItem(CHECKINS + flowId, JSON.stringify(log));
    },
    loadCheckIns,
    async listAllCheckIns() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(CHECKINS));
      const all: Record<string, CheckIn[]> = {};
      for (const k of keys) {
        const id = k.slice(CHECKINS.length);
        const log = await loadCheckIns(id);
        if (log.length > 0) all[id] = log;
      }
      return all;
    },

    async saveRevisions(flowId, revisions) {
      await kv.setItem(REV + flowId, JSON.stringify(revisions));
    },
    async loadRevisions(flowId) {
      const text = await kv.getItem(REV + flowId);
      if (!text) return [];
      try {
        const raw = JSON.parse(text) as unknown;
        if (!Array.isArray(raw)) return [];
        // 修订快照逐条迁移 + 校验；坏快照跳过，保住其余历史。
        const revisions: Flow[] = [];
        for (const item of raw) {
          try {
            revisions.push(coerceFlow(item));
          } catch {
            // skip invalid snapshot
          }
        }
        return revisions;
      } catch {
        return [];
      }
    },
  };
}
