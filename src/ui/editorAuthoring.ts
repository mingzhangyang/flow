// Editor authoring shortcuts stay in the UI layer: they only translate compact
// controls into the existing Flow/TimedNode vocabulary.

import type { Flow, TimedNode } from '../domain/types';
import { updateNode } from '../domain/editing';
import {
  editorDurationInputKey,
  parseEditorDuration,
  type EditorInputBuffers,
} from './editorInputBuffers';

export const EDITOR_DURATION_PRESETS = [30, 60, 300, 600, 1800] as const;
export type EditorDurationPreset = (typeof EDITOR_DURATION_PRESETS)[number];

export const QUICK_WAIT_DURATION_SEC: EditorDurationPreset = 300;

export interface EditorAuthoringState {
  flow: Flow;
  inputBuffers: EditorInputBuffers;
}

function isEditorDurationPreset(value: number): value is EditorDurationPreset {
  return (EDITOR_DURATION_PRESETS as readonly number[]).includes(value);
}

/**
 * Derive preset selection from the effective duration, never from separate UI
 * state. A visible raw buffer is authoritative; invalid/intermediate text means
 * no preset is selected even if the backing node still has a preset duration.
 */
export function selectedEditorDurationPreset(
  node: TimedNode,
  rawDurationInput: string | undefined,
): EditorDurationPreset | null {
  const durationSec =
    rawDurationInput === undefined ? node.durationSec : parseEditorDuration(rawDurationInput);
  return durationSec !== null && isEditorDurationPreset(durationSec) ? durationSec : null;
}

/**
 * Preset clicks are one authoring mutation: remove the raw duration buffer that
 * would otherwise win at Save, then update the existing timed node.
 */
export function applyEditorDurationPreset(
  state: EditorAuthoringState,
  nodeId: string,
  durationSec: EditorDurationPreset,
): EditorAuthoringState {
  const node = state.flow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.kind !== 'timed') return state;

  const key = editorDurationInputKey(nodeId);
  let inputBuffers = state.inputBuffers;
  if (Object.prototype.hasOwnProperty.call(state.inputBuffers, key)) {
    inputBuffers = { ...state.inputBuffers };
    delete inputBuffers[key];
  }

  const flow =
    node.durationSec === durationSec
      ? state.flow
      : updateNode(state.flow, nodeId, { durationSec });

  return flow === state.flow && inputBuffers === state.inputBuffers
    ? state
    : { flow, inputBuffers };
}

/**
 * Quick Wait creates an ordinary timed node. The caller injects the localized
 * label so no locale or "wait" concept leaks into the domain layer.
 */
export function createQuickWaitNode(id: string, label: string): TimedNode {
  return {
    id,
    kind: 'timed',
    label,
    durationSec: QUICK_WAIT_DURATION_SEC,
  };
}
