import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkIn } from '../runtime/adherence';
import {
  applyLocalCheckIn, mergeBackupCheckInState, readStoredCheckIns, replaceLocalCheckIns,
} from './checkInState';

const oldDose = checkIn('morning', 1000, true, 1100);
const newerDose = checkIn('morning', 1000, true, 1500);
const otherDose = checkIn('noon', 2000, true, 2100);
const blank = () => readStoredCheckIns(null);
const undo = { kind: 'undo' as const, nodeId: 'morning', scheduledFor: 1000 };

test('durable undo of a known dose suppresses the same dose in repeated old backup imports', () => {
  const taken = applyLocalCheckIn(blank(), { kind: 'record', entry: oldDose });
  const removed = applyLocalCheckIn(taken, undo);
  assert.deepEqual(removed.log, []);
  assert.deepEqual(removed.undone, [{ nodeId: 'morning', scheduledFor: 1000 }]);
  const restored = readStoredCheckIns(JSON.stringify(removed));
  assert.deepEqual(mergeBackupCheckInState(restored, [oldDose, otherDose]).log, [otherDose]);
  assert.deepEqual(mergeBackupCheckInState(
    mergeBackupCheckInState(restored, [oldDose, otherDose]), [oldDose],
  ).log, [otherDose]);
});

test('an explicit undo of an already absent dose also records authoritative local intent', () => {
  const removed = applyLocalCheckIn(blank(), undo);
  assert.deepEqual(mergeBackupCheckInState(removed, [oldDose]).log, []);
  assert.deepEqual(applyLocalCheckIn(removed, undo).undone, removed.undone);
});

test('new local re-check-in clears tombstone and wins against older restored data', () => {
  const removed = applyLocalCheckIn(
    applyLocalCheckIn(blank(), { kind: 'record', entry: oldDose }),
    undo,
  );
  const current = applyLocalCheckIn(removed, { kind: 'record', entry: newerDose });
  assert.deepEqual(current.undone, []);
  assert.deepEqual(mergeBackupCheckInState(current, [oldDose]).log, [newerDose]);
});

test('legacy check-in arrays load unchanged and upgrade when next intent is persisted', () => {
  const previous = readStoredCheckIns(JSON.stringify([oldDose, { nodeId: 1 }]));
  assert.deepEqual(previous, { v: 1, log: [oldDose], undone: [] });
  const undone = applyLocalCheckIn(previous, undo);
  assert.deepEqual(readStoredCheckIns(JSON.stringify(undone)), undone);
});

test('whole-log local replacement records removals and clears tombstones on later re-entry', () => {
  const withDose = replaceLocalCheckIns(blank(), [oldDose]);
  const removed = replaceLocalCheckIns(withDose, []);
  assert.deepEqual(mergeBackupCheckInState(removed, [oldDose]).log, []);
  const newTaken = replaceLocalCheckIns(removed, [newerDose]);
  assert.deepEqual(newTaken.undone, []);
  assert.deepEqual(mergeBackupCheckInState(newTaken, [oldDose]).log, [newerDose]);
});

test('malformed stored undo envelope fails closed instead of erasing user intent', () => {
  const invalid = [
    '{}', '{',
    JSON.stringify({ v: 1, log: [], undone: null }),
    JSON.stringify({ v: 2, log: [], undone: [] }),
    JSON.stringify({ v: 1, log: [], undone: [{ nodeId: 1, scheduledFor: 0 }] }),
    JSON.stringify({ v: 1, log: [oldDose], undone: [{ nodeId: 'morning', scheduledFor: 1000 }] }),
  ];
  for (const text of invalid) {
    assert.throws(() => readStoredCheckIns(text), 'a corrupt undo must never be mistaken for an empty log');
  }
});

test('different doses are independent even if they share node IDs across days', () => {
  const removed = applyLocalCheckIn(blank(), undo);
  const anotherDay = checkIn('morning', 86_401_000, true, 86_401_100);
  const restored = mergeBackupCheckInState(removed, [oldDose, anotherDay, otherDose]);
  assert.deepEqual(restored.log, [anotherDay, otherDose]);
});
