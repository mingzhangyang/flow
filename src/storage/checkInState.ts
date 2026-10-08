// Internal definition-scoped persistence of dose confirmations and explicit local
// undo intent. A missing dose alone cannot say whether it was never recorded or
// intentionally removed; backup restore must not resurrect a later local undo.
//
// One KV value contains BOTH visible check-ins and durable undo identities, so
// a single acknowledged setItem is the commit for either operation (C6/E6).
// The public Backup v1 shape remains CheckIn[] and never exposes this envelope.

import { type CheckIn, isCheckIn, recordCheckIn } from '../runtime/adherence';
import { mergeCheckIns } from './backup';

export interface CheckInIdentity {
  nodeId: string;
  scheduledFor: number;
}

export type CheckInChange =
  | { kind: 'record'; entry: CheckIn }
  | { kind: 'undo'; nodeId: string; scheduledFor: number };

export interface StoredCheckIns {
  v: 1;
  log: CheckIn[];
  undone: CheckInIdentity[];
}

const sameDose = (left: CheckInIdentity, right: CheckInIdentity): boolean =>
  left.nodeId === right.nodeId && left.scheduledFor === right.scheduledFor;

const isIdentity = (value: unknown): value is CheckInIdentity => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const identity = value as { nodeId?: unknown; scheduledFor?: unknown };
  return typeof identity.nodeId === 'string' &&
    typeof identity.scheduledFor === 'number' &&
    Number.isFinite(identity.scheduledFor);
};

export function readStoredCheckIns(text: string | null): StoredCheckIns {
  if (text === null) return { v: 1, log: [], undone: [] };
  const raw: unknown = JSON.parse(text);

  // First-public-v1 has exactly one on-disk shape. Pre-release raw arrays
  // are invalid stored data, not a migration input or an empty log.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('invalid persisted check-in log');
  }
  const state = raw as Partial<StoredCheckIns>;
  if (state.v !== 1 || !Array.isArray(state.log) || !Array.isArray(state.undone) ||
      !state.undone.every(isIdentity)) {
    throw new Error('invalid persisted check-in log');
  }

  const log = state.log.filter(isCheckIn);
  // Fail closed if corruption would make a dose both explicitly undone and
  // taken. We must never silently discard an undo in favor of a stale backup.
  if (log.some((entry) => state.undone!.some((removed) => sameDose(entry, removed)))) {
    throw new Error('conflicting persisted check-in and undo');
  }
  return { v: 1, log, undone: state.undone };
}

export function applyLocalCheckIn(state: StoredCheckIns, change: CheckInChange): StoredCheckIns {
  if (change.kind === 'record') {
    return {
      v: 1,
      log: recordCheckIn(state.log, change.entry),
      undone: state.undone.filter((removed) => !sameDose(removed, change.entry)),
    };
  }
  const id: CheckInIdentity = { nodeId: change.nodeId, scheduledFor: change.scheduledFor };
  return {
    v: 1,
    log: state.log.filter((entry) => !sameDose(entry, id)),
    // Even a redundant explicit undo has durable meaning: a backup may later
    // offer the missing dose, and that older confirmation must stay suppressed.
    undone: state.undone.some((removed) => sameDose(removed, id))
      ? state.undone : [...state.undone, id],
  };
}

export function mergeBackupCheckInState(state: StoredCheckIns, incoming: CheckIn[]): StoredCheckIns {
  // The local state is authoritative for *both* present records and absences
  // resulting from explicit undo. Import never clears or creates tombstones.
  const eligible = incoming.filter((entry) =>
    isCheckIn(entry) && !state.undone.some((removed) => sameDose(removed, entry)));
  return { ...state, log: mergeCheckIns(state.log, eligible) };
}

/** Direct whole-log replacement is an intentional LOCAL edit, never an import. */
export function replaceLocalCheckIns(state: StoredCheckIns, next: CheckIn[]): StoredCheckIns {
  let undone = state.undone.filter((removed) =>
    !next.some((entry) => sameDose(removed, entry)));
  for (const old of state.log) {
    if (!next.some((entry) => sameDose(old, entry)) &&
        !undone.some((removed) => sameDose(removed, old))) {
      undone = [...undone, { nodeId: old.nodeId, scheduledFor: old.scheduledFor }];
    }
  }
  return { v: 1, log: next, undone };
}
