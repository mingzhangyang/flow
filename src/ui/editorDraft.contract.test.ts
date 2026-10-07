import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flow } from '../domain/types';
import { isEditorDraftDirty } from './editorDraft';

const sequential = (): Flow => ({
  schemaVersion: 2,
  version: 3,
  id: 'flow-seq',
  title: 'Coffee',
  description: 'Morning recipe',
  topology: 'sequential',
  nodes: [
    { id: 'a', kind: 'timed', label: 'Steep', rationale: 'Extract evenly', durationSec: 240 },
    { id: 'b', kind: 'instant', label: 'Press' },
  ],
});

const scheduled = (): Flow => ({
  schemaVersion: 2,
  version: 2,
  id: 'flow-scheduled',
  title: 'Medication',
  description: 'Daily reminders',
  topology: 'scheduled',
  timeZone: 'Asia/Shanghai',
  repeat: { kind: 'daily' },
  nodes: [
    { id: 'morning', kind: 'scheduled', label: 'Morning dose', rationale: 'With breakfast', at: 8 * 60 },
    { id: 'evening', kind: 'scheduled', label: 'Evening dose', at: 20 * 60 },
  ],
});

test('unchanged and semantically-empty optional fields stay clean', () => {
  const initial = sequential();
  assert.equal(isEditorDraftDirty(initial, initial), false);
  assert.equal(isEditorDraftDirty(initial, { ...initial }), false);

  const blankOptional: Flow = {
    ...initial,
    description: undefined,
    timeZone: undefined,
  };
  assert.equal(
    isEditorDraftDirty(blankOptional, { ...blankOptional, description: '', timeZone: '' }),
    false,
  );

  const scheduledOnce: Flow = {
    ...scheduled(),
    repeat: undefined,
  };
  assert.equal(
    isEditorDraftDirty(scheduledOnce, { ...scheduledOnce, repeat: { kind: 'once' } }),
    false,
  );
});

test('flow metadata edits are dirty and reverting is clean', () => {
  const initial = scheduled();

  assert.equal(isEditorDraftDirty(initial, { ...initial, title: 'Medication plan' }), true);
  assert.equal(isEditorDraftDirty(initial, { ...initial, description: 'Updated' }), true);
  assert.equal(isEditorDraftDirty(initial, { ...initial, timeZone: 'America/New_York' }), true);
  assert.equal(isEditorDraftDirty(initial, { ...initial, repeat: { kind: 'weekly', days: [1, 3, 5] } }), true);
  assert.equal(isEditorDraftDirty(initial, { ...initial, title: initial.title }), false);
});

test('node add, remove, move, label, rationale and kind edits are dirty', () => {
  const initial = sequential();

  assert.equal(
    isEditorDraftDirty(initial, {
      ...initial,
      nodes: [...initial.nodes, { id: 'c', kind: 'gate', label: 'Taste' }],
    }),
    true,
  );
  assert.equal(isEditorDraftDirty(initial, { ...initial, nodes: initial.nodes.slice(0, 1) }), true);
  assert.equal(isEditorDraftDirty(initial, { ...initial, nodes: [...initial.nodes].reverse() }), true);
  assert.equal(
    isEditorDraftDirty(initial, {
      ...initial,
      nodes: [{ ...initial.nodes[0], label: 'Steep gently' }, initial.nodes[1]],
    }),
    true,
  );
  assert.equal(
    isEditorDraftDirty(initial, {
      ...initial,
      nodes: [{ ...initial.nodes[0], rationale: 'Different reason' }, initial.nodes[1]],
    }),
    true,
  );
  assert.equal(
    isEditorDraftDirty(initial, {
      ...initial,
      nodes: [{ id: 'a', kind: 'gate', label: 'Steep', rationale: 'Extract evenly' }, initial.nodes[1]],
    }),
    true,
  );
});

test('timed duration and scheduled wall-clock edits are dirty', () => {
  const seq = sequential();
  const timed = seq.nodes[0];
  assert.equal(timed.kind, 'timed');
  assert.equal(
    isEditorDraftDirty(seq, {
      ...seq,
      nodes: [{ ...timed, durationSec: timed.durationSec + 30 }, seq.nodes[1]],
    }),
    true,
  );

  const plan = scheduled();
  const morning = plan.nodes[0];
  assert.equal(morning.kind, 'scheduled');
  assert.equal(
    isEditorDraftDirty(plan, {
      ...plan,
      nodes: [{ ...morning, at: morning.at + 15 }, plan.nodes[1]],
    }),
    true,
  );
});
