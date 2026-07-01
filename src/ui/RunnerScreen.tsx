// Runner：顺序型 Flow 的运行界面。宪章 C4「打开即可开始」、C5 暂停/恢复/跳过/回退。
// 时钟停在这里（Date.now()），向下全是纯函数（E3）。UI 只读 project 的状态、派发事件。

import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow, type Run, type RunEvent } from '../domain/types';
import { type Instant } from '../runtime/clock';
import { reduce, project } from '../runtime/engine';
import {
  startAction,
  completeCurrentAction,
  skipCurrentAction,
  pauseAction,
  resumeAction,
  backAction,
} from '../app/actions';
import { Timeline } from './Timeline';
import { fmtDuration } from './format';
import { colors, spacing, radius } from './theme';

const newRunId = (): string => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function RunnerScreen(props: { flow: Flow; onExit: () => void }) {
  const { flow } = props;
  const [run, setRun] = useState<Run>(() => ({ id: newRunId(), flow, events: [] }));
  const [now, setNow] = useState<Instant>(() => Date.now());
  const state = project(flow, run.events, now);

  // 仅在计时进行时按秒刷新——暂停/等待时不空转（E2 的精神：状态可由日志推导）。
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  const apply = (event: RunEvent | null): void => {
    if (!event) return;
    setRun((r) => reduce(r, event));
    setNow(Date.now());
  };
  const reset = (): void => {
    setRun({ id: newRunId(), flow, events: [] });
    setNow(Date.now());
  };

  const node = state.currentIndex < flow.nodes.length ? flow.nodes[state.currentIndex] : null;
  const running = state.status === 'running' || state.status === 'paused';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onExit} hitSlop={12}>
          <Text style={styles.back}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{flow.title}</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stage}>
          {state.status === 'completed' ? (
            <>
              <Text style={styles.doneMark}>✓</Text>
              <Text style={styles.stageTitle}>已完成</Text>
              <Text style={styles.stageHint}>这条 flow 走完了。</Text>
            </>
          ) : state.status === 'idle' ? (
            <>
              <Text style={styles.stageKicker}>共 {flow.nodes.length} 步</Text>
              <Text style={styles.stageTitle}>{flow.title}</Text>
              {flow.description ? <Text style={styles.stageHint}>{flow.description}</Text> : null}
            </>
          ) : node ? (
            <>
              <Text style={styles.stageKicker}>
                第 {state.currentIndex + 1} / {flow.nodes.length} 步{state.status === 'paused' ? ' · 已暂停' : ''}
              </Text>
              <Text style={styles.stageTitle}>{node.label}</Text>
              {node.rationale ? <Text style={styles.stageHint}>{node.rationale}</Text> : null}
              {node.kind === 'timed' ? (
                <Text style={[styles.clock, state.remainingSec === 0 && styles.clockDone]}>
                  {fmtDuration(state.remainingSec)}
                </Text>
              ) : (
                <Text style={styles.badge}>{node.kind === 'gate' ? '完成后点击确认' : '点击完成进入下一步'}</Text>
              )}
              {node.kind === 'timed' && state.remainingSec === 0 ? (
                <Text style={styles.timeUp}>计时完成，可进入下一步</Text>
              ) : null}
            </>
          ) : null}
        </View>

        {state.status === 'completed' ? (
          <Pressable style={styles.primary} onPress={reset}>
            <Text style={styles.primaryText}>重新开始</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.primary}
            onPress={() =>
              apply(
                state.status === 'idle'
                  ? startAction(Date.now())
                  : completeCurrentAction(flow, run.events, Date.now()),
              )
            }
          >
            <Text style={styles.primaryText}>
              {state.status === 'idle' ? '开始' : node?.kind === 'gate' ? '确认' : '完成本步'}
            </Text>
          </Pressable>
        )}

        {running ? (
          <View style={styles.controls}>
            <SecondaryButton
              label="上一步"
              disabled={state.currentIndex === 0}
              onPress={() => apply(backAction(flow, run.events, Date.now()))}
            />
            <SecondaryButton
              label={state.status === 'paused' ? '恢复' : '暂停'}
              onPress={() =>
                apply(
                  state.status === 'paused'
                    ? resumeAction(flow, run.events, Date.now())
                    : pauseAction(flow, run.events, Date.now()),
                )
              }
            />
            <SecondaryButton label="跳过" onPress={() => apply(skipCurrentAction(flow, run.events, Date.now()))} />
          </View>
        ) : null}

        <View style={styles.timelineCard}>
          <Timeline nodes={flow.nodes} currentIndex={state.currentIndex} status={state.status} />
        </View>
      </ScrollView>
    </View>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.secondary, props.disabled && styles.secondaryDisabled]}
      onPress={props.disabled ? undefined : props.onPress}
    >
      <Text style={[styles.secondaryText, props.disabled && styles.secondaryTextDisabled]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: colors.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text },
  content: { padding: spacing.md, gap: spacing.md },
  stage: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, alignItems: 'center', gap: spacing.sm, minHeight: 220, justifyContent: 'center',
  },
  stageKicker: { fontSize: 13, color: colors.textMuted, letterSpacing: 1 },
  stageTitle: { fontSize: 26, fontWeight: '700', color: colors.text, textAlign: 'center' },
  stageHint: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  clock: { fontSize: 56, fontWeight: '200', color: colors.text, fontVariant: ['tabular-nums'], marginTop: spacing.sm },
  clockDone: { color: colors.accent },
  timeUp: { fontSize: 14, color: colors.accent },
  badge: { fontSize: 14, color: colors.textMuted, marginTop: spacing.sm },
  doneMark: {
    fontSize: 40, color: colors.accentText, backgroundColor: colors.accent,
    width: 72, height: 72, borderRadius: radius.pill, textAlign: 'center', lineHeight: 72, overflow: 'hidden',
  },
  primary: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center',
  },
  primaryText: { color: colors.accentText, fontSize: 18, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: spacing.sm },
  secondary: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center',
  },
  secondaryDisabled: { opacity: 0.4 },
  secondaryText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  secondaryTextDisabled: { color: colors.textMuted },
  timelineCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
});
