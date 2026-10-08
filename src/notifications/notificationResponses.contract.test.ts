// 通知响应编排契约：覆盖 cold/warm 消费、clear 失败、启动窗口去重与顺序、取消订阅。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionKey } from '../domain/definitionIdentity';
import { createLeaveGuard, authorizeRouteExit } from '../ui/leaveGuard';
import { createDefinitionRuntime } from '../session/definitionRuntime';
import { createStorage } from '../storage/storage';
import { createInMemoryKV } from '../storage/kv';
import { checkIn } from '../runtime/adherence';
import { noopNotifier } from './notifier';
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


test('notification tap cannot dismiss a pending or failed check-in and still permits retry after cancel', async () => {
  const fake = fakeFacade();
  const storage = createStorage(createInMemoryKV());
  const oldKey = definitionKey({ source: 'example', flowId: 'med' });
  const newKey = definitionKey({ source: 'example', flowId: 'next' });
  let attempts = 0;
  let releaseFirst!: () => void;
  let started!: () => void;
  const hold = new Promise<void>((done) => { releaseFirst = done; });
  const entered = new Promise<void>((done) => { started = done; });
  const runtime = createDefinitionRuntime({
    storage: {
      ...storage,
      async changeCheckIn(key, intent) {
        if (key === oldKey && ++attempts === 1) {
          started();
          await hold;
          throw new Error('durable store failed');
        }
        return storage.changeCheckIn(key, intent);
      },
    },
    notifier: noopNotifier,
    now: () => 0,
  });
  const originalSession = runtime.open(oldKey);
  const originalRoute = { name: 'run', session: originalSession };
  let activeRoute = originalRoute;
  let writeStatus: 'pending' | 'failed' | 'idle' = 'pending';
  const prompts: Array<(approved: boolean) => void> = [];
  const guard = createLeaveGuard({
    disposition: () => writeStatus === 'idle' ? 'allow' : 'confirm',
    prompt: (decide) => prompts.push(decide),
  });
  const navigation: string[] = [];
  const source = createNotificationResponseSource(fake.api);
  const stop = source.start(async (target) => {
    const origin = activeRoute;
    if (!await authorizeRouteExit(origin, () => activeRoute, () => guard.request())) return;
    // Equivalent App boundary: old runtime session closes only AFTER approval.
    const next = runtime.open(target.definitionKey);
    origin.session.close();
    activeRoute = { name: 'run', session: next };
    navigation.push(target.flowId);
  });
  await flush();

  const dose = checkIn('morning', 1000, true, 2000);
  const failingWrite = originalSession.changeCheckIn({ kind: 'record', entry: dose });
  await entered;
  fake.emit(response('first-tap', routeData('next')));
  await flush();
  assert.equal(prompts.length, 1);
  assert.equal(activeRoute, originalRoute);
  assert.equal(originalSession.isOpen(), true);

  (prompts.shift() as (approved: boolean) => void)(false);
  await flush();
  assert.deepEqual(navigation, []);
  releaseFirst();
  await assert.rejects(() => failingWrite, /durable store failed/);
  writeStatus = 'failed';

  fake.emit(response('second-tap', routeData('next')));
  await flush();
  assert.equal(prompts.length, 1, 'failed check-in must still be protected');
  (prompts.shift() as (approved: boolean) => void)(false);
  await flush();
  assert.equal(originalSession.isOpen(), true);
  // User can retry on the original RuntimeSession after dismissing both taps.
  assert.deepEqual(await originalSession.changeCheckIn({ kind: 'record', entry: dose }), [dose]);
  writeStatus = 'idle';

  fake.emit(response('third-tap', routeData('next')));
  await flush();
  await flush();
  assert.deepEqual(navigation, ['next']);
  assert.equal(originalSession.isOpen(), false);
  assert.equal(activeRoute.session.definitionKey, newKey);
  assert.deepEqual(await storage.loadCheckIns(oldKey), [dose]);
  stop();
});

test('queued foreground notification responses wait for a leave decision and never overtake one another', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const origin = { name: 'run', id: 1 };
  let active = origin;
  const decisions: Array<(approved: boolean) => void> = [];
  const guard = createLeaveGuard({
    disposition: () => 'confirm',
    prompt: (decide) => decisions.push(decide),
  });
  const opened: string[] = [];
  const stop = source.start(async (route) => {
    const from = active;
    const allow = await authorizeRouteExit(from, () => active, () => guard.request());
    if (!allow) return;
    opened.push(route.flowId);
    active = { name: 'run', id: active.id + 1 };
  });
  await flush();

  fake.emit(response('tap-A', routeData('a')));
  fake.emit(response('tap-B', routeData('b')));
  await flush();
  assert.equal(decisions.length, 1, 'second tap must wait for first decision');
  assert.equal(active, origin);
  (decisions.shift() as (approved: boolean) => void)(false);
  await flush();
  await flush();
  assert.equal(decisions.length, 1, 'second tap starts only after first cancellation');
  assert.deepEqual(opened, []);
  (decisions.shift() as (approved: boolean) => void)(true);
  await flush();
  await flush();
  assert.deepEqual(opened, ['b']);
  assert.equal(active.id, 2);
  stop();
});

test('an old native confirmation cannot navigate after another route has taken ownership', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const original = { name: 'edit' };
  let active = original;
  let decide!: (approved: boolean) => void;
  const guard = createLeaveGuard({ disposition: () => 'confirm', prompt: (answer) => { decide = answer; } });
  const opened: string[] = [];
  source.start(async (route) => {
    const origin = active;
    const canLeave = await authorizeRouteExit(origin, () => active, () => guard.request());
    if (canLeave) opened.push(route.flowId);
  });
  await flush();
  fake.emit(response('stale-tap', routeData('med')));
  await flush();
  active = { name: 'home' };
  decide(true);
  await flush();
  assert.deepEqual(opened, []);
});
