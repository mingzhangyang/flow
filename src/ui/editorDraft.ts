// Editor dirty-state contract: compare the editable definition, not scattered UI flags.
// This stays in the UI/application layer and does not change the Flow domain model.

import type { Flow, FlowNode, Recurrence } from '../domain/types';

function normalizeRepeat(flow: Flow): Recurrence | null {
  if (flow.topology !== 'scheduled') return null;
  const repeat = flow.repeat ?? { kind: 'once' };

  // Rebuild every variant instead of spreading/import-preserving objects.
  // JSON.stringify is order-sensitive for object keys, while recurrence
  // semantics are not, so the signature needs one fixed representation.
  switch (repeat.kind) {
    case 'once':
      return { kind: 'once' };
    case 'daily':
      return { kind: 'daily' };
    case 'weekly':
      return { kind: 'weekly', days: [...repeat.days].sort((a, b) => a - b) };
    case 'everyNDays':
      return { kind: 'everyNDays', n: repeat.n, fromDay: repeat.fromDay };
  }
}

function normalizeNode(node: FlowNode): unknown {
  const base = {
    id: node.id,
    kind: node.kind,
    label: node.label,
    rationale: node.rationale ?? '',
  };

  switch (node.kind) {
    case 'timed':
      return { ...base, durationSec: node.durationSec };
    case 'scheduled':
      return { ...base, at: node.at };
    case 'parallel':
      return { ...base, children: node.children.map(normalizeNode) };
    case 'gate':
    case 'instant':
      return base;
  }
}

/**
 * Stable snapshot of every field the Editor can mutate.
 *
 * Metadata that belongs to persistence/versioning (id, schemaVersion, version,
 * provenance) is intentionally excluded. Optional visible text is normalized so
 * typing and then clearing a field returns to a clean state.
 */
export function editorDraftSignature(flow: Flow): string {
  return JSON.stringify({
    topology: flow.topology,
    title: flow.title,
    description: flow.description ?? '',
    timeZone: flow.timeZone ?? '',
    repeat: normalizeRepeat(flow),
    nodes: flow.nodes.map(normalizeNode),
  });
}

export function isEditorDraftDirty(initial: Flow, current: Flow): boolean {
  return editorDraftSignature(initial) !== editorDraftSignature(current);
}
