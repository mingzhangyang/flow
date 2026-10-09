// The single owner of a sequential Runner's state (C5/C6/E2): the Run the user sees, the
// confirmed-save status of that Run, and the leave decision. React only mirrors it.
// Pure and framework-free, so its invariants are tested over random interleavings
// (runController.contract.test.ts):
//
//   I1  A user intent only applies to the snapshot the user was looking at. A second tap
//       issued from an older render is ignored, never applied to the next step.
//   I2  A leave needs no confirmation only when the Run the user sees is confirmed
//       persisted ('idle' before load, or 'saved'). Saving/failed always ask.
//   I3  Every change to the visible Run submits its save in the same call, so I2 never
//       sees a stale 'saved' for an unsubmitted Run.
//
// Reminders are not handled here: the session derives them from the persisted Run only.

import { type Run, type RunEvent } from '../domain/types';
import { reduce } from '../runtime/engine';
import { type RunSaveOutcome } from '../session/definitionRuntime';
import { createRunSaveTracker, type RunSaveState } from './runSaveTracker';

export interface RunControllerDeps {
  /** Persist the whole snapshot (session.saveRun with the current locale). */
  save(run: Run): Promise<RunSaveOutcome>;
  onRun(run: Run): void;
  onSave(state: RunSaveState): void;
}

export interface RunController {
  current(): Run;
  saveState(): RunSaveState;
  /** The loaded Run becomes visible; it is re-saved so its reminder is re-synced. */
  install(run: Run): void;
  /**
   * Apply the event `decide` computes from the Run the user saw (`seen`). Ignored when
   * not installed, when `seen` is no longer the visible Run (stale render, I1), or when
   * `decide` returns null. Returns whether the Run changed.
   */
  dispatch(seen: Run, decide: (run: Run) => RunEvent | null): boolean;
  /** Replace the visible Run (reset), with the same staleness rule as dispatch. */
  replace(seen: Run, next: Run): boolean;
  /** Re-save the visible Run: retry after failure, or locale change (reminder copy). */
  resave(): void;
  /** I2. Read synchronously from the tracker, never from a lagging render. */
  needsLeaveConfirmation(): boolean;
  /** Wait for the latest save, at most until `timeout`; then report the state. */
  settledWithin(timeout: Promise<void>): Promise<RunSaveState>;
  dispose(): void;
}

export function createRunController(initial: Run, deps: RunControllerDeps): RunController {
  let run = initial;
  let installed = false;
  const saves = createRunSaveTracker(deps.onSave);
  const show = (next: Run): void => {
    run = next;
    deps.onRun(next);
    saves.submit(() => deps.save(next)); // I3: same call as the change.
  };

  return {
    current: () => run,
    saveState: () => saves.current(),
    install(loaded) {
      installed = true;
      show(loaded);
    },
    dispatch(seen, decide) {
      if (!installed || seen !== run) return false;
      const event = decide(run);
      if (!event) return false;
      show(reduce(run, event));
      return true;
    },
    replace(seen, next) {
      if (!installed || seen !== run) return false;
      show(next);
      return true;
    },
    resave() {
      if (installed) saves.submit(() => deps.save(run));
    },
    needsLeaveConfirmation() {
      const { status } = saves.current();
      return status === 'saving' || status === 'failed';
    },
    settledWithin: (timeout) => saves.settledWithin(timeout),
    dispose: () => saves.dispose(),
  };
}
