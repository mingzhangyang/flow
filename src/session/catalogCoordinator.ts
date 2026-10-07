// Catalog refresh / mutation 的单一串行协调器。
//
// 所有会影响 catalog snapshot 或 reminder reschedule 的任务都进同一队列：
// - 副作用绝不并发执行；
// - 新请求会立即让旧 snapshot 失效；
// - 只有最新请求拥有 publish 权，旧任务完成也不能覆盖新状态；
// - 失败发布 error，但不会毒死队列；下一次 retry 仍可继续。
// 通知路由可 waitForReady()，因此加载/恢复窗口里的 tap 不会因反复退订而丢失。

import { type Flow } from '../domain/types';
import {
  ERROR_CATALOG,
  LOADING_CATALOG,
  type OwnedCatalogSnapshot,
} from './flowCatalog';

export interface CatalogCoordinator {
  request(task: () => Promise<Flow[]>): Promise<void>;
  waitForReady(): Promise<Flow[]>;
  current(): OwnedCatalogSnapshot;
}

export function createCatalogCoordinator(
  publish: (snapshot: OwnedCatalogSnapshot) => void,
): CatalogCoordinator {
  let tail: Promise<void> = Promise.resolve();
  let latestRequest = 0;
  let snapshot: OwnedCatalogSnapshot = LOADING_CATALOG;
  let readyWaiters: Array<(flows: Flow[]) => void> = [];

  const publishSnapshot = (next: OwnedCatalogSnapshot): void => {
    snapshot = next;
    publish(next);
    if (next.status === 'ready') {
      const waiters = readyWaiters;
      readyWaiters = [];
      for (const resolve of waiters) resolve(next.flows);
    }
  };

  return {
    request(task) {
      const requestId = ++latestRequest;
      publishSnapshot(LOADING_CATALOG);

      const run = tail.then(async () => {
        try {
          const flows = await task();
          if (requestId === latestRequest) publishSnapshot({ status: 'ready', flows });
        } catch (error) {
          if (requestId === latestRequest) publishSnapshot(ERROR_CATALOG);
          throw error;
        }
      });

      // 错误只属于这次 request；后续任务必须仍能从队列继续。
      tail = run.catch(() => {});
      return run;
    },

    waitForReady() {
      if (snapshot.status === 'ready') return Promise.resolve(snapshot.flows);
      return new Promise<Flow[]>((resolve) => {
        readyWaiters.push(resolve);
      });
    },

    current() {
      return snapshot;
    },
  };
}
