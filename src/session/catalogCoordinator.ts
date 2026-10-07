// Catalog projection / mutation side effects 的单一串行协调器。
// request() 用于需要观察失败的调用；background() 用于 startup / foreground / retry 等
// “失败已由 snapshot='error' 表达”的调用，避免产生第二条 unhandled rejection 通道。

import {
  ERROR_CATALOG,
  LOADING_CATALOG,
  type CatalogProjection,
  type OwnedCatalogSnapshot,
} from './flowCatalog';

export interface CatalogCoordinator {
  request(task: () => Promise<CatalogProjection>): Promise<void>;
  background(task: () => Promise<CatalogProjection>): void;
  waitForReady(): Promise<CatalogProjection>;
  current(): OwnedCatalogSnapshot;
}

export function createCatalogCoordinator(
  publish: (snapshot: OwnedCatalogSnapshot) => void,
): CatalogCoordinator {
  let tail: Promise<void> = Promise.resolve();
  let latestRequest = 0;
  let snapshot: OwnedCatalogSnapshot = LOADING_CATALOG;
  let readyWaiters: Array<(projection: CatalogProjection) => void> = [];

  const publishSnapshot = (next: OwnedCatalogSnapshot): void => {
    snapshot = next;
    publish(next);
    if (next.status === 'ready') {
      const waiters = readyWaiters;
      readyWaiters = [];
      const projection: CatalogProjection = {
        flows: next.flows,
        legacyAmbiguousFlowIds: next.legacyAmbiguousFlowIds,
      };
      for (const resolve of waiters) resolve(projection);
    }
  };

  const request = (task: () => Promise<CatalogProjection>): Promise<void> => {
    const requestId = ++latestRequest;
    publishSnapshot(LOADING_CATALOG);

    const run = tail.then(async () => {
      try {
        const projection = await task();
        if (requestId === latestRequest) publishSnapshot({ status: 'ready', ...projection });
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
      if (snapshot.status === 'ready') {
        return Promise.resolve({
          flows: snapshot.flows,
          legacyAmbiguousFlowIds: snapshot.legacyAmbiguousFlowIds,
        });
      }
      return new Promise<CatalogProjection>((resolve) => {
        readyWaiters.push(resolve);
      });
    },
    current() {
      return snapshot;
    },
  };
}
