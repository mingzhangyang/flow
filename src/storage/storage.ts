// Storage：正式 v1 持久化端口。Flow / Run / definition-scoped check-ins / revisions
// 全部建立在 KVStore 之上；项目尚未发布，因此不存在 app-data legacy namespace。

import { type Flow, type Run, type RunEvent, type RunEventType } from '../domain/types';
import { assertDefinitionKey } from '../domain/definitionIdentity';
import { serializeFlow, deserializeFlow, coerceFlow } from '../domain/serialize';
import { reduce } from '../runtime/engine';
import { type CheckIn, isCheckIn } from '../runtime/adherence';
import { type KVStore } from './kv';
import { setStringRecordValue } from './stringRecord';

const FLOW = 'flow:';
const RUN = 'run:';
const CHECKINS = 'checkins:v1:';
const REV = 'rev:';

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
  return typeof e.type === 'string' && EVENT_TYPES.has(e.type as RunEventType) && typeof e.at === 'number';
}

function parseRun(text: string, expectedId: string): Run {
  const raw = JSON.parse(text) as { id?: unknown; flow?: unknown; events?: unknown };
  if (typeof raw.id !== 'string' || !Array.isArray(raw.events)) {
    throw new Error('invalid persisted Run');
  }
  if (raw.id !== expectedId) {
    throw new Error('persisted Run id does not match storage key');
  }
  if (!raw.events.every(isRunEvent)) throw new Error('invalid persisted Run events');
  const flow = coerceFlow(raw.flow);
  let run: Run = { id: raw.id, flow, events: [] };
  for (const event of raw.events) run = reduce(run, event);
  return run;
}

export interface Storage {
  saveFlow(flow: Flow): Promise<void>;
  /** Only absence returns null; malformed or mis-associated records reject. */
  loadFlow(id: string): Promise<Flow | null>;
  /** Complete authoritative catalog: uses the same read gate as loadFlow, never skips corruption. */
  listFlows(): Promise<Flow[]>;
  deleteFlow(id: string): Promise<void>;
  exportFlow(id: string): Promise<string | null>;
  importFlow(text: string): Promise<Flow>;

  saveRun(run: Run): Promise<void>;
  loadRun(id: string): Promise<Run | null>;
  listRuns(): Promise<Run[]>;
  deleteRun(id: string): Promise<void>;

  /** definitionKey 是唯一主键。 */
  saveCheckIns(definitionKey: string, log: CheckIn[]): Promise<void>;
  loadCheckIns(definitionKey: string): Promise<CheckIn[]>;
  deleteCheckIns(definitionKey: string): Promise<void>;
  listAllCheckIns(): Promise<Record<string, CheckIn[]>>;

  saveRevisions(flowId: string, revisions: Flow[]): Promise<void>;
  loadRevisions(flowId: string): Promise<Flow[]>;
  deleteRevisions(flowId: string): Promise<void>;
}

export function createStorage(kv: KVStore): Storage {
  async function loadFlow(id: string): Promise<Flow | null> {
    const text = await kv.getItem(FLOW + id);
    if (text === null) return null;
    const flow = deserializeFlow(text);
    if (flow.id !== id) throw new Error('persisted Flow id does not match storage key');
    return flow;
  }

  async function saveFlow(flow: Flow): Promise<void> {
    await kv.setItem(FLOW + flow.id, serializeFlow(flow));
  }

  async function loadCheckIns(definitionKey: string): Promise<CheckIn[]> {
    assertDefinitionKey(definitionKey);
    const text = await kv.getItem(CHECKINS + definitionKey);
    if (text === null) return [];
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) throw new Error('invalid persisted check-in log');
    // Individual malformed entries are independently unusable and may be skipped; a malformed
    // container/JSON is a read failure and must never be reinterpreted as an empty user log.
    return raw.filter(isCheckIn);
  }

  return {
    saveFlow,
    loadFlow,
    async listFlows() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(FLOW));
      const flows: Flow[] = [];
      for (const key of keys) {
        // Enumeration supplies the identity, never a second deserialization path. A bad
        // record must fail the whole catalog, otherwise an example could silently replace it.
        const flow = await loadFlow(key.slice(FLOW.length));
        if (flow !== null) flows.push(flow);
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
      return text === null ? null : parseRun(text, id);
    },
    async listRuns() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(RUN));
      const runs: Run[] = [];
      for (const key of keys) {
        const text = await kv.getItem(key);
        if (text === null) continue;
        const id = key.slice(RUN.length);
        try {
          runs.push(parseRun(text, id));
        } catch {
          // Enumeration is explicitly best-effort, but a mismatched key/body identity is never
          // normalized into a different Run. Exact loadRun(id) remains fail-closed.
        }
      }
      return runs;
    },
    async deleteRun(id) {
      await kv.removeItem(RUN + id);
    },

    async saveCheckIns(definitionKey, log) {
      assertDefinitionKey(definitionKey);
      await kv.setItem(CHECKINS + definitionKey, JSON.stringify(log));
    },
    loadCheckIns,
    async deleteCheckIns(definitionKey) {
      assertDefinitionKey(definitionKey);
      await kv.removeItem(CHECKINS + definitionKey);
    },
    async listAllCheckIns() {
      const keys = (await kv.keys()).filter((k) => k.startsWith(CHECKINS));
      const all: Record<string, CheckIn[]> = {};
      for (const key of keys) {
        const definitionKey = key.slice(CHECKINS.length);
        assertDefinitionKey(definitionKey);
        const log = await loadCheckIns(definitionKey);
        if (log.length > 0) setStringRecordValue(all, definitionKey, log);
      }
      return all;
    },

    async saveRevisions(flowId, revisions) {
      await kv.setItem(REV + flowId, JSON.stringify(revisions));
    },
    async loadRevisions(flowId) {
      const text = await kv.getItem(REV + flowId);
      if (text === null) return [];
      const raw = JSON.parse(text) as unknown;
      if (!Array.isArray(raw)) throw new Error('invalid persisted revision history');
      const revisions: Flow[] = [];
      for (const item of raw) {
        try {
          const revision = coerceFlow(item);
          if (revision.id === flowId) revisions.push(revision);
        } catch {
          // One unusable snapshot does not invalidate the readable remainder.
        }
      }
      return revisions;
    },
    async deleteRevisions(flowId) {
      await kv.removeItem(REV + flowId);
    },
  };
}
