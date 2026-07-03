// 把运行状态、持久化与通知编织在一起的 Hook。
// - 打开时从 Storage 载入该 flow 的进行中 run（C6：掉线可恢复）。
// - 每次事件后保存，并重排“下一步计时”提醒（C5）。
// 时钟仍停在此处（Date.now()），向下全是纯函数。

import { useEffect, useState } from 'react';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { type Instant } from '../runtime/clock';
import { reduce, project, type RunState } from '../runtime/engine';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { planSequentialReminder } from '../notifications/plan';
import {
  startAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from '../session/actions';

const runIdFor = (flow: Flow): string => `active-${flow.id}`;

export interface PersistentRun {
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
  storage: Storage,
  notifier: Notifier,
  locale: Locale,
): PersistentRun {
  const [run, setRun] = useState<Run>(() => ({ id: runIdFor(flow), flow, events: [] }));
  const [now, setNow] = useState<Instant>(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  // 恢复进行中的 run
  useEffect(() => {
    let alive = true;
    storage
      .loadRun(runIdFor(flow))
      .then((saved) => {
        if (!alive) return;
        if (saved && saved.flow.id === flow.id) setRun(saved);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [flow, storage]);

  const state = project(flow, run.events, now);

  // 计时进行时按秒刷新
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  // 保存 + 重排提醒
  useEffect(() => {
    if (!loaded) return;
    storage.saveRun(run).catch(() => {});
    const reminder = planSequentialReminder(flow, run.events, Date.now(), run.id, locale);
    notifier
      .cancel([run.id])
      .then(() => (reminder ? notifier.schedule([reminder]) : undefined))
      .catch(() => {});
  }, [run, loaded]);

  const apply = (event: RunEvent | null): void => {
    if (!event) return;
    setRun((r) => reduce(r, event));
    setNow(Date.now());
  };
  const reset = (): void => {
    setRun({ id: runIdFor(flow), flow, events: [] });
    setNow(Date.now());
  };

  return {
    state,
    start: () => apply(startAction(Date.now())),
    complete: () => apply(completeCurrentAction(flow, run.events, Date.now())),
    skip: () => apply(skipCurrentAction(flow, run.events, Date.now())),
    pause: () => apply(pauseAction(flow, run.events, Date.now())),
    resume: () => apply(resumeAction(flow, run.events, Date.now())),
    back: () => apply(backAction(flow, run.events, Date.now())),
    reset,
  };
}

