// Flow 库服务：在 Storage 之上编排“用户的 flow 集合”——列出、提交新修订、删除、
// 查看历史、导出/导入。版本化 = 提交时旧版本入历史、version 递增（C6 可拥有、E5 开放格式、
// AI-C3 的前置：改动可追溯、可回看）。

import { type Flow } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { deserializeFlow } from '../domain/serialize';
import { type Storage } from '../storage/storage';
import { type Backup, buildBackup, mergeCheckIns } from '../storage/backup';
import { setStringRecordValue } from '../storage/stringRecord';

export interface Library {
  list(): Promise<Flow[]>;
  get(id: string): Promise<Flow | null>;
  /** 保存为新修订：若已存在则把旧版本入历史并 version+1；否则以 version 1 保存。 */
  commit(flow: Flow): Promise<Flow>;
  remove(id: string): Promise<void>;
  revisions(id: string): Promise<Flow[]>;
  /** 回到某个历史版本：把旧快照作为新修订提交（当前版本入历史，可再回退）。AI-C3 的 Undo 底座。 */
  restore(revision: Flow): Promise<Flow>;
  exportFlow(id: string): Promise<string | null>;
  /** 从开放格式文本导入，登记来源时间，保存并返回。 */
  importFlow(text: string, now: Instant): Promise<Flow>;
  /** 整库备份（C6 兜底）：全部 flow + 历史修订 + 打卡日志，开放格式文本。 */
  exportBackup(now: Instant): Promise<string>;
  /** 恢复备份（parseBackup 的产物）；返回恢复的 flow 数。不覆盖本机已有数据。 */
  importBackup(backup: Backup): Promise<number>;
}

/** 每条 flow 保留的历史修订上限：超出时丢最旧的，避免存储无界增长。 */
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
      // 走 commit：若同 id 的用户 flow 已存在，旧版本入历史、version 递增。
      // 若 id 与内置示例冲突，导入后的用户 Flow 在 catalog 层具有优先级；
      // 示例仍是只读内置数据，不会覆盖用户拥有的数据（C6）。
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
        definitionCheckIns: await storage.listAllDefinitionCheckIns(),
        exportedAt: now,
      });
    },

    async importBackup(backup) {
      for (const flow of backup.flows) {
        const existing = await storage.loadFlow(flow.id);
        if (!existing) {
          // 新设备恢复：原样保存（保留 version），历史修订仅在本机没有时写入。
          await storage.saveFlow(flow);
          const localHistory = await storage.loadRevisions(flow.id);
          const fromBackup = Object.prototype.hasOwnProperty.call(backup.revisions, flow.id)
            ? backup.revisions[flow.id]
            : undefined;
          if (localHistory.length === 0 && fromBackup) {
            await storage.saveRevisions(flow.id, fromBackup.slice(-MAX_REVISIONS));
          }
        } else {
          // 本机已有同 id：走 commit（旧版本入历史、version 递增），绝不静默覆盖；
          // 本机历史保留，备份中的历史不合并（避免版本序列混淆）。
          await this.commit(flow);
        }
      }
      for (const [flowId, incoming] of Object.entries(backup.checkIns)) {
        const local = await storage.loadCheckIns(flowId);
        await storage.saveCheckIns(flowId, mergeCheckIns(local, incoming));
      }
      for (const [definitionKey, incoming] of Object.entries(backup.definitionCheckIns ?? {})) {
        const local = await storage.loadDefinitionCheckIns(definitionKey);
        await storage.saveDefinitionCheckIns(definitionKey, mergeCheckIns(local, incoming));
      }
      return backup.flows.length;
    },
  };
}
