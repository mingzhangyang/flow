// Runner：顺序型 Flow 的运行界面。宪章 C4「打开即可开始」、C5 暂停/恢复/跳过/回退。
// 沉浸式深墨绿场景：进入运行即切换到深色，环 + 珠（应用图标的形状语言）承载进度，
// 极细大字倒计时是画面的主角。运行状态、持久化（C6）与通知（C5）收在 usePersistentRun。

import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow } from '../domain/types';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { usePersistentRun } from './usePersistentRun';
import { Timeline } from './Timeline';
import { ProgressRing } from './ProgressRing';
import { fmtDuration } from './format';
import { useI18n } from './i18n';
import { dark, spacing, radius, type, mono } from './theme';

const RING = 268;

export function RunnerScreen(props: {
  flow: Flow;
  storage: Storage;
  notifier: Notifier;
  onExit: () => void;
}) {
  const { flow } = props;
  const { locale, t } = useI18n();
  const run = usePersistentRun(flow, props.storage, props.notifier, locale);
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onExit} hitSlop={12}>
          <Text style={styles.back}>{t.back}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{flow.title}</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stage}>
          <Text style={styles.kicker}>
            {state.status === 'completed'
              ? t.runDone
              : state.status === 'idle'
                ? t.runTotalSteps(flow.nodes.length)
                : t.runStepOf(state.currentIndex + 1, flow.nodes.length, paused)}
          </Text>

          <ProgressRing size={RING} progress={state.status === 'completed' ? 1 : progress} beadColor={beadColor}>
            {state.status === 'completed' ? (
              <Text style={styles.doneMark}>✓</Text>
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
        </View>

        {state.status === 'completed' ? (
          <Pressable style={styles.primary} onPress={run.reset}>
            <Text style={styles.primaryText}>{t.runRestart}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={state.status === 'idle' ? run.start : run.complete}>
            <Text style={styles.primaryText}>
              {state.status === 'idle' ? t.runStart : node?.kind === 'gate' ? t.runConfirm : t.runCompleteStep}
            </Text>
          </Pressable>
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
    <Pressable
      style={[styles.ghost, props.disabled && styles.ghostDisabled]}
      onPress={props.disabled ? undefined : props.onPress}
      hitSlop={8}
    >
      <Text style={[styles.ghostText, props.disabled && styles.ghostTextDisabled]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: dark.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: dark.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: type.emphasis - 1, fontWeight: '600', color: dark.textMuted },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
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
  stepLabel: { fontSize: type.title, fontWeight: '700', color: dark.text, textAlign: 'center', marginTop: spacing.md },
  rationale: { fontSize: type.body, color: dark.textMuted, textAlign: 'center', maxWidth: 300 },
  timeUp: { fontSize: type.body - 1, color: dark.accent },
  primary: {
    backgroundColor: dark.text, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center',
  },
  primaryText: { color: dark.bg, fontSize: type.emphasis + 1, fontWeight: '700' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.xs },
  ghost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  ghostDisabled: { opacity: 0.35 },
  ghostText: { fontSize: type.body, color: dark.textMuted, fontWeight: '600' },
  ghostTextDisabled: { color: dark.faint },
  timelineCard: {
    backgroundColor: dark.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: dark.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
});
