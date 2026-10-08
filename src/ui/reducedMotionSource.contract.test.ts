import assert from 'node:assert/strict';
import test from 'node:test';
import { createReducedMotionSource } from './reducedMotionSource';

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('reduced-motion source starts conservative and adopts a successful initial read', async () => {
  const read = deferredBoolean();
  let emit: ((enabled: boolean) => void) | null = null;
  const source = createReducedMotionSource({
    read: () => read.promise,
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  });

  assert.equal(source.getSnapshot(), true);
  let notifications = 0;
  source.subscribe(() => { notifications += 1; });
  assert.ok(emit);

  read.resolve(false);
  await flush();

  assert.equal(source.getSnapshot(), false);
  assert.equal(notifications, 1);
});

test('runtime preference changes override a stale initial read and keep propagating', async () => {
  const read = deferredBoolean();
  let emit: ((enabled: boolean) => void) | null = null;
  const source = createReducedMotionSource({
    read: () => read.promise,
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  });

  let notifications = 0;
  source.subscribe(() => { notifications += 1; });
  assert.ok(emit);

  emit!(false);
  assert.equal(source.getSnapshot(), false);

  read.resolve(true);
  await flush();
  assert.equal(source.getSnapshot(), false);

  emit!(true);
  assert.equal(source.getSnapshot(), true);
  assert.equal(notifications, 2);
});

test('failed initial read remains fail-closed in reduced-motion mode', async () => {
  const source = createReducedMotionSource({
    read: () => Promise.reject(new Error('unavailable')),
    subscribe: () => () => {},
  });

  source.subscribe(() => {});
  await flush();

  assert.equal(source.getSnapshot(), true);
});
