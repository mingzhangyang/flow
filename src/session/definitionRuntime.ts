// Definition-scoped runtime effects have one queue and revocable screen sessions.
// Leaving a screen stops new submissions but drains accepted work. Deletion fences all old
// sessions, waits for that work (including native scheduling), then performs journal cleanup.

import { type Flow, type Run } from '../domain/types';
import { assertDefinitionKey, assertDefinitionKeyForFlow } from '../domain/definitionIdentity';
import { type Locale } from '../i18n/locale';
import { type CheckIn } from '../runtime/adherence';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { planSequentialReminder } from '../notifications/plan';
import { sequentialReminderIdsForRun } from '../notifications/notificationIdentity';
import { activeRunId, loadRunForDefinition } from './runPersistence';

export interface RuntimeSession {
  readonly id: number;
  readonly definitionKey: string;
  isOpen(): boolean;
  close(): void;
  loadRun(flow: Flow): Promise<Run>;
  saveRun(run: Run, locale: Locale): Promise<void>;
  loadCheckIns(): Promise<CheckIn[]>;
  saveCheckIns(log: CheckIn[]): Promise<void>;
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
  storage: Pick<Storage, 'loadRun' | 'saveRun' | 'loadCheckIns' | 'saveCheckIns'>;
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
          await deps.storage.saveRun(run);
          const reminder = planSequentialReminder(
            run.flow, run.events, deps.now(), run.id, locale, definitionKey,
          );
          await deps.notifier.cancel(sequentialReminderIdsForRun(run.id));
          if (reminder) await deps.notifier.schedule([reminder]);
        }),
        loadCheckIns: () => submit(() => deps.storage.loadCheckIns(definitionKey)),
        saveCheckIns: (log) => submit(() => deps.storage.saveCheckIns(definitionKey, log)),
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
