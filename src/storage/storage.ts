// Storage：Flow 定义与 Run 记录的持久化（C6 —— Flow 永远属于用户，可导出、离线可用）。
// 纯逻辑，建立在 KVStore 端口之上；不依赖任何平台 API。

import { type Flow, type Run } from '../domain/types';
import { serializeFlow, deserializeFlow } from '../domain/serialize';
import { type CheckIn } from '../runtime/adherence';
import { type KVStore } from './kv';

const FLOW = 'flow:';
const RUN = 'run:';
const CHECKINS = 'checkins:';

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
}

export function createStorage(kv: KVStore): Storage {
  async function loadFlow(id: string): Promise<Flow | null> {
    const text = await kv.getItem(FLOW + id);
    return text ? deserializeFlow(text) : null;
  }
  async function saveFlow(flow: Flow): Promise<void> {
    await kv.setItem(FLOW + flow.id, serializeFlow(flow)); // serializeFlow 会校验
  }

  return {
    saveFlow,
    loadFlow,
    async listFlows() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(FLOW));
      const flows: Flow[] = [];
      for (const k of keys) {
        const text = await kv.getItem(k);
        if (text) flows.push(deserializeFlow(text));
      }
      flows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return flows;
    },
    async deleteFlow(id) {
      await kv.removeItem(FLOW + id);
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
      return text ? (JSON.parse(text) as Run) : null;
    },
    async listRuns() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(RUN));
      const runs: Run[] = [];
      for (const k of keys) {
        const text = await kv.getItem(k);
        if (text) runs.push(JSON.parse(text) as Run);
      }
      return runs;
    },
    async deleteRun(id) {
      await kv.removeItem(RUN + id);
    },

    async saveCheckIns(flowId, log) {
      await kv.setItem(CHECKINS + flowId, JSON.stringify(log));
    },
    async loadCheckIns(flowId) {
      const text = await kv.getItem(CHECKINS + flowId);
      return text ? (JSON.parse(text) as CheckIn[]) : [];
    },
  };
}
