// Flow 库服务：用户 Flow、历史修订、开放格式导入/导出与整库备份。

import { type Flow } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { deserializeFlow } from '../domain/serialize';
import { type Storage } from '../storage/storage';
import { type Backup, buildBackup, mergeCheckIns } from '../storage/backup';
import { setStringRecordValue } from '../storage/stringRecord';

export interface Library {
  list(): Promise<Flow[]>;
  get(id: string): Promise<Flow | null>;
  commit(flow: Flow): Promise<Flow>;
  remove(id: string): Promise<void>;
  revisions(id: string): Promise<Flow[]>;
  restore(revision: Flow): Promise<Flow>;
  exportFlow(id: string): Promise<string | null>;
  importFlow(text: string, now: Instant): Promise<Flow>;
  exportBackup(now: Instant): Promise<string>;
  importBackup(backup: Backup): Promise<number>;
}

export const MAX_REVISIONS = 50;

export function createLibrary(storage: Storage): Library {
  return {
    list: () => storage.listFlows(),
    get: (id) => storage.loadFlow(id),

    async commit(flow) {
      const prev = await storage.loadFlow(flow.id);
      if (prev) {
        const history = await storage.loadRevisions(flow.id);
        await storage.saveRevisions(flow.id, [...history, prev].slice(-MAX_REVISIONS));
      }
      const next: Flow = { ...flow, version: prev ? (prev.version ?? 1) + 1 : 1 };
      await storage.saveFlow(next);
      return next;
    },

    remove: (id) => storage.deleteFlow(id),
    revisions: (id) => storage.loadRevisions(id),
    async restore(revision) {
      return this.commit(revision);
    },
    exportFlow: (id) => storage.exportFlow(id),

    async importFlow(text, now) {
      const parsed = deserializeFlow(text);
      const imported: Flow = {
        ...parsed,
        provenance: { ...(parsed.provenance ?? {}), importedAt: now },
      };
      return this.commit(imported);
    },

    async exportBackup(now) {
      const flows = await storage.listFlows();
      const revisions: Record<string, Flow[]> = {};
      for (const flow of flows) {
        const history = await storage.loadRevisions(flow.id);
        if (history.length > 0) setStringRecordValue(revisions, flow.id, history);
      }
      return buildBackup({
        flows,
        revisions,
        checkIns: await storage.listAllCheckIns(),
        exportedAt: now,
      });
    },

    async importBackup(backup) {
      for (const flow of backup.flows) {
        const existing = await storage.loadFlow(flow.id);
        if (!existing) {
          await storage.saveFlow(flow);
          const localHistory = await storage.loadRevisions(flow.id);
          const fromBackup = Object.prototype.hasOwnProperty.call(backup.revisions, flow.id)
            ? backup.revisions[flow.id]
            : undefined;
          if (localHistory.length === 0 && fromBackup) {
            await storage.saveRevisions(flow.id, fromBackup.slice(-MAX_REVISIONS));
          }
        } else {
          await this.commit(flow);
        }
      }

      for (const [definitionKey, incoming] of Object.entries(backup.checkIns)) {
        const local = await storage.loadCheckIns(definitionKey);
        await storage.saveCheckIns(definitionKey, mergeCheckIns(local, incoming));
      }
      return backup.flows.length;
    },
  };
}
