// Timeline Renderer：把一条顺序型 Flow 竖向铺开，高亮“当前/下一步”（C4）。
// 纯展示组件，只读传入的状态，不含业务逻辑（架构分层）。

import { View, Text, StyleSheet } from 'react-native';
import { type FlowNode } from '../domain/types';
import { type RunStatus } from '../runtime/engine';
import { fmtDuration } from './format';
import { colors, spacing, radius } from './theme';

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

export function Timeline(props: { nodes: FlowNode[]; currentIndex: number; status: RunStatus }) {
  return (
    <View style={styles.wrap}>
      {props.nodes.map((node, i) => {
        const st = stepState(i, props.currentIndex, props.status);
        return (
          <View key={node.id} style={styles.row}>
            <View style={[styles.dot, st === 'done' && styles.dotDone, st === 'current' && styles.dotCurrent]}>
              {st === 'done' ? <Text style={styles.check}>✓</Text> : <Text style={styles.dotNum}>{i + 1}</Text>}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, st === 'current' && styles.labelCurrent, st === 'done' && styles.labelDone]}>
                {node.label}
              </Text>
              {node.rationale ? <Text style={styles.rationale}>{node.rationale}</Text> : null}
            </View>
            <Text style={styles.meta}>{meta(node)}</Text>
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
    width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: colors.pending, alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.done, borderColor: colors.done },
  dotCurrent: { borderColor: colors.accent, borderWidth: 2 },
  dotNum: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  check: { fontSize: 14, color: colors.accentText, fontWeight: '700' },
  body: { flex: 1 },
  label: { fontSize: 16, color: colors.text },
  labelCurrent: { fontWeight: '700', color: colors.accent },
  labelDone: { color: colors.textMuted },
  rationale: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
