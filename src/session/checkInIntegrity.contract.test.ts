import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type KVStore, createInMemoryKV } from '../storage/kv';
import { createStorage } from '../storage/storage';
import { createLibrary } from './library';
import { createDefinitionRuntime } from './definitionRuntime';
import { definitionKey } from '../domain/definitionIdentity';
import { checkIn } from '../runtime/adherence';
import { noopNotifier } from '../notifications/notifier';
import { BACKUP_KIND, BACKUP_VERSION, parseBackup, type Backup } from '../storage/backup';

const key = definitionKey({ flowId: 'med', source: 'owned' });
const morning = checkIn('morning', 10_000, true, 20_000);
const noon = checkIn('noon', 30_000, true, 40_000);
const makeSession = (storage: ReturnType<typeof createStorage>) =>
  createDefinitionRuntime({ storage, notifier: noopNotifier, now: () => 0 }).open(key);
const record = (entry: typeof morning) => ({ kind: 'record' as const, entry });
const undo = (entry: typeof morning) => ({
  kind: 'undo' as const, nodeId: entry.nodeId, scheduledFor: entry.scheduledFor,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('check-in/undo only resolve with committed snapshots; reopen reflects the same history', async () => {
  const storage = createStorage(createInMemoryKV());
  const session = makeSession(storage);
  assert.deepEqual(await session.changeCheckIn(record(morning)), [morning]);
  assert.deepEqual(await session.changeCheckIn(record(noon)), [morning, noon]);
  assert.deepEqual(await session.changeCheckIn(undo(morning)), [noon]);
  const reopened = makeSession(storage);
  assert.deepEqual(await reopened.loadCheckIns(), [noon]);
});

test('check-in failed write is visible as rejection, preserves storage, and retry is idempotent', async () => {
  const base = createInMemoryKV();
  let fail = true;
  const kv: KVStore = {
    ...base,
    async setItem(k, v) {
      if (k.startsWith('checkins:v1:') && fail) {
        fail = false;
        throw new Error('out of space');
      }
      await base.setItem(k, v);
    },
  };
  const storage = createStorage(kv);
  const session = makeSession(storage);
  await assert.rejects(() => session.changeCheckIn(record(morning)), /out of space/);
  assert.deepEqual(await storage.loadCheckIns(key), []);
  assert.deepEqual(await session.changeCheckIn(record(morning)), [morning]);
  assert.deepEqual(await session.changeCheckIn(record(morning)), [morning]);
});

test('undo write failure preserves committed check-in until retry succeeds', async () => {
  const base = createInMemoryKV();
  const storage = createStorage({
    ...base,
    async setItem(k, v) {
      if (k.startsWith('checkins:v1:') && failUndo) throw new Error('failed undo');
      await base.setItem(k, v);
    },
  });
  let failUndo = false;
  const session = makeSession(storage);
  await session.changeCheckIn(record(morning));
  failUndo = true;
  await assert.rejects(() => session.changeCheckIn(undo(morning)), /failed undo/);
  assert.deepEqual(await storage.loadCheckIns(key), [morning]);
  failUndo = false;
  assert.deepEqual(await session.changeCheckIn(undo(morning)), []);
});

test('rapid operations serialize read-modify-write; no lost update or stale whole-table overwrite', async () => {
  const storage = createStorage(createInMemoryKV());
  const session = makeSession(storage);
  const results = await Promise.all([
    session.changeCheckIn(record(morning)),
    session.changeCheckIn(record(noon)),
    session.changeCheckIn(undo(morning)),
  ]);
  assert.deepEqual(results[0], [morning]);
  assert.deepEqual(results[1], [morning, noon]);
  assert.deepEqual(results[2], [noon]);
  assert.deepEqual(await storage.loadCheckIns(key), [noon]);
});

test('rejected older write never rolls back a later successfully committed mutation', async () => {
  const base = createInMemoryKV();
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const storage = createStorage({
    ...base,
    async setItem(k, v) {
      if (k.startsWith('checkins:v1:') && ++calls === 1) {
        entered.resolve();
        await release.promise;
        throw new Error('first write failed');
      }
      await base.setItem(k, v);
    },
  });
  const session = makeSession(storage);
  const old = session.changeCheckIn(record(morning));
  await entered.promise;
  const latest = session.changeCheckIn(record(noon));
  release.resolve();
  await assert.rejects(() => old, /first write failed/);
  assert.deepEqual(await latest, [noon]);
  assert.deepEqual(await storage.loadCheckIns(key), [noon]);
});

test('accepted writes drain after session close; reopen reads after the queue', async () => {
  const base = createInMemoryKV();
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const storage = createStorage({
    ...base,
    async setItem(k, v) {
      if (k.startsWith('checkins:v1:') && ++calls === 1) {
        entered.resolve();
        await release.promise;
      }
      await base.setItem(k, v);
    },
  });
  const runtime = createDefinitionRuntime({ storage, notifier: noopNotifier, now: () => 0 });
  const session = runtime.open(key);
  const a = session.changeCheckIn(record(morning));
  await entered.promise;
  const b = session.changeCheckIn(record(noon));
  session.close();
  await assert.rejects(() => session.changeCheckIn(record(morning)), /closed/);
  const reopened = runtime.open(key);
  const loaded = reopened.loadCheckIns();
  release.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(await loaded, [morning, noon]);
});

test('backup excludes uncommitted or rejected check-ins, then includes a confirmed retry', async () => {
  const base = createInMemoryKV();
  const entered = deferred();
  const release = deferred();
  let fail = true;
  const storage = createStorage({
    ...base,
    async setItem(k, v) {
      if (k.startsWith('checkins:v1:') && fail) {
        entered.resolve();
        await release.promise;
        fail = false;
        throw new Error('quota');
      }
      await base.setItem(k, v);
    },
  });
  const library = createLibrary(storage);
  const session = makeSession(storage);
  const writing = session.changeCheckIn(record(morning));
  await entered.promise;
  const whilePending = parseBackup(await library.exportBackup(1));
  assert.ok(whilePending);
  assert.deepEqual(whilePending.checkIns, {});
  release.resolve();
  await assert.rejects(() => writing, /quota/);
  const afterFailure = parseBackup(await library.exportBackup(2));
  assert.ok(afterFailure);
  assert.deepEqual(afterFailure.checkIns, {});
  await session.changeCheckIn(record(morning));
  const committed = parseBackup(await library.exportBackup(3));
  assert.ok(committed);
  assert.deepEqual(committed.checkIns[key], [morning]);
});

test('backup restore and real-time taps share a single storage lane, preserving both intents', async () => {
  const storage = createStorage(createInMemoryKV());
  const library = createLibrary(storage);
  const session = makeSession(storage);
  const backup: Backup = {
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  };
  const live = session.changeCheckIn(record(noon));
  const restore = library.importBackup(backup);
  await Promise.all([live, restore]);
  // The operation entry order is intentionally unspecified across callers;
  // the persistence contract guarantees both distinct doses survive.
  assert.deepEqual(
    (await session.loadCheckIns()).sort((a, b) => a.scheduledFor - b.scheduledFor),
    [morning, noon],
  );
});

test('accepted undo remains authoritative over same-dose backup restore after leaving Schedule', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const library = createLibrary(storage);
  const session = makeSession(storage);
  await session.changeCheckIn(record(morning));

  const entered = deferred();
  const release = deferred();
  let pauseUndo = true;
  // An injected storage adapter interleaves an accepted undo, session close,
  // and import. All three must share the one definition-scoped storage lane.
  const paused = createStorage({
    ...kv,
    async setItem(k, v) {
      if (pauseUndo && k === 'checkins:v1:' + key) {
        const decoded = JSON.parse(v) as { undone?: unknown[] };
        if (decoded.undone?.length) {
          pauseUndo = false;
          entered.resolve();
          await release.promise;
        }
      }
      await kv.setItem(k, v);
    },
  });
  const runtime = createDefinitionRuntime({ storage: paused, notifier: noopNotifier, now: () => 0 });
  const active = runtime.open(key);
  const pendingUndo = active.changeCheckIn(undo(morning));
  await entered.promise;
  active.close();
  const importing = createLibrary(paused).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning, noon] },
  });
  release.resolve();
  await Promise.all([pendingUndo, importing]);
  assert.deepEqual(await paused.loadCheckIns(key), [noon]);
  assert.deepEqual(await library.exportBackup(2).then(parseBackup).then((b) => b?.checkIns[key]), [noon]);

  // Simulate process restart: the undo is persisted, not a transient flag in
  // the old screen or the old createStorage instance.
  const reopened = createStorage(kv);
  await createLibrary(reopened).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  });
  assert.deepEqual(await reopened.loadCheckIns(key), [noon]);
});

