// Timeline Renderer：把一条顺序型 Flow 竖向铺开，高亮“当前/下一步”（C4）。
// 纯展示组件，只读传入的状态，不含业务逻辑（架构分层）。
// tone="dark" 用于沉浸式运行场景（与 Runner 的深墨绿一致）。

import { View, Text, StyleSheet } from 'react-native';
import { type FlowNode } from '../domain/types';
import { type RunStatus } from '../runtime/engine';
import { fmtDuration } from './format';
import { colors, dark, spacing, radius } from './theme';

type StepState = 'done' | 'current' | 'pending';

function stepState(index: number, currentIndex: number, status: RunStatus): StepState {
  if (status === 'completed') return 'done';
  if (index < currentIndex) return 'done';
  if (index === currentIndex && status !== 'idle') return 'current';
  return 'pending';
}

function meta(node: FlowNode): string {
  switch (node.kind) {
    case 'timed':
      return fmtDuration(node.durationSec);
    case 'gate':
      return '需确认';
    case 'instant':
      return '即时';
    default:
      return '';
  }
}

export function Timeline(props: {
  nodes: FlowNode[];
  currentIndex: number;
  status: RunStatus;
  tone?: 'light' | 'dark';
}) {
  const t = props.tone === 'dark' ? darkTone : lightTone;
  return (
    <View style={styles.wrap}>
      {props.nodes.map((node, i) => {
        const st = stepState(i, props.currentIndex, props.status);
        return (
          <View key={node.id} style={styles.row}>
            <View style={[styles.dot, t.dot, st === 'done' && t.dotDone, st === 'current' && t.dotCurrent]}>
              {st === 'done' ? (
                <Text style={[styles.check, t.check]}>✓</Text>
              ) : (
                <Text style={[styles.dotNum, t.dotNum]}>{i + 1}</Text>
              )}
            </View>
            <View style={styles.body}>
              <Text
                style={[t.label, st === 'current' && t.labelCurrent, st === 'done' && t.labelDone]}
              >
                {node.label}
              </Text>
              {node.rationale ? <Text style={t.rationale}>{node.rationale}</Text> : null}
            </View>
            <Text style={t.meta}>{meta(node)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  dot: {
    width: 28, height: 28, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  dotNum: { fontSize: 12, fontWeight: '600' },
  check: { fontSize: 14, fontWeight: '700' },
  body: { flex: 1 },
});

const lightTone = StyleSheet.create({
  dot: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.pending },
  dotDone: { backgroundColor: colors.done, borderColor: colors.done },
  dotCurrent: { borderColor: colors.accent, borderWidth: 2 },
  dotNum: { color: colors.textMuted },
  check: { color: colors.accentText },
  label: { fontSize: 16, color: colors.text },
  labelCurrent: { fontWeight: '700', color: colors.accent },
  labelDone: { color: colors.textMuted },
  rationale: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});

const darkTone = StyleSheet.create({
  dot: { backgroundColor: dark.surface, borderWidth: 1.5, borderColor: dark.faint },
  dotDone: { backgroundColor: dark.faint, borderColor: dark.faint },
  dotCurrent: { borderColor: dark.accent, borderWidth: 2 },
  dotNum: { color: dark.textMuted },
  check: { color: dark.text },
  label: { fontSize: 16, color: dark.text },
  labelCurrent: { fontWeight: '700', color: dark.accent },
  labelDone: { color: dark.textMuted },
  rationale: { fontSize: 13, color: dark.textMuted, marginTop: 2 },
  meta: { fontSize: 13, color: dark.textMuted, fontVariant: ['tabular-nums'] },
});
