// Definition-scoped runtime effects have one queue and revocable screen sessions.
// Leaving a screen stops new submissions but drains accepted work. Deletion fences all old
// sessions, waits for that work (including native scheduling), then performs journal cleanup.

import { type Flow, type Run } from '../domain/types';
import { assertDefinitionKey, assertDefinitionKeyForFlow } from '../domain/definitionIdentity';
import { type Locale } from '../i18n/locale';
import { type CheckIn } from '../runtime/adherence';
import { type CheckInChange } from '../storage/checkInState';
export type { CheckInChange } from '../storage/checkInState';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { planSequentialReminder } from '../notifications/plan';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { activeRunId, loadRunForDefinition } from './runPersistence';

export interface RunSaveOutcome {
  /**
   * synced: the reminder matching the snapshot is installed (or none is needed).
   * failed: syncing threw (or permission is still undetermined) — worth retrying.
   * denied / unsupported: scheduling "succeeded" but nothing will fire (no permission,
   * or a platform without scheduled notifications); the UI must say so (E6).
   */
  reminder: 'synced' | 'failed' | 'denied' | 'unsupported';
}

export interface RuntimeSession {
  readonly id: number;
  readonly definitionKey: string;
  isOpen(): boolean;
  close(): void;
  loadRun(flow: Flow): Promise<Run>;
  /**
   * Durably writes the full Run snapshot, then syncs its sequential reminder to the
   * same snapshot. Rejects only when the snapshot was not confirmed written; reminder
   * sync is still attempted then, so the platform timer never contradicts the screen.
   * A written snapshot whose reminder is not actually installed resolves with the reason.
   */
  saveRun(run: Run, locale: Locale): Promise<RunSaveOutcome>;
  /**
   * After the user leaves with an unconfirmed snapshot, align the sequential reminder with
   * what is actually persisted (what reopening will show). Queued behind every accepted
   * save. If the persisted Run cannot be read, the reminder is cancelled rather than
   * left pointing at progress that may not exist.
   */
  syncReminderToSaved(flow: Flow, locale: Locale): Promise<void>;
  /**
   * Arms syncReminderToSaved to be queued at the moment this session closes, ahead of any
   * later submission. Approval to leave is not leaving: until App closes the session the
   * Runner (and its reminder) stays as is. Re-arming replaces the earlier request; a later
   * save that confirms both the snapshot and its reminder disarms it.
   */
  realignReminderOnClose(flow: Flow, locale: Locale): void;
  loadCheckIns(): Promise<CheckIn[]>;
  /** Returns the confirmed persisted log; failures reject and do not claim commit. */
  changeCheckIn(change: CheckInChange): Promise<CheckIn[]>;
}

export interface DefinitionRuntime {
  /** Called by navigation, never by delayed screen effects. */
  open(definitionKey: string): RuntimeSession;
  /** Blocks new sessions until cleanup succeeds; retries remain possible after failure. */
  retire(definitionKey: string, cleanup: () => Promise<void>): Promise<void>;
}

interface Lane {
  tail: Promise<void>;
  blocked: boolean;
  closeCurrent: () => void;
  retirement: number;
}

