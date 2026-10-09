// Confirmed-write status for the sequential Run snapshot (C5/C6/E2).
// Every save writes the WHOLE Run, so only the latest submitted save decides what the
// user is told: a later success supersedes an earlier failure, never the reverse.
// Pure and framework-free so the contract is testable without React.

import { type RunSaveOutcome } from '../session/definitionRuntime';

export interface RunSaveState {
  /** 'idle' before the first save of a ready Run has been submitted. */
  status: 'idle' | 'saving' | 'saved' | 'failed';
  /** Snapshot written, but the platform reminder could not be synced to it. */
  reminderFailed: boolean;
}

export const INITIAL_RUN_SAVE: RunSaveState = { status: 'idle', reminderFailed: false };

export interface RunSaveTracker {
  submit(write: () => Promise<RunSaveOutcome>): void;
  current(): RunSaveState;
  /** Resolves once the latest submitted save (including later re-submissions) settles. */
  settled(): Promise<RunSaveState>;
  /** Stop reporting: an unmounted screen must not receive late status updates. */
  dispose(): void;
}

export function createRunSaveTracker(onChange: (state: RunSaveState) => void): RunSaveTracker {
  let state: RunSaveState = INITIAL_RUN_SAVE;
  let generation = 0;
  let latest: Promise<void> = Promise.resolve();
  let disposed = false;
  const publish = (next: RunSaveState): void => {
    state = next;
    if (!disposed) onChange(next);
  };

  return {
    submit(write) {
      const mine = ++generation;
      // Keep the last known reminder problem visible until a newer save resolves it.
      publish({ status: 'saving', reminderFailed: state.reminderFailed });
      let attempt: Promise<RunSaveOutcome>;
      try {
        attempt = write();
      } catch (error) {
        attempt = Promise.reject(error);
      }
      latest = attempt.then(
        (outcome) => {
          if (mine === generation) publish({ status: 'saved', reminderFailed: outcome.reminder === 'failed' });
        },
        () => {
          if (mine === generation) publish({ status: 'failed', reminderFailed: state.reminderFailed });
        },
      );
    },
    current: () => state,
    async settled() {
      // A save submitted while waiting replaces `latest`; wait for that one too.
      let observed: Promise<void>;
      do {
        observed = latest;
        await observed;
      } while (observed !== latest);
      return state;
    },
    dispose() {
      disposed = true;
    },
  };
}
