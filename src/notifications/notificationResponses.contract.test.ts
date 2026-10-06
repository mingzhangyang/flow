// 通知响应编排契约：覆盖冷启动消费、warm tap 消费、非法数据与取消订阅。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createNotificationResponseSource,
  type NotificationResponseLike,
  type NotificationResponsesFacade,
} from './notificationResponsesCore';

function response(data: unknown): NotificationResponseLike {
  return { notification: { request: { content: { data } } } };
}

function fakeFacade(
  initial: NotificationResponseLike | null = null,
  opts: { failClears?: number } = {},
) {
  let last = initial;
  let listener: ((value: NotificationResponseLike) => void) | null = null;
  let clears = 0;
  let removals = 0;
  let remainingClearFailures = opts.failClears ?? 0;

  const api: NotificationResponsesFacade = {
    async getLastNotificationResponseAsync() {
      return last;
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
      listener?.(value);
    },
    counts() {
      return { clears, removals };
    },
  };
}

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

test('冷启动读取并消费 last response，只返回合法路由', async () => {
  const fake = fakeFacade(response({ kind: 'flow', flowId: 'med' }));
  const source = createNotificationResponseSource(fake.api);

  assert.deepEqual(await source.getInitialRoute(), { kind: 'flow', flowId: 'med' });
  assert.deepEqual(fake.counts(), { clears: 1, removals: 0 });
  assert.equal(await source.getInitialRoute(), null);
});

test('warm tap 先清除 last response 再转发；非法响应也会被消费', async () => {
  const fake = fakeFacade();
  const source = createNotificationResponseSource(fake.api);
  const routes: unknown[] = [];
  const unsubscribe = source.subscribe((route) => routes.push(route));

  fake.emit(response({ kind: 'flow', flowId: 'coffee', nodeId: 'brew' }));
  await flush();
  assert.deepEqual(routes, [{ kind: 'flow', flowId: 'coffee', nodeId: 'brew' }]);
  assert.equal(fake.counts().clears, 1);

  fake.emit(response({ kind: 'other', flowId: 'bad' }));
  await flush();
  assert.equal(routes.length, 1);
  assert.equal(fake.counts().clears, 2);

  unsubscribe();
  assert.equal(fake.counts().removals, 1);
});


test('clear 瞬态失败会重试一次，成功后才交付 cold route', async () => {
  const fake = fakeFacade(response({ kind: 'flow', flowId: 'med' }), { failClears: 1 });
  const source = createNotificationResponseSource(fake.api);

  assert.deepEqual(await source.getInitialRoute(), { kind: 'flow', flowId: 'med' });
  assert.deepEqual(fake.counts(), { clears: 2, removals: 0 });
});

test('clear 连续失败时不交付 cold/warm route，避免 stale response 下次重放', async () => {
  const cold = fakeFacade(response({ kind: 'flow', flowId: 'cold' }), { failClears: 2 });
  const coldSource = createNotificationResponseSource(cold.api);
  assert.equal(await coldSource.getInitialRoute(), null);
  assert.equal(cold.counts().clears, 2);

  const warm = fakeFacade(null, { failClears: 2 });
  const warmSource = createNotificationResponseSource(warm.api);
  const routes: unknown[] = [];
  warmSource.subscribe((route) => routes.push(route));
  warm.emit(response({ kind: 'flow', flowId: 'warm' }));
  await flush();

  assert.deepEqual(routes, []);
  assert.equal(warm.counts().clears, 2);
});
