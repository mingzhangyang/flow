import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flow } from '../domain/types';
import {
  editorDurationInputKey,
  editorEveryNDaysInputKey,
  editorScheduledTimeInputKey,
  resolveEditorInputBuffers,
} from './editorInputBuffers';

const sequential = (): Flow => ({
  schemaVersion: 2,
  id: 'seq',
  title: 'Sequence',
  topology: 'sequential',
  nodes: [{ id: 'step', kind: 'timed', label: 'Wait', durationSec: 60 }],
});

const scheduled = (): Flow => ({
  schemaVersion: 2,
  id: 'sched',
  title: 'Schedule',
  topology: 'scheduled',
  repeat: { kind: 'everyNDays', n: 2, fromDay: 20 },
  nodes: [{ id: 'dose', kind: 'scheduled', label: 'Dose', at: 8 * 60 }],
});

test('invalid duration buffer remains dirty and does not mutate Flow candidate', () => {
  const flow = sequential();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorDurationInputKey('step')]: '',
  });

  assert.equal(resolved.dirty, true);
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.flow.nodes[0].kind, 'timed');
  if (resolved.flow.nodes[0].kind !== 'timed') throw new Error('expected timed node');
  assert.equal(resolved.flow.nodes[0].durationSec, 60);
});

test('valid duration buffer materializes only at save boundary', () => {
  const flow = sequential();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorDurationInputKey('step')]: '90',
  });

  assert.equal(resolved.dirty, true);
  assert.equal(resolved.invalid, false);
  if (resolved.flow.nodes[0].kind !== 'timed') throw new Error('expected timed node');
  assert.equal(resolved.flow.nodes[0].durationSec, 90);
  assert.equal((flow.nodes[0] as { durationSec: number }).durationSec, 60);
});

test('unfinished scheduled time is dirty and invalid', () => {
  const flow = scheduled();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('dose')]: '08:',
  });

  assert.deepEqual(
    { dirty: resolved.dirty, invalid: resolved.invalid },
    { dirty: true, invalid: true },
  );
});

test('valid scheduled time and every-N buffers materialize together', () => {
  const flow = scheduled();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('dose')]: '09:15',
    [editorEveryNDaysInputKey]: '3',
  });

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, true);
  assert.deepEqual(resolved.flow.repeat, { kind: 'everyNDays', n: 3, fromDay: 20 });
  if (resolved.flow.nodes[0].kind !== 'scheduled') throw new Error('expected scheduled node');
  assert.equal(resolved.flow.nodes[0].at, 9 * 60 + 15);
});

test('semantically unchanged compact input is clean', () => {
  const flow = scheduled();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('dose')]: '8:00',
    [editorEveryNDaysInputKey]: '02',
  });

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, false);
});

test('buffers for inactive fields are ignored', () => {
  const flow = sequential();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('step')]: 'bad',
    [editorEveryNDaysInputKey]: '',
  });

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, false);
});
