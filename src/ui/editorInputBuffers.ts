// Raw text buffers for compact Editor inputs.
//
// Duration, wall-clock time, and every-N-days have a text editing state that can
// temporarily be invalid (for example "" or "08:"). The Flow definition only
// receives those values when the buffer is materialized for Save, so unfinished
// text cannot be silently lost by Back/discard decisions.

import type { Flow, FlowNode } from '../domain/types';

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
  dirty: boolean;
  invalid: boolean;
}

function resolveNodes(
  nodes: FlowNode[],
  buffers: EditorInputBuffers,
  state: { dirty: boolean; invalid: boolean },
): FlowNode[] {
  return nodes.map((node) => {
    if (node.kind === 'timed') {
      const text = buffers[editorDurationInputKey(node.id)];
      if (text === undefined) return node;
      const durationSec = parseEditorDuration(text);
      if (durationSec === null) {
        state.dirty = true;
        state.invalid = true;
        return node;
      }
      if (durationSec !== node.durationSec) state.dirty = true;
      return durationSec === node.durationSec ? node : { ...node, durationSec };
    }

    if (node.kind === 'scheduled') {
      const text = buffers[editorScheduledTimeInputKey(node.id)];
      if (text === undefined) return node;
      const at = parseEditorTimeOfDay(text);
      if (at === null) {
        state.dirty = true;
        state.invalid = true;
        return node;
      }
      if (at !== node.at) state.dirty = true;
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
 * ignored. Invalid/intermediate text marks the editor dirty and blocks Save.
 */
export function resolveEditorInputBuffers(
  flow: Flow,
  buffers: EditorInputBuffers,
): ResolvedEditorInputBuffers {
  const state = { dirty: false, invalid: false };
  let repeat = flow.repeat;

  if (flow.topology === 'scheduled' && repeat?.kind === 'everyNDays') {
    const text = buffers[editorEveryNDaysInputKey];
    if (text !== undefined) {
      const n = parseEditorEveryNDays(text);
      if (n === null) {
        state.dirty = true;
        state.invalid = true;
      } else if (n !== repeat.n) {
        state.dirty = true;
        repeat = { ...repeat, n };
      }
    }
  }

  const nodes = resolveNodes(flow.nodes, buffers, state);
  const nextFlow = repeat === flow.repeat && nodes.every((node, i) => node === flow.nodes[i])
    ? flow
    : { ...flow, repeat, nodes };

  return { flow: nextFlow, dirty: state.dirty, invalid: state.invalid };
}
