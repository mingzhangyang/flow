// Timeline Renderer：把一条顺序型 Flow 竖向铺开，高亮“当前/下一步”（C4）。
// 纯展示组件，只读传入的状态，不含业务逻辑（架构分层）。
// tone="dark" 用于沉浸式运行场景（与 Runner 的深墨绿一致）。

import { View, Text, StyleSheet } from 'react-native';
import { type FlowNode } from '../domain/types';
import { type RunStatus } from '../runtime/engine';
import { fmtDuration } from './format';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { colors, dark, spacing, radius } from './theme';

type StepState = 'done' | 'current' | 'pending';

function stepState(index: number, currentIndex: number, status: RunStatus): StepState {
  if (status === 'completed') return 'done';
  if (index < currentIndex) return 'done';
  if (index === currentIndex && status !== 'idle') return 'current';
  return 'pending';
}

function meta(node: FlowNode, t: Strings): string {
  switch (node.kind) {
    case 'timed':
      return fmtDuration(node.durationSec);
    case 'gate':
      return t.nodeNeedsConfirm;
    case 'instant':
      return t.nodeInstant;
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
  const tone = props.tone === 'dark' ? darkTone : lightTone;
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      {props.nodes.map((node, i) => {
        const st = stepState(i, props.currentIndex, props.status);
        return (
          <View key={node.id} style={styles.row}>
            <View style={[styles.dot, tone.dot, st === 'done' && tone.dotDone, st === 'current' && tone.dotCurrent]}>
              {st === 'done' ? (
                <Text style={[styles.check, tone.check]}>✓</Text>
              ) : (
                <Text style={[styles.dotNum, tone.dotNum]}>{i + 1}</Text>
              )}
            </View>
            <View style={styles.body}>
              <Text
                style={[tone.label, st === 'current' && tone.labelCurrent, st === 'done' && tone.labelDone]}
              >
                {node.label}
              </Text>
              {node.rationale ? <Text style={tone.rationale}>{node.rationale}</Text> : null}
            </View>
            <Text style={tone.meta}>{meta(node, t)}</Text>
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
