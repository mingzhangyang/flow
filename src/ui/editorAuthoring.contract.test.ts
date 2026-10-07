import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flow } from '../domain/types';
import { addNode } from '../domain/editing';
import { editorDurationInputKey, resolveEditorDraftState } from './editorInputBuffers';
import {
  EDITOR_DURATION_PRESETS,
  applyEditorDurationPreset,
  createQuickWaitNode,
  selectedEditorDurationPreset,
} from './editorAuthoring';

const sequential = (durationSec = 60): Flow => ({
  schemaVersion: 2,
  id: 'seq',
  title: 'Sequence',
  topology: 'sequential',
  nodes: [{ id: 'step', kind: 'timed', label: 'Step', durationSec }],
});

test('duration presets map to the existing durationSec values', () => {
  assert.deepEqual([...EDITOR_DURATION_PRESETS], [30, 60, 300, 600, 1800]);

  for (const durationSec of EDITOR_DURATION_PRESETS) {
    const state = applyEditorDurationPreset(
      { flow: sequential(), inputBuffers: {} },
      'step',
      durationSec,
    );
    const node = state.flow.nodes[0];
    if (node.kind !== 'timed') throw new Error('expected timed node');
    assert.equal(node.durationSec, durationSec);
  }
});

test('preset selection is derived from the effective duration', () => {
  const fiveMinutes = sequential(300).nodes[0];
  if (fiveMinutes.kind !== 'timed') throw new Error('expected timed node');

  assert.equal(selectedEditorDurationPreset(fiveMinutes, undefined), 300);
  assert.equal(selectedEditorDurationPreset(fiveMinutes, '300'), 300);
  assert.equal(selectedEditorDurationPreset(fiveMinutes, '123'), null);
});

test('invalid raw duration never exposes a stale backing preset as selected', () => {
  const node = sequential(300).nodes[0];
  if (node.kind !== 'timed') throw new Error('expected timed node');

  assert.equal(selectedEditorDurationPreset(node, ''), null);
  assert.equal(selectedEditorDurationPreset(node, 'not-a-number'), null);
});

test('preset click clears stale raw input before Save materializes the draft', () => {
  const initial = sequential();
  const key = editorDurationInputKey('step');
  const state = applyEditorDurationPreset(
    { flow: initial, inputBuffers: { [key]: '123' } },
    'step',
    300,
  );

  assert.equal(state.inputBuffers[key], undefined);
  const resolved = resolveEditorDraftState(initial, state.flow, state.inputBuffers);
  assert.equal(resolved.invalid, false);
  if (resolved.flow.nodes[0].kind !== 'timed') throw new Error('expected timed node');
  assert.equal(resolved.flow.nodes[0].durationSec, 300);
  assert.equal(resolved.dirty, true);
});

test('Quick Wait is an ordinary timed node with a caller-injected localized label', () => {
  const wait = createQuickWaitNode('wait-1', 'Localized wait');
  assert.deepEqual(wait, {
    id: 'wait-1',
    kind: 'timed',
    label: 'Localized wait',
    durationSec: 300,
  });
});

test('Quick Wait is naturally covered by the canonical dirty-state contract', () => {
  const initial = sequential();
  const current = addNode(initial, createQuickWaitNode('wait-2', 'Wait'));
  const resolved = resolveEditorDraftState(initial, current, {});

  assert.equal(resolved.invalid, false);
  assert.equal(resolved.dirty, true);
});
