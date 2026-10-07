// 顺序型运行状态、持久化与通知。
// 有事件的 Run 始终以 run.flow 快照为事实源；当前 catalog Flow 只用于未开始或 reset 后的新 Run。

import { useEffect, useState } from 'react';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant } from '../runtime/clock';
import { reduce, project, type RunState } from '../runtime/engine';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { planSequentialReminder } from '../notifications/plan';
import { sequentialReminderId } from '../notifications/notificationIdentity';
import { activeRunId, legacyActiveRunId, runForCurrentDefinition } from '../session/runPersistence';
import {
  startAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from '../session/actions';

export interface PersistentRun {
  ready: boolean;
  flow: Flow;
  state: RunState;
  start: () => void;
  complete: () => void;
  skip: () => void;
  pause: () => void;
  resume: () => void;
  back: () => void;
  reset: () => void;
}

export function usePersistentRun(
  flow: Flow,
  definitionKey: string,
  legacyFlowId: string | undefined,
  storage: Storage,
  notifier: Notifier,
  locale: Locale,
): PersistentRun {
  const runId = activeRunId(definitionKey);
  const [run, setRun] = useState<Run>(() => ({ id: runId, flow, events: [] }));
  const [now, setNow] = useState<Instant>(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);

    void (async () => {
      let saved = await storage.loadRun(runId);
      let legacyRunId: string | null = null;

      if (!saved && legacyFlowId) {
        legacyRunId = legacyActiveRunId(legacyFlowId);
        saved = await storage.loadRun(legacyRunId);
      }
      if (!alive) return;

      const next = runForCurrentDefinition(saved, flow, runId);
      setRun(next);
      setLoaded(true);

      if (legacyRunId && saved) {
        storage.saveRun(next).then(() => storage.deleteRun(legacyRunId as string)).catch(() => {});
      }
    })().catch(() => {
      if (!alive) return;
      setRun({ id: runId, flow, events: [] });
      setLoaded(true);
    });

    return () => {
      alive = false;
    };
  }, [flow, legacyFlowId, runId, storage]);

  const runtimeFlow = run.flow;
  const state = project(runtimeFlow, run.events, now);

  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (!loaded) return;
    storage.saveRun(run).catch(() => {});
    const reminder = planSequentialReminder(
      runtimeFlow,
      run.events,
      Date.now(),
      run.id,
      locale,
      definitionKey,
    );
    notifier
      .cancel([run.id, sequentialReminderId(run.id)])
      .then(() => (reminder ? notifier.schedule([reminder]) : undefined))
      .catch(() => {});
  }, [definitionKey, loaded, locale, notifier, run, runtimeFlow, storage]);

  const apply = (event: RunEvent | null): void => {
    if (!loaded || !event) return;
    setRun((current) => reduce(current, event));
    setNow(Date.now());
  };
  const reset = (): void => {
    if (!loaded) return;
    setRun({ id: runId, flow, events: [] });
    setNow(Date.now());
  };

  return {
    ready: loaded,
    flow: runtimeFlow,
    state,
    start: () => apply(startAction(Date.now())),
    complete: () => apply(completeCurrentAction(runtimeFlow, run.events, Date.now())),
    skip: () => apply(skipCurrentAction(runtimeFlow, run.events, Date.now())),
    pause: () => apply(pauseAction(runtimeFlow, run.events, Date.now())),
    resume: () => apply(resumeAction(runtimeFlow, run.events, Date.now())),
    back: () => apply(backAction(runtimeFlow, run.events, Date.now())),
    reset,
  };
}
