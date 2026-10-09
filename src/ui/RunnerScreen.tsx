// Runner：顺序型 Flow 的运行界面。宪章 C4「打开即可开始」、C5 暂停/恢复/跳过/回退。
// 沉浸式深墨绿场景：进入运行即切换到深色，环 + 珠（应用图标的形状语言）承载进度，
// 极细大字倒计时是画面的主角。运行状态、持久化（C6）与通知（C5）收在 usePersistentRun。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, AppState, Linking } from 'react-native';
import { type Flow } from '../domain/types';
import { type RuntimeSession } from '../session/definitionRuntime';
import { usePersistentRun } from './usePersistentRun';
import { createLeaveGuard, shareInFlight } from './leaveGuard';
import { promptLeaveConfirmation } from './confirmLeave';
import { Timeline } from './Timeline';
import { ProgressRing } from './ProgressRing';
import { fmtDuration } from './format';
import { useI18n } from './i18n';
import { dark, spacing, radius, type, mono } from './theme';
import { HeaderBackButton, HeaderSideSpacer, mobileControlSize, mobileHitTarget } from './mobileControls';
import { MotionPressable } from './MotionPressable';
import { MotionReveal } from './MotionReveal';

const RING = 268;
/** Back waits this long for an in-flight save before asking instead of hanging. */
const LEAVE_SAVE_WAIT_MS = 1500;

