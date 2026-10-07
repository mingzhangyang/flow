// 通知响应编排契约：覆盖 cold/warm 消费、clear 失败、启动窗口去重与顺序、取消订阅。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionKey } from '../domain/definitionIdentity';
import {
  createNotificationResponseSource,
  type NotificationResponseLike,
  type NotificationResponsesFacade,
} from './notificationResponsesCore';

function response(identifier: string, data: unknown): NotificationResponseLike {
  return { notification: { request: { identifier, content: { data } } } };
}

function routeData(flowId: string, nodeId?: string) {
  return {
    kind: 'flow' as const,
    flowId,
    definitionKey: definitionKey({ source: 'example', flowId }),
    ...(nodeId ? { nodeId } : {}),
  };
}

function fakeFacade(
  initial: NotificationResponseLike | null = null,
  opts: { failClears?: number; deferInitial?: boolean } = {},
) {
  let last = initial;
  let listener: ((value: NotificationResponseLike) => void) | null = null;
  let clears = 0;
  let removals = 0;
  let remainingClearFailures = opts.failClears ?? 0;
  let releaseInitial: (() => void) | null = null;
  const initialGate = opts.deferInitial
    ? new Promise<void>((resolve) => {
        releaseInitial = resolve;
      })
    : Promise.resolve();

  const api: NotificationResponsesFacade = {
    async getLastNotificationResponseAsync() {
      const snapshot = last;
      await initialGate;
      return snapshot;
    },
    async clearLastNotificationResponseAsync() {
      clears += 1;
      if (remainingClearFailures > 0) {
        remainingClearFailures -= 1;
        throw new Error('clear failed');
      }
      last = null;
    },
    addNotificationResponseReceivedListener(next) {
      listener = next;
      return {
        remove() {
          removals += 1;
          listener = null;
        },
      };
    },
  };

  return {
    api,
    emit(value: NotificationResponseLike) {
      last = value;
      listener?.(value);
    },
    releaseInitial() {
      releaseInitial?.();
    },
    counts() {
      return { clears, removals };
    },
  };
}

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

test('冷启动读取并消费 last response，只交付一次合法路由', async () => {
  const fake = fakeFacade(response('cold-1', routeData('med')));
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  await flush();
  assert.deepEqual(routes, [routeData('med')]);
  assert.deepEqual(fake.counts(), { clears: 1, removals: 0 });
});

test('warm tap 先清除 last response 再转发；非法响应也会被消费', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  const unsubscribe = source.start((route) => { routes.push(route); });
  await flush();

  fake.emit(response('warm-1', routeData('coffee', 'brew')));
  await flush();
  assert.deepEqual(routes, [routeData('coffee', 'brew')]);
  assert.equal(fake.counts().clears, 1);

  fake.emit(response('warm-2', { kind: 'other', flowId: 'bad' }));
  await flush();
  assert.equal(routes.length, 1);
  assert.equal(fake.counts().clears, 2);

  unsubscribe();
  assert.equal(fake.counts().removals, 1);
});

test('clear 瞬态失败会重试一次，成功后才交付 cold route', async () => {
  const fake = fakeFacade(response('cold-retry', routeData('med')), { failClears: 1 });
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  await flush();
  assert.deepEqual(routes, [routeData('med')]);
  assert.equal(fake.counts().clears, 2);
});

test('clear 连续失败时不交付 route，避免 stale response 下次重放', async () => {
  const fake = fakeFacade(response('cold-fail', routeData('cold')), { failClears: 2 });
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  await flush();
  assert.deepEqual(routes, []);
  assert.equal(fake.counts().clears, 2);
});

test('initial 与 listener 暴露同一 cold response 时按 request id 去重', async () => {
  const cold = response('same-id', routeData('cold'));
  const fake = fakeFacade(cold, { deferInitial: true });
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  fake.emit(cold);
  fake.releaseInitial();
  await flush();
  await flush();

  assert.deepEqual(routes, [routeData('cold')]);
  assert.equal(fake.counts().clears, 1);
});

test('启动窗口内 distinct listener response 在 initial 之后按到达顺序交付', async () => {
  const fake = fakeFacade(response('initial-id', routeData('initial')), { deferInitial: true });
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  fake.emit(response('warm-a', routeData('a')));
  fake.emit(response('warm-b', routeData('b')));
  fake.releaseInitial();
  await flush();
  await flush();

  assert.deepEqual(routes, [
    routeData('initial'),
    routeData('a'),
    routeData('b'),
  ]);
});

test('取消订阅会丢弃尚未完成的启动缓冲', async () => {
  const fake = fakeFacade(response('initial-id', routeData('initial')), { deferInitial: true });
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  const unsubscribe = source.start((route) => { routes.push(route); });

  fake.emit(response('warm-id', routeData('warm')));
  unsubscribe();
  fake.releaseInitial();
  await flush();

  assert.deepEqual(routes, []);
  assert.equal(fake.counts().removals, 1);
});


test('连续 warm tap 会等待前一次异步导航完成，后一次不会反向覆盖', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const events: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  source.start(async (route) => {
    events.push(`start:${route.flowId}`);
    if (route.flowId === 'a') await firstGate;
    events.push(`end:${route.flowId}`);
  });
  await flush();

  fake.emit(response('warm-a', routeData('a')));
  fake.emit(response('warm-b', routeData('b')));
  await flush();

  assert.deepEqual(events, ['start:a']);
  releaseFirst();
  await flush();
  await flush();

  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b']);
});


test('单次 async listener 失败不会 poison 串行队列，后续 tap 仍会交付', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const seen: string[] = [];
  source.start(async (route) => {
    seen.push(route.flowId);
    if (route.flowId === 'a') throw new Error('navigation failed');
  });
  await flush();

  fake.emit(response('warm-a', routeData('a')));
  fake.emit(response('warm-b', routeData('b')));
  await flush();
  await flush();
  await flush();

  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(fake.counts().clears, 2);
});


test('缺失或非 canonical definitionKey 的 pre-v1 route 会被消费但不交付', async () => {
  const fake = fakeFacade(response('legacy', { kind: 'flow', flowId: 'legacy' }));
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  source.start((route) => { routes.push(route); });

  await flush();
  assert.deepEqual(routes, []);
  assert.equal(fake.counts().clears, 1);
});