test('explicit undo remains durable even when no dose is currently present', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const session = makeSession(storage);
  await session.changeCheckIn(undo(morning));
  assert.deepEqual(await storage.loadCheckIns(key), []);
  const backup: Backup = {
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  };
  await createLibrary(storage).importBackup(backup);
  assert.deepEqual(await storage.loadCheckIns(key), []);
  // Tombstones remain local metadata; Backup v1 exports visible facts only.
  assert.deepEqual(parseBackup(await createLibrary(storage).exportBackup(2))?.checkIns, {});
});

test('re-checking an undone dose intentionally replaces the undo and beats old backups', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  const session = makeSession(storage);
  await session.changeCheckIn(record(morning));
  await session.changeCheckIn(undo(morning));
  const newer = checkIn('morning', morning.scheduledFor, true, 100_000);
  assert.deepEqual(await session.changeCheckIn(record(newer)), [newer]);
  await createLibrary(storage).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  });
  assert.deepEqual(await storage.loadCheckIns(key), [newer]);
  const raw = await kv.getItem('checkins:v1:' + key);
  assert.ok(raw);
  assert.deepEqual(JSON.parse(raw).undone, []);
});

test('undo write failure never leaves a phantom tombstone; retry remains durable', async () => {
  const kv = createInMemoryKV();
  let rejectUndo = false;
  const storage = createStorage({
    ...kv,
    async setItem(k, v) {
      if (rejectUndo && k === 'checkins:v1:' + key) throw new Error('undo commit rejected');
      await kv.setItem(k, v);
    },
  });
  const session = makeSession(storage);
  await session.changeCheckIn(record(morning));
  rejectUndo = true;
  await assert.rejects(() => session.changeCheckIn(undo(morning)), /undo commit rejected/);
  const previous = await kv.getItem('checkins:v1:' + key);
  assert.ok(previous);
  assert.deepEqual(JSON.parse(previous).undone, []);
  assert.deepEqual(await storage.loadCheckIns(key), [morning]);
  rejectUndo = false;
  await session.changeCheckIn(undo(morning));
  await createLibrary(storage).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  });
  assert.deepEqual(await createStorage(kv).loadCheckIns(key), []);
});

