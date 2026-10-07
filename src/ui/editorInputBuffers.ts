// Raw text buffers for compact Editor inputs.
//
// Duration, wall-clock time, and every-N-days have a text editing state that can
// temporarily be invalid (for example "" or "08:"). The Flow definition only
// receives those values when the buffer is materialized for Save, so unfinished
// text cannot be silently lost by Back/discard decisions.

import type { Flow, FlowNode } from '../domain/types';
import { isEditorDraftDirty } from './editorDraft';

export type EditorInputBuffers = Readonly<Record<string, string>>;

export const editorEveryNDaysInputKey = 'repeat:everyNDays';

export function editorDurationInputKey(nodeId: string): string {
  return `node:${nodeId}:duration`;
}

export function editorScheduledTimeInputKey(nodeId: string): string {
  return `node:${nodeId}:scheduledTime`;
}

export function parseEditorDuration(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function parseEditorEveryNDays(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

export function parseEditorTimeOfDay(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export interface ResolvedEditorInputBuffers {
  flow: Flow;
  invalid: boolean;
}

export interface ResolvedEditorDraftState extends ResolvedEditorInputBuffers {
  dirty: boolean;
}

function resolveNodes(
  nodes: FlowNode[],
  buffers: EditorInputBuffers,
  state: { invalid: boolean },
): FlowNode[] {
  return nodes.map((node) => {
    if (node.kind === 'timed') {
      const text = buffers[editorDurationInputKey(node.id)];
      if (text === undefined) return node;
      const durationSec = parseEditorDuration(text);
      if (durationSec === null) {
        state.invalid = true;
        return node;
      }
      return durationSec === node.durationSec ? node : { ...node, durationSec };
    }

    if (node.kind === 'scheduled') {
      const text = buffers[editorScheduledTimeInputKey(node.id)];
      if (text === undefined) return node;
      const at = parseEditorTimeOfDay(text);
      if (at === null) {
        state.invalid = true;
        return node;
      }
      return at === node.at ? node : { ...node, at };
    }

    if (node.kind === 'parallel') {
      const children = resolveNodes(node.children, buffers, state);
      return children === node.children ? node : { ...node, children };
    }

    return node;
  });
}

/**
 * Materialize currently visible compact-input buffers into a Flow candidate.
 *
 * Inactive buffers (for a node/repeat kind that is no longer visible) are
 * ignored. Invalid/intermediate text is reported separately so the Editor can
 * treat it as dirty and block Save.
 */
export function resolveEditorInputBuffers(
  flow: Flow,
  buffers: EditorInputBuffers,
): ResolvedEditorInputBuffers {
  const state = { invalid: false };
  let repeat = flow.repeat;

  if (flow.topology === 'scheduled' && repeat?.kind === 'everyNDays') {
    const text = buffers[editorEveryNDaysInputKey];
    if (text !== undefined) {
      const n = parseEditorEveryNDays(text);
      if (n === null) {
        state.invalid = true;
      } else if (n !== repeat.n) {
        repeat = { ...repeat, n };
      }
    }
  }

  const nodes = resolveNodes(flow.nodes, buffers, state);
  const nextFlow = repeat === flow.repeat && nodes.every((node, i) => node === flow.nodes[i])
    ? flow
    : { ...flow, repeat, nodes };

  return { flow: nextFlow, invalid: state.invalid };
}

/**
 * Resolve one authoritative Editor state for both Back/discard and Save.
 *
 * Valid raw buffers first materialize into a candidate Flow, then that candidate
 * is compared to the original draft. Only invalid/intermediate raw text is
 * independently dirty because it cannot yet be represented in Flow.
 */
export function resolveEditorDraftState(
  initial: Flow,
  current: Flow,
  buffers: EditorInputBuffers,
): ResolvedEditorDraftState {
  const resolved = resolveEditorInputBuffers(current, buffers);
  return {
    ...resolved,
    dirty: resolved.invalid || isEditorDraftDirty(initial, resolved.flow),
  };
}
