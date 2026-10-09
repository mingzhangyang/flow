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
import { sameJsonValue } from '../domain/jsonValue';

export interface RunSaveOutcome {
  /**
   * The sequential reminder for the snapshot that was just persisted:
   * - synced: installed (or none is needed for this state).
   * - failed: the platform call threw; a retry re-syncs.
   * - denied / unsupported: nothing installed (no permission / no scheduled notifications
   *   on this platform). Not an error to retry, but the UI must say so (E6).
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
   * Durably writes the full Run snapshot, THEN syncs the sequential reminder to it.
   * Invariant (architecture.md, Notification): the installed reminder is always derived
   * from the persisted Run, never from unsaved screen state. A rejected write is checked
   * by reading back what is stored: the exact snapshot counts as confirmed; otherwise the
   * reminder is realigned to whatever is stored and the call rejects. A confirmed write
   * resolves with whether its reminder is actually installed.
   */
  saveRun(run: Run, locale: Locale): Promise<RunSaveOutcome>;
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
  notifier: Pick<Notifier, 'cancel' | 'schedule'>;
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
      const close = (): void => { closed = true; };
      lane.closeCurrent = close;
      /** Installs exactly what `stored` plans; null (nothing stored / unreadable) plans nothing. */
      const syncReminder = async (
        runId: string, stored: Run | null, locale: Locale,
      ): Promise<RunSaveOutcome['reminder']> => {
        await deps.notifier.cancel(sequentialReminderIdsForRun(runId));
        if (!stored) return 'synced';
        const planned = planSequentialReminder(
          stored.flow, stored.events, deps.now(), stored.id, locale, definitionKey,
        );
        if (!planned) return 'synced';
        const delivery = await deps.notifier.schedule([planned]);
        return delivery === 'scheduled' ? 'synced' : delivery;
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
          try {
            await deps.storage.saveRun(run);
          } catch (writeError) {
            // A rejected write may still have landed. Reminders follow what is actually
            // stored, so read it back: the exact snapshot -> confirmed after all; anything
            // else (older Run, nothing, unreadable) -> realign to it and reject.
            let stored: Run | null = null;
            let confirmed = false;
            try {
              stored = await deps.storage.loadRun(run.id);
              confirmed = stored !== null && sameJsonValue(stored, run);
            } catch {
              stored = null; // Unreadable: reopening fails closed, so nothing may ring for it.
            }
            if (!confirmed) {
              // Best effort: the save is reported failed either way, and Retry re-syncs.
              await syncReminder(run.id, stored, locale).catch(() => {});
              throw writeError;
            }
          }
          try {
            return { reminder: await syncReminder(run.id, run, locale) };
          } catch {
            return { reminder: 'failed' };
          }
        }),
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
