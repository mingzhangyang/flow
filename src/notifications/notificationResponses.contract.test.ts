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

function fakeFacade(initial: NotificationResponseLike | null = null) {
  let last = initial;
  let listener: ((value: NotificationResponseLike) => void) | null = null;
  let clears = 0;
  let removals = 0;

  const api: NotificationResponsesFacade = {
    async getLastNotificationResponseAsync() {
      return last;
    },
    async clearLastNotificationResponseAsync() {
      clears += 1;
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
