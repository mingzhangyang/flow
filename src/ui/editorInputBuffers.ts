// Raw text buffers for compact Editor inputs.
//
// Duration, wall-clock time, and every-N-days have a text editing state that can
// temporarily be invalid (for example "" or "08:"). The Flow definition only
// changes after parsing succeeds, so this buffer state must participate in
// dirty/save decisions to avoid silently dropping unfinished edits.

import type { Flow, FlowNode } from '../domain/types';
import { fmtTimeOfDay } from './format';

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

function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === 'parallel') {
      const child = findNode(node.children, id);
      if (child) return child;
    }
  }
  return null;
}

function nodeKeyParts(key: string): { id: string; field: 'duration' | 'scheduledTime' } | null {
  const durationSuffix = ':duration';
  const scheduledTimeSuffix = ':scheduledTime';
  if (!key.startsWith('node:')) return null;

  if (key.endsWith(durationSuffix)) {
    return { id: key.slice(5, -durationSuffix.length), field: 'duration' };
  }
  if (key.endsWith(scheduledTimeSuffix)) {
    return { id: key.slice(5, -scheduledTimeSuffix.length), field: 'scheduledTime' };
  }
  return null;
}

export interface EditorInputBufferStatus {
  dirty: boolean;
  invalid: boolean;
}

/**
 * Compare visible raw text with the currently parsed Flow.
 *
 * Buffers for fields that are no longer visible/applicable are ignored. A valid
 * buffer normally becomes clean as soon as its parsed value reaches Flow state;
 * invalid/intermediate text remains dirty and blocks Save.
 */
export function editorInputBufferStatus(
  flow: Flow,
  buffers: EditorInputBuffers,
): EditorInputBufferStatus {
  let dirty = false;
  let invalid = false;

  for (const [key, text] of Object.entries(buffers)) {
    if (key === editorEveryNDaysInputKey) {
      if (flow.topology !== 'scheduled' || flow.repeat?.kind !== 'everyNDays') continue;
      const canonical = String(flow.repeat.n);
      if (text !== canonical) dirty = true;
      if (parseEditorEveryNDays(text) === null) invalid = true;
      continue;
    }

    const parts = nodeKeyParts(key);
    if (!parts) continue;
    const node = findNode(flow.nodes, parts.id);
    if (!node) continue;

    if (parts.field === 'duration') {
      if (node.kind !== 'timed') continue;
      if (text !== String(node.durationSec)) dirty = true;
      if (parseEditorDuration(text) === null) invalid = true;
      continue;
    }

    if (node.kind !== 'scheduled') continue;
    if (text !== fmtTimeOfDay(node.at)) dirty = true;
    if (parseEditorTimeOfDay(text) === null) invalid = true;
  }

  return { dirty, invalid };
}
