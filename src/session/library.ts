// Flow 库服务：在 Storage 之上编排“用户的 flow 集合”——列出、提交新修订、删除、
// 查看历史、导出/导入。版本化 = 提交时旧版本入历史、version 递增（C6 可拥有、E5 开放格式、
// AI-C3 的前置：改动可追溯、可回看）。

import { type Flow } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { deserializeFlow } from '../domain/serialize';
import { type Storage } from '../storage/storage';

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
}

export function createLibrary(storage: Storage): Library {
  return {
    list: () => storage.listFlows(),
    get: (id) => storage.loadFlow(id),

    async commit(flow) {
      const prev = await storage.loadFlow(flow.id);
      if (prev) {
        const history = await storage.loadRevisions(flow.id);
        await storage.saveRevisions(flow.id, [...history, prev]);
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
      await storage.saveFlow(imported);
      return imported;
    },
  };
}