export function createDefinitionRuntime(deps: {
  storage: Pick<Storage, 'loadRun' | 'saveRun' | 'loadCheckIns' | 'changeCheckIn'>;
  notifier: Pick<Notifier, 'cancel' | 'schedule' | 'status'>;
  now: () => number;
}): DefinitionRuntime {
  const lanes = new Map<string, Lane>();
  let nextSessionId = 0;
  const laneFor = (key: string): Lane => {
    assertDefinitionKey(key);
    let lane = lanes.get(key);
    if (!lane) {
      lane = { tail: Promise.resolve(), blocked: false, closeCurrent: () => {}, retirement: 0 };
      lanes.set(key, lane);
    }
    return lane;
  };
  const enqueue = <T>(lane: Lane, task: () => Promise<T>): Promise<T> => {
    const result = lane.tail.then(task);
    lane.tail = result.then(() => {}, () => {});
    return result;
  };

  return {
    open(definitionKey) {
      const lane = laneFor(definitionKey);
      if (lane.blocked) throw new Error('definition deletion is pending');
      lane.closeCurrent();
      let closed = false;
      let onClose: (() => Promise<void>) | null = null;
      const close = (): void => {
        if (closed) return;
        closed = true;
        const armed = onClose;
        onClose = null;
        // Deletion (blocked lane) cancels every reminder of this definition anyway.
        if (armed && !lane.blocked) enqueue(lane, armed).catch(() => {});
      };
      lane.closeCurrent = close;
      // Notifier.schedule resolves even when nothing was installed (permission denied,
      // web no-op), so a planned reminder is only 'synced' once availability is 'ready'.
      const syncReminder = async (run: Run, locale: Locale): Promise<RunSaveOutcome['reminder']> => {
        const planned = planSequentialReminder(
          run.flow, run.events, deps.now(), run.id, locale, definitionKey,
        );
        await deps.notifier.cancel(sequentialReminderIdsForRun(run.id));
        if (!planned) return 'synced';
        await deps.notifier.schedule([planned]);
        const availability = await deps.notifier.status();
        if (availability === 'ready') return 'synced';
        if (availability === 'denied' || availability === 'unsupported') return availability;
        return 'failed'; // Still undetermined: a retry asks again.
      };
      const realign = async (flow: Flow, locale: Locale): Promise<void> => {
        assertDefinitionKeyForFlow(definitionKey, flow.id);
        let saved: Run;
        try {
          saved = await loadRunForDefinition(deps.storage, flow, definitionKey);
        } catch {
          await deps.notifier.cancel(sequentialReminderIdsForRun(activeRunId(definitionKey)));
          return;
        }
        await syncReminder(saved, locale);
      };
      const submit = <T>(task: () => Promise<T>): Promise<T> => {
        if (closed || lane.blocked) return Promise.reject(new Error('runtime session is closed'));
        return enqueue(lane, task);
      };
      return {
        id: ++nextSessionId,
        definitionKey,
        isOpen: () => !closed && !lane.blocked,
        close,
        loadRun: (flow) => submit(() => loadRunForDefinition(deps.storage, flow, definitionKey)),
        saveRun: (run, locale) => submit(async () => {
          assertDefinitionKeyForFlow(definitionKey, run.flow.id);
          if (run.id !== activeRunId(definitionKey)) throw new Error('Run does not belong to session');
          let persisted = true;
          let persistError: unknown;
          try {
            await deps.storage.saveRun(run);
          } catch (error) {
            persisted = false;
            persistError = error;
          }
          let reminder: RunSaveOutcome['reminder'];
          try {
            reminder = await syncReminder(run, locale);
          } catch {
            reminder = 'failed';
          }
          if (!persisted) throw persistError;
          // Persisted and installed reminder now describe the same snapshot: an armed
          // close realignment would only re-cancel a correct reminder. Any reminder
          // that is not actually installed keeps it armed, as a second chance at close.
          if (reminder === 'synced') onClose = null;
          return { reminder };
        }),
        syncReminderToSaved: (flow, locale) => submit(() => realign(flow, locale)),
        realignReminderOnClose: (flow, locale) => {
          assertDefinitionKeyForFlow(definitionKey, flow.id);
          if (!closed) onClose = () => realign(flow, locale);
        },
        loadCheckIns: () => submit(() => deps.storage.loadCheckIns(definitionKey)),
        changeCheckIn: (change) => submit(() => deps.storage.changeCheckIn(definitionKey, change)),
      };
    },
    retire(definitionKey, cleanup) {
      const lane = laneFor(definitionKey);
      lane.blocked = true;
      const retirement = ++lane.retirement;
      lane.closeCurrent();
      return enqueue(lane, async () => {
        await cleanup();
        if (retirement === lane.retirement) lane.blocked = false;
      });
    },
  };
}
