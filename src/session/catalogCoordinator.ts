// Catalog projection / mutation side effects 的单一串行协调器。
// request() 用于需要观察失败的调用；background() 用于 startup / foreground / retry 等
// “失败已由 snapshot='error' 表达”的调用，避免产生第二条 unhandled rejection 通道。

import { type Flow } from '../domain/types';
import {
  ERROR_CATALOG,
  LOADING_CATALOG,
  type OwnedCatalogSnapshot,
} from './flowCatalog';

export interface CatalogCoordinator {
  request(task: () => Promise<Flow[]>): Promise<void>;
  background(task: () => Promise<Flow[]>): void;
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

  const request = (task: () => Promise<Flow[]>): Promise<void> => {
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

    tail = run.catch(() => {});
    return run;
  };

  return {
    request,
    background(task) {
      void request(task).catch(() => {
        // snapshot 已表达后台刷新失败；不再制造 unhandled rejection。
      });
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
