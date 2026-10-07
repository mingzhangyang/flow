import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flow } from '../domain/types';
import {
  editorDurationInputKey,
  editorEveryNDaysInputKey,
  editorScheduledTimeInputKey,
  resolveEditorDraftState,
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

  assert.equal(resolved.invalid, true);
});

test('valid scheduled time and every-N buffers materialize together', () => {
  const flow = scheduled();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('dose')]: '09:15',
    [editorEveryNDaysInputKey]: '3',
  });

  assert.equal(resolved.invalid, false);
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
});

test('buffers for inactive fields are ignored', () => {
  const flow = sequential();
  const resolved = resolveEditorInputBuffers(flow, {
    [editorScheduledTimeInputKey('step')]: 'bad',
    [editorEveryNDaysInputKey]: '',
  });

  assert.equal(resolved.invalid, false);
});


test('resolved candidate can return the Editor to clean state', () => {
  const initial: Flow = {
    ...sequential(),
    nodes: [{ id: 'step', kind: 'timed', label: 'Wait', durationSec: 90 }],
  };
  // Mirrors Timed -> Gate -> Timed: the structural draft is back to Timed,
  // but makeNode has reset duration to 60 until the visible raw input is applied.
  const current: Flow = {
    ...initial,
    nodes: [{ id: 'step', kind: 'timed', label: 'Wait', durationSec: 60 }],
  };

  const resolved = resolveEditorDraftState(initial, current, {
    [editorDurationInputKey('step')]: '90',
  });

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, false);
  if (resolved.flow.nodes[0].kind !== 'timed') throw new Error('expected timed node');
  assert.equal(resolved.flow.nodes[0].durationSec, 90);
});

test('invalid raw input remains dirty even when backing Flow matches the draft', () => {
  const initial = sequential();
  const resolved = resolveEditorDraftState(initial, initial, {
    [editorDurationInputKey('step')]: '',
  });

  assert.equal(resolved.invalid, true);
  assert.equal(resolved.dirty, true);
});

test('materialized value different from the draft is dirty', () => {
  const initial = sequential();
  const resolved = resolveEditorDraftState(initial, initial, {
    [editorDurationInputKey('step')]: '90',
  });

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, true);
});
