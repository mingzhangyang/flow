import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import { createCatalogCoordinator } from './catalogCoordinator';
import { type OwnedCatalogSnapshot } from './flowCatalog';

const flow = (id: string): Flow => ({
  schemaVersion: 2,
  id,
  title: id,
  topology: 'sequential',
  nodes: [],
});

test('并发 refresh 严格串行，旧请求没有 publish 权', async () => {
  const snapshots: OwnedCatalogSnapshot[] = [];
  const coordinator = createCatalogCoordinator((snapshot) => snapshots.push(snapshot));
  const events: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.request(async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
    return { flows: [flow('old')] };
  });
  const second = coordinator.request(async () => {
    events.push('second:start');
    events.push('second:end');
    return { flows: [flow('new')] };
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  const ready = snapshots.filter((snapshot) => snapshot.status === 'ready');
  assert.equal(ready.length, 1);
  assert.equal(ready[0].status === 'ready' ? ready[0].flows[0]?.id : null, 'new');
});

test('失败发布 error 但不毒死队列，retry 仍可 ready', async () => {
  const snapshots: OwnedCatalogSnapshot[] = [];
  const coordinator = createCatalogCoordinator((snapshot) => snapshots.push(snapshot));

  await assert.rejects(() =>
    coordinator.request(async () => {
      throw new Error('boom');
    }),
  );
  assert.equal(coordinator.current().status, 'error');

  await coordinator.request(async () => ({ flows: [flow('recovered')] }));
  const recovered = coordinator.current();
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.status === 'ready' ? recovered.flows[0]?.id : null, 'recovered');
});

test('waitForReady 在 loading/error 期间保留等待者，直到后续成功 snapshot', async () => {
  const coordinator = createCatalogCoordinator(() => {});
  const waiter = coordinator.waitForReady();

  await assert.rejects(() =>
    coordinator.request(async () => {
      throw new Error('temporary');
    }),
  );

  const retry = coordinator.request(async () => ({ flows: [flow('ready')] }));
  const projection = await waiter;
  await retry;
  assert.deepEqual(projection.flows.map((item) => item.id), ['ready']);
});


test('background request 失败只发布 error，不暴露待观察 Promise', async () => {
  const coordinator = createCatalogCoordinator(() => {});
  coordinator.background(async () => {
    throw new Error('background failed');
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(coordinator.current().status, 'error');
});