test('deleting a definition clears its undo fence; a recreated identity starts fresh', async () => {
  const kv = createInMemoryKV();
  const storage = createStorage(kv);
  await makeSession(storage).changeCheckIn(undo(morning));
  assert.ok(await kv.getItem('checkins:v1:' + key));
  await storage.deleteCheckIns(key);
  assert.equal(await kv.getItem('checkins:v1:' + key), null);
  await createLibrary(storage).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  });
  assert.deepEqual(await storage.loadCheckIns(key), [morning]);
});

test('first-public-v1 rejects raw check-in arrays without erasing them during undo or backup restore', async () => {
  const kv = createInMemoryKV();
  const oldShape = JSON.stringify([morning]);
  await kv.setItem('checkins:v1:' + key, oldShape);
  const storage = createStorage(kv);
  await assert.rejects(() => storage.loadCheckIns(key), /invalid persisted check-in log/);
  await assert.rejects(() => makeSession(storage).changeCheckIn(undo(morning)), /invalid persisted check-in log/);
  await assert.rejects(() => createLibrary(storage).importBackup({
    kind: BACKUP_KIND, backupVersion: BACKUP_VERSION, exportedAt: 1,
    flows: [], revisions: {}, checkIns: { [key]: [morning] },
  }), /invalid persisted check-in log/);
  assert.equal(await kv.getItem('checkins:v1:' + key), oldShape);
});
