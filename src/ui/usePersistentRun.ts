// 顺序型运行状态、持久化与通知。
// 有事件的 Run 始终以 run.flow 快照为事实源；当前 catalog Flow 只用于未开始或 reset 后的新 Run。

import { useEffect, useState } from 'react';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant } from '../runtime/clock';
import { reduce, project, type RunState } from '../runtime/engine';
import { type RuntimeSession } from '../session/definitionRuntime';
import { activeRunId } from '../session/runPersistence';
import {
  startAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from '../session/actions';

export interface PersistentRun {
  status: 'loading' | 'ready' | 'error';
  retry: () => void;
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

  useEffect(() => {
    if (status !== 'ready') return;
    session.saveRun(run, locale).catch(() => {});
  }, [locale, run, session, status]);

  const apply = (event: RunEvent | null): void => {
    if (status !== 'ready' || !event) return;
    setRun((current) => reduce(current, event));
    setNow(Date.now());
  };
  const reset = (): void => {
    if (status !== 'ready') return;
    setRun({ id: runId, flow, events: [] });
    setNow(Date.now());
  };

  return {
    status,
    retry: () => setLoadAttempt((attempt) => attempt + 1),
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