export function RunnerScreen(props: {
  flow: Flow;
  session: RuntimeSession;
  onExit: () => void;
  onRegisterExit?: (request: (() => Promise<boolean>) | null) => void;
}) {
  const { locale, t } = useI18n();
  const run = usePersistentRun(
    props.flow,
    props.session,
    locale,
  );
  const flow = run.flow;
  const state = run.state;
  const node = state.currentIndex < flow.nodes.length ? flow.nodes[state.currentIndex] : null;
  const running = state.status === 'running' || state.status === 'paused';
  const paused = state.status === 'paused';

  const totalSec = flow.nodes.reduce((s, n) => s + (n.kind === 'timed' ? n.durationSec : 0), 0);
  const timed = node?.kind === 'timed';
  const progress =
    timed && node.durationSec > 0 ? (node.durationSec - state.remainingSec) / node.durationSec : 0;
  const closing = timed && state.remainingSec > 0 && state.remainingSec <= 10; // 收尾时刻转暖
  const beadColor = paused ? dark.faint : closing ? dark.warm : dark.accent;
  const progressMotionKey = `${state.status}:${state.currentIndex}:${node?.id ?? 'none'}`;
  const stepMotionKey = `${state.status}:${state.currentIndex}:${node?.id ?? 'none'}`;

  // All exits (header, Android Back, notification replacement) ask this one
  // screen-owned guard. An in-flight save gets a bounded wait; a failed or still
  // unconfirmed one asks, and leaving anyway realigns the reminder (C5/C6).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const latest = useRef(run);
  latest.current = run;
  const unsaved = (): boolean => {
    // Read the tracker, not the rendered status: it may lag the settled write.
    const status = latest.current.currentSave().status;
    return status === 'failed' || status === 'saving';
  };
  const confirmLeave = useRef<(done: (approved: boolean) => void) => void>(() => {});
  confirmLeave.current = (done) => promptLeaveConfirmation({
    title: t.runUnsavedTitle,
    message: latest.current.currentSave().status === 'saving' ? t.runSavePendingExit : t.runUnsavedExit,
    stayLabel: t.cancel,
    leaveLabel: t.runLeaveAnyway,
  }, done);
  const leaveGuard = useMemo(() => createLeaveGuard({
    disposition: () => unsaved() ? 'confirm' : 'allow',
    prompt: (done) => confirmLeave.current(done),
  }), []);
  // Concurrent exits (header + notification + Back) share ONE wait-and-confirm attempt,
  // so a later request can never open a second, stale prompt after the first resolves.
  const requestLeave = useMemo(() => shareInFlight(async (): Promise<boolean> => {
    await latest.current.saveSettledWithin(LEAVE_SAVE_WAIT_MS);
    if (!alive.current) return false; // This Runner is gone; nothing left to authorize.
    const approved = await leaveGuard.request();
    if (!approved || !alive.current) return false;
    // Re-read AFTER the prompt: a save may have been confirmed while the dialog was open,
    // and a redundant realignment would only cancel/reschedule a correct reminder.
    // Armed only: realignment is queued if and when App actually closes this session.
    if (unsaved()) latest.current.abandonUnsaved();
    return true;
  }), [leaveGuard]);
  const requestExit = (): void => {
    void requestLeave().then((approved) => {
      if (approved && alive.current && props.session.isOpen()) props.onExit();
    });
  };
  useLayoutEffect(() => {
    props.onRegisterExit?.(requestLeave);
    return () => props.onRegisterExit?.(null);
  }, [requestLeave, props.onRegisterExit]);
  useEffect(() => () => leaveGuard.cancel(), [leaveGuard]);

  // Back from system settings: re-sync so a newly granted permission clears the warning.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && latest.current.currentSave().reminderIssue === 'denied') {
        latest.current.retrySave();
      }
    });
    return () => sub.remove();
  }, []);

  if (run.status === 'loading') return <View style={styles.screen} />;
  if (run.status === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <HeaderBackButton accessibilityLabel={t.back} color={dark.accent} onPress={requestExit} />
          <Text style={styles.title} numberOfLines={1}>{props.flow.title}</Text>
          <HeaderSideSpacer />
        </View>
        <View style={styles.loadError}>
          <Text style={styles.loadErrorText}>{t.runStorageUnavailable}</Text>
          <MotionPressable style={styles.retry} onPress={run.retry}>
            <Text style={styles.retryText}>{t.retry}</Text>
          </MotionPressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <HeaderBackButton accessibilityLabel={t.back} color={dark.accent} onPress={requestExit} />
        <Text style={styles.title} numberOfLines={1}>{flow.title}</Text>
        <HeaderSideSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {run.save.status === 'failed' || run.save.reminderIssue === 'failed' ? (
          <View style={styles.saveIssue} accessibilityRole="alert">
            <Text style={styles.saveIssueText}>
              {run.save.status === 'failed' ? t.runSaveFailed : t.runReminderSyncFailed}
            </Text>
            <MotionPressable style={styles.retry} onPress={run.retrySave}>
              <Text style={styles.retryText}>{t.retry}</Text>
            </MotionPressable>
          </View>
        ) : run.save.reminderIssue === 'denied' ? (
          // Same honesty contract as the Schedule screen (E6): a timer that cannot ring says so.
          <MotionPressable accessibilityRole="button" accessibilityLabel={t.scheduleNotifSettings}
            style={styles.saveIssue} onPress={() => { Linking.openSettings().catch(() => {}); }}>
            <Text style={styles.saveIssueText}>{t.scheduleNotifDenied}</Text>
            <Text style={styles.retryText}>{t.scheduleNotifSettings}</Text>
          </MotionPressable>
        ) : run.save.reminderIssue === 'unsupported' ? (
          <Text style={styles.reminderNote}>{t.scheduleNotifWeb}</Text>
        ) : null}
        <View style={styles.stage}>
          <Text style={styles.kicker}>
            {state.status === 'completed'
              ? t.runDone
              : state.status === 'idle'
                ? t.runTotalSteps(flow.nodes.length)
                : t.runStepOf(state.currentIndex + 1, flow.nodes.length, paused)}
          </Text>

          <ProgressRing
            size={RING}
            progress={state.status === 'completed' ? 1 : progress}
            motionKey={progressMotionKey}
            beadColor={beadColor}
          >
            {state.status === 'completed' ? (
              <MotionReveal motion="confirmation" replayKey="completed">
                <Text style={styles.doneMark}>✓</Text>
              </MotionReveal>
            ) : state.status === 'idle' ? (
              totalSec > 0 ? (
                <Text style={styles.clock}>{fmtDuration(totalSec)}</Text>
              ) : (
                <Text style={styles.centerHint}>{t.runStartAnytime}</Text>
              )
            ) : timed ? (
              <Text style={[styles.clock, paused && styles.clockPaused, closing && styles.clockClosing]}>
                {fmtDuration(state.remainingSec)}
              </Text>
            ) : (
              <Text style={styles.centerHint}>{node?.kind === 'gate' ? t.runGateHint : t.runInstantHint}</Text>
            )}
          </ProgressRing>

          <MotionReveal motion="state" replayKey={stepMotionKey} animateOnMount={false} style={styles.stepCopy}>
            {state.status === 'idle' ? (
              <>
                <Text style={styles.stepLabel}>{flow.title}</Text>
                {flow.description ? <Text style={styles.rationale}>{flow.description}</Text> : null}
              </>
            ) : state.status === 'completed' ? (
              <Text style={styles.stepLabel}>{t.runFlowFinished}</Text>
            ) : node ? (
              <>
                <Text style={styles.stepLabel}>{node.label}</Text>
                {node.rationale ? <Text style={styles.rationale}>{node.rationale}</Text> : null}
                {timed && state.remainingSec === 0 ? (
                  <Text style={styles.timeUp}>{t.runTimeUp}</Text>
                ) : null}
              </>
            ) : null}
          </MotionReveal>
        </View>

        {state.status === 'completed' ? (
          <MotionPressable accessibilityRole="button" style={[mobileHitTarget.standard, styles.primary]} onPress={run.reset}>
            <Text style={styles.primaryText}>{t.runRestart}</Text>
          </MotionPressable>
        ) : (
          <MotionPressable accessibilityRole="button" style={[mobileHitTarget.standard, styles.primary]} onPress={state.status === 'idle' ? run.start : run.complete}>
            <Text style={styles.primaryText}>
              {state.status === 'idle' ? t.runStart : node?.kind === 'gate' ? t.runConfirm : t.runCompleteStep}
            </Text>
          </MotionPressable>
        )}

        {running ? (
          <View style={styles.controls}>
            <GhostButton label={t.runPrev} disabled={state.currentIndex === 0} onPress={run.back} />
            <GhostButton label={paused ? t.runResume : t.runPause} onPress={paused ? run.resume : run.pause} />
            <GhostButton label={t.runSkip} onPress={run.skip} />
          </View>
        ) : null}

        <View style={styles.timelineCard}>
          <Timeline nodes={flow.nodes} currentIndex={state.currentIndex} status={state.status} tone="dark" />
        </View>
      </ScrollView>
    </View>
  );
}

function GhostButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled ?? false }}
      disabled={props.disabled}
      style={[styles.ghost, props.disabled && styles.ghostDisabled]}
      onPress={props.onPress}
    >
      <Text style={[styles.ghostText, props.disabled && styles.ghostTextDisabled]}>{props.label}</Text>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: dark.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  title: {
    flex: 1, minWidth: 0, textAlign: 'center',
    fontSize: type.emphasis - 1, fontWeight: '600', color: dark.textMuted,
  },
  content: { flexGrow: 1, padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  loadError: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  loadErrorText: { color: dark.textMuted, fontSize: type.body, textAlign: 'center' },
  retry: {
    minHeight: mobileControlSize.compact, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: dark.accent,
    backgroundColor: dark.accentSoft,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  retryText: { color: dark.accent, fontSize: type.body, fontWeight: '600' },
  saveIssue: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: dark.warm,
    backgroundColor: dark.surface, padding: spacing.md,
  },
  reminderNote: { color: dark.textMuted, fontSize: type.caption + 1, lineHeight: 18, textAlign: 'center' },
  saveIssueText: { flex: 1, minWidth: 0, flexBasis: 200, color: dark.warm, fontSize: type.body, lineHeight: 21 },
  stage: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  kicker: { fontSize: type.caption + 1, color: dark.textMuted, letterSpacing: 2, marginBottom: spacing.md },
  clock: {
    fontSize: type.clock, fontFamily: mono.thin, color: dark.text,
    fontVariant: ['tabular-nums'], letterSpacing: 2,
  },
  clockPaused: { color: dark.textMuted },
  clockClosing: { color: dark.warm },
  centerHint: { fontSize: type.emphasis, color: dark.textMuted },
  doneMark: { fontSize: 56, fontWeight: '200', color: dark.accent },
  stepCopy: { alignItems: 'center', minHeight: 72 },
  stepLabel: { fontSize: type.title, fontWeight: '700', color: dark.text, textAlign: 'center', marginTop: spacing.md },
  rationale: { fontSize: type.body, color: dark.textMuted, textAlign: 'center', maxWidth: 300 },
  timeUp: { fontSize: type.body - 1, color: dark.accent },
  primary: {
    backgroundColor: dark.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center',
  },
  primaryText: { color: dark.bg, fontSize: type.emphasis + 1, fontWeight: '700' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  ghost: {
    minHeight: mobileControlSize.compact, minWidth: mobileControlSize.compact,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
  },
  ghostDisabled: { opacity: 0.35 },
  ghostText: { fontSize: type.body, color: dark.textMuted, fontWeight: '600' },
  ghostTextDisabled: { color: dark.faint },
  timelineCard: {
    backgroundColor: dark.surfaceRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: dark.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
});
