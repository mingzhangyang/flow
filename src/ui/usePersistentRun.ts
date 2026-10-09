// 顺序型运行状态、持久化与通知。
// 有事件的 Run 始终以 run.flow 快照为事实源；当前 catalog Flow 只用于未开始或 reset 后的新 Run。

import { useEffect, useMemo, useRef, useState } from 'react';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant } from '../runtime/clock';
import { project, type RunState } from '../runtime/engine';
import { type RuntimeSession } from '../session/definitionRuntime';
import { activeRunId } from '../session/runPersistence';
import {
  startIfIdleAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from '../session/actions';
import { INITIAL_RUN_SAVE, type RunSaveState } from './runSaveTracker';
import { createRunController } from './runController';

export interface PersistentRun {
  status: 'loading' | 'ready' | 'error';
  retry: () => void;
  /** Confirmed-write status of the latest Run snapshot; never optimistic. */
  save: RunSaveState;
  /** Re-submit the current Run snapshot after a failed save. */
  retrySave: () => void;
  /** Leave guard input, read from the controller, ahead of React's next render. */
  needsLeaveConfirmation: () => boolean;
  /** Waits for the latest snapshot write, at most `ms`; 'saving' means still unconfirmed. */
  saveSettledWithin: (ms: number) => Promise<RunSaveState>;
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
  session: RuntimeSession,
  locale: Locale,
): PersistentRun {
  const runId = activeRunId(session.definitionKey);
  const [run, setRun] = useState<Run>(() => ({ id: runId, flow, events: [] }));
  const [save, setSave] = useState<RunSaveState>(INITIAL_RUN_SAVE);
  const [now, setNow] = useState<Instant>(() => Date.now());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  // The controller owns the visible Run and its save status (runController.ts);
  // React state only mirrors it for rendering.
  const controller = useMemo(() => createRunController(run, {
    save: (snapshot) => session.saveRun(snapshot, localeRef.current),
    onRun: (next) => { setRun(next); setNow(Date.now()); },
    onSave: setSave,
  }), [session]);
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');

    void (async () => {
      const loaded = await session.loadRun(flow);
      if (!alive) return;

      controller.install(loaded);
      setStatus('ready');
    })().catch(() => {
      if (!alive) return;
      // Fail closed: a transient read error must never be reinterpreted as "no saved run",
      // otherwise a save could overwrite a real in-progress Run with an empty one.
      setStatus('error');
    });

    return () => {
      alive = false;
    };
  }, [controller, flow, loadAttempt, session]);

  // Reminder copy follows the locale: re-save (and so re-sync) on change, not on mount.
  const renderedLocale = useRef(locale);
  useEffect(() => {
    if (renderedLocale.current === locale) return;
    renderedLocale.current = locale;
    controller.resave();
  }, [controller, locale]);

  const runtimeFlow = run.flow;
  const state = project(runtimeFlow, run.events, now);

  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  // Every handler is bound to THIS render's Run: a tap from an older render is ignored.
  const seen = run;
  const act = (decide: (current: Run) => RunEvent | null) => (): void => {
    controller.dispatch(seen, decide);
  };

  return {
    status,
    retry: () => setLoadAttempt((attempt) => attempt + 1),
    save,
    retrySave: () => controller.resave(),
    needsLeaveConfirmation: () => controller.needsLeaveConfirmation(),
    saveSettledWithin: (ms) => controller.settledWithin(
      new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    ),
    flow: runtimeFlow,
    state,
    start: act((r) => startIfIdleAction(r.events, Date.now())),
    complete: act((r) => completeCurrentAction(r.flow, r.events, Date.now())),
    skip: act((r) => skipCurrentAction(r.flow, r.events, Date.now())),
    pause: act((r) => pauseAction(r.flow, r.events, Date.now())),
    resume: act((r) => resumeAction(r.flow, r.events, Date.now())),
    back: act((r) => backAction(r.flow, r.events, Date.now())),
    reset: () => { controller.replace(seen, { id: runId, flow, events: [] }); },
  };
}
