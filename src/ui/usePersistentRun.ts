// 顺序型运行状态、持久化与通知。
// 有事件的 Run 始终以 run.flow 快照为事实源；当前 catalog Flow 只用于未开始或 reset 后的新 Run。

import { useEffect, useMemo, useRef, useState } from 'react';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant } from '../runtime/clock';
import { reduce, project, type RunState } from '../runtime/engine';
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
import { createRunSaveTracker, INITIAL_RUN_SAVE, type RunSaveState } from './runSaveTracker';

export interface PersistentRun {
  status: 'loading' | 'ready' | 'error';
  retry: () => void;
  /** Confirmed-write status of the latest Run snapshot; never optimistic. */
  save: RunSaveState;
  /** Re-submit the current Run snapshot after a failed save. */
  retrySave: () => void;
  /** Authoritative save status now, ahead of React's next render (for leave guards). */
  currentSave: () => RunSaveState;
  /** Waits for the latest snapshot write, at most `ms`; 'saving' means still unconfirmed. */
  saveSettledWithin: (ms: number) => Promise<RunSaveState>;
  /** Approved leave with an unconfirmed snapshot: realign the reminder when the session closes. */
  abandonUnsaved: () => void;
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
  const [run, setRunState] = useState<Run>(() => ({ id: runId, flow, events: [] }));
  // Synchronous source of truth for mutations: a second tap before React re-renders
  // must build on the first, and a save must be submitted in the same handler.
  const runRef = useRef(run);
  const setRun = (next: Run): void => {
    runRef.current = next;
    setRunState(next);
  };
  const [now, setNow] = useState<Instant>(() => Date.now());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus('loading');

    void (async () => {
      const loaded = await session.loadRun(flow);
      if (!alive) return;

      setRun(loaded);
      setStatus('ready');
    })().catch(() => {
      if (!alive) return;
      // Fail closed: a transient read error must never be reinterpreted as "no saved run",
      // otherwise the save effect could overwrite a real in-progress Run with an empty one.
      setStatus('error');
    });

    return () => {
      alive = false;
    };
  }, [flow, loadAttempt, session]);

  const runtimeFlow = run.flow;
  const state = project(runtimeFlow, run.events, now);

  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  const [save, setSave] = useState<RunSaveState>(INITIAL_RUN_SAVE);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saves = useMemo(() => createRunSaveTracker(setSave), [session]);
  useEffect(() => () => saves.dispose(), [saves]);

  // Each save carries the whole event log, so retrying the current snapshot also
  // covers every earlier failed write. Failure is reported, never swallowed (C6/E2).
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const submitSave = (snapshot: Run): void => {
    saves.submit(() => session.saveRun(snapshot, localeRef.current));
  };
  // Loaded/ready, locale change (reminder copy) and explicit retry re-save the current
  // snapshot. User mutations submit in their own handler, never from a later effect.
  useEffect(() => {
    if (status !== 'ready') return;
    submitSave(runRef.current);
  }, [locale, saveAttempt, saves, session, status]);

  // A mutation is marked 'saving' in the same handler that changes the Run, so a leave
  // guard can never see the previous snapshot as saved and authorize an unsubmitted Run.
  const commit = (next: Run): void => {
    setRun(next);
    setNow(Date.now());
    submitSave(next);
  };
  const apply = (decide: (current: Run) => RunEvent | null): void => {
    if (status !== 'ready') return;
    const event = decide(runRef.current);
    if (!event) return;
    commit(reduce(runRef.current, event));
  };
  const reset = (): void => {
    if (status !== 'ready') return;
    commit({ id: runId, flow, events: [] });
  };

  return {
    status,
    retry: () => setLoadAttempt((attempt) => attempt + 1),
    save,
    retrySave: () => { if (status === 'ready') setSaveAttempt((attempt) => attempt + 1); },
    currentSave: () => saves.current(),
    saveSettledWithin: (ms) => saves.settledWithin(
      new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    ),
    abandonUnsaved: () => {
      // Armed only: the realignment is queued when App actually closes this session.
      // If navigation is abandoned after approval, this Runner and its reminder stay as is.
      session.realignReminderOnClose(flow, localeRef.current);
    },
    flow: runtimeFlow,
    state,
    start: () => apply((r) => startIfIdleAction(r.events, Date.now())),
    complete: () => apply((r) => completeCurrentAction(r.flow, r.events, Date.now())),
    skip: () => apply((r) => skipCurrentAction(r.flow, r.events, Date.now())),
    pause: () => apply((r) => pauseAction(r.flow, r.events, Date.now())),
    resume: () => apply((r) => resumeAction(r.flow, r.events, Date.now())),
    back: () => apply((r) => backAction(r.flow, r.events, Date.now())),
    reset,
  };
}
