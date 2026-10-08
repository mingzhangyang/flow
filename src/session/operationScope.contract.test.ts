import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperationScope } from './operationScope';
import { generateFlow } from '../ai/generate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = (): Promise<void> => new Promise((done) => setImmediate(done));

test('Generate: successful mock model result is consumed once, duplicate press rejected', async () => {
  const scope = createOperationScope();
  const gate = deferred<void>();
  const consumed: string[] = [];
  const submit = () => scope.submit(async () => {
    await gate.promise;
    return generateFlow({
      id: 'test/model',
      complete: async () => ({
        text: JSON.stringify({
          title: 'Coffee', topology: 'sequential',
          nodes: [{ kind: 'instant', label: 'Pour water' }],
        }),
        model: 'test-model',
      }),
    }, 'make coffee', { id: 'flow-1', locale: 'en' });
  }, {
    success(result) { if (result.ok) consumed.push(result.flow.title); },
    failure(error) { consumed.push(String(error)); },
  });
  assert.equal(submit(), true);
  assert.equal(submit(), false);
  gate.resolve();
  await flush();
  assert.deepEqual(consumed, ['Coffee']);
});

test('Generate: failed model request reports error and retry succeeds', async () => {
  const scope = createOperationScope();
  const errors: unknown[] = [];
  const success: string[] = [];
  assert.equal(scope.submit(() => Promise.reject(new Error('network unavailable')), {
    success: () => success.push('unexpected'), failure: (e) => errors.push(e),
  }), true);
  await flush();
  assert.match(String(errors[0]), /network unavailable/);
  assert.equal(scope.submit(() => Promise.resolve('retry worked'), {
    success: (value) => success.push(value), failure: () => assert.fail('retry failed'),
  }), true);
  await flush();
  assert.deepEqual(success, ['retry worked']);
});

test('Generate: Back revokes late successful draft and failed request result', async () => {
  for (const success of [true, false]) {
    const scope = createOperationScope();
    const gate = deferred<string>();
    const consumed: string[] = [];
    scope.submit(() => gate.promise, {
      success: () => consumed.push('editor'),
      failure: () => consumed.push('error'),
      settled: () => consumed.push('settled'),
    });
    scope.close();
    if (success) gate.resolve('draft');
    else gate.reject(new Error('late failure'));
    await flush();
    assert.deepEqual(consumed, []);
  }
});

test('Import: leaving after accepted submission suppresses navigation, not its committed work', async () => {
  const scope = createOperationScope();
  const gate = deferred<void>();
  let committed = false;
  let navigations = 0;
  assert.equal(scope.submit(async () => {
    await gate.promise;
    committed = true;
  }, { success: () => { navigations++; }, failure: () => assert.fail('unexpected') }), true);
  scope.close();
  gate.resolve();
  await flush();
  assert.equal(committed, true);
  assert.equal(navigations, 0);
});

test('Import: rapid double submission is serialized and failure can be retried', async () => {
  const scope = createOperationScope();
  const gate = deferred<void>();
  let writes = 0;
  const handler = { success: () => {}, failure: () => {} };
  assert.equal(scope.submit(async () => { writes++; await gate.promise; throw new Error('quota'); }, handler), true);
  assert.equal(scope.submit(async () => { writes++; }, handler), false);
  gate.resolve();
  await flush();
  assert.equal(writes, 1);
  assert.equal(scope.submit(async () => { writes++; }, handler), true);
  await flush();
  assert.equal(writes, 2);
});

test('stale async settings reads cannot overwrite latest result, unmount also revokes them', async () => {
  const scope = createOperationScope();
  const old = deferred<string>();
  const recent = deferred<string>();
  const updates: string[] = [];
  const h = { success: (v: string) => updates.push(v), failure: () => assert.fail('unexpected') };
  scope.latest(() => old.promise, h);
  scope.latest(() => recent.promise, h);
  recent.resolve('new');
  await flush();
  old.resolve('old');
  await flush();
  assert.deepEqual(updates, ['new']);
  const third = deferred<string>();
  scope.latest(() => third.promise, h);
  scope.close();
  third.resolve('unmounted');
  await flush();
  assert.deepEqual(updates, ['new']);
});

test('editing AI config invalidates an older SecureStore read, including late failures', async () => {
  const scope = createOperationScope();
  const stale = deferred<string>();
  const updates: string[] = [];
  scope.latest(() => stale.promise, {
    success: (value) => updates.push(value),
    failure: () => updates.push('error'),
  });
  // A direct user edit owns the form; even the first/only read becomes stale.
  scope.invalidateLatest();
  stale.resolve('old credentials');
  await flush();
  assert.deepEqual(updates, []);

  const second = deferred<string>();
  scope.latest(() => second.promise, {
    success: (value) => updates.push(value),
    failure: () => updates.push('error'),
  });
  assert.equal(scope.submit(async () => 'new credentials', {
    success: (value) => updates.push(value),
    failure: () => assert.fail('unexpected submit error'),
  }), true);
  second.reject(new Error('stale read failed'));
  await flush();
  assert.deepEqual(updates, ['new credentials']);
});

test('read-only export never launches a share effect after leaving Home', async () => {
  const scope = createOperationScope();
  const exportGate = deferred<string>();
  let launched = 0;
  const accepted = scope.submit(async () => {
    const backup = await exportGate.promise;
    if (!scope.isOpen()) return false;
    launched++;
    assert.equal(backup, 'backup snapshot');
    return true;
  }, { success: () => assert.fail('stale success'), failure: () => assert.fail('unexpected error') });
  assert.equal(accepted, true);
  assert.equal(scope.isBusy(), true);
  scope.close();
  exportGate.resolve('backup snapshot');
  await flush();
  assert.equal(launched, 0);
  assert.equal(scope.isOpen(), false);
  assert.equal(scope.isBusy(), false);
});
