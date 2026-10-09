// Confirmed-write status for the sequential Run snapshot (C5/C6/E2).
// Every save writes the WHOLE Run, so only the latest submitted save decides what the
// user is told: a later success supersedes an earlier failure, never the reverse.
// Pure and framework-free so the contract is testable without React.

import { type RunSaveOutcome } from '../session/definitionRuntime';

export interface RunSaveState {
  /** 'idle' before the first save of a ready Run has been submitted. */
  status: 'idle' | 'saving' | 'saved' | 'failed';
  /**
   * Why the reminder for the latest written snapshot is not installed, or null when it is
   * (or none is needed). Kept while a newer save is pending; only a resolved save changes it.
   */
  reminderIssue: Exclude<RunSaveOutcome['reminder'], 'synced'> | null;
}

export const INITIAL_RUN_SAVE: RunSaveState = { status: 'idle', reminderIssue: null };

export interface RunSaveTracker {
  submit(write: () => Promise<RunSaveOutcome>): void;
  current(): RunSaveState;
  /** Resolves once the latest submitted save (including later re-submissions) settles. */
  settled(): Promise<RunSaveState>;
  /**
   * Like settled(), but gives up when `timeout` resolves first and reports the state at
   * that moment ('saving' = still unconfirmed). Leaving must never hang on a stuck write.
   */
  settledWithin(timeout: Promise<void>): Promise<RunSaveState>;
  /** Stop reporting: an unmounted screen must not receive late status updates. */
  dispose(): void;
}

export function createRunSaveTracker(onChange: (state: RunSaveState) => void): RunSaveTracker {
  let state: RunSaveState = INITIAL_RUN_SAVE;
  let generation = 0;
  let latest: Promise<void> = Promise.resolve();
  let disposed = false;
  const settled = async (): Promise<RunSaveState> => {
    // A save submitted while waiting replaces `latest`; wait for that one too.
    let observed: Promise<void>;
    do {
      observed = latest;
      await observed;
    } while (observed !== latest);
    return state;
  };
  const publish = (next: RunSaveState): void => {
    state = next;
    if (!disposed) onChange(next);
  };

  return {
    submit(write) {
      const mine = ++generation;
      // Keep the last known reminder problem visible until a newer save resolves it.
      publish({ status: 'saving', reminderIssue: state.reminderIssue });
      let attempt: Promise<RunSaveOutcome>;
      try {
        attempt = write();
      } catch (error) {
        attempt = Promise.reject(error);
      }
      latest = attempt.then(
        (outcome) => {
          if (mine === generation) {
            publish({ status: 'saved', reminderIssue: outcome.reminder === 'synced' ? null : outcome.reminder });
          }
        },
        () => {
          if (mine === generation) publish({ status: 'failed', reminderIssue: state.reminderIssue });
        },
      );
    },
    current: () => state,
    settled,
    async settledWithin(timeout) {
      await Promise.race([settled(), timeout]);
      return state;
    },
    dispose() {
      disposed = true;
    },
  };
}
