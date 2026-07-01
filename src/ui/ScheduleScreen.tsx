// 日程型 Flow 的运行视图（如每日服药）。日程型没有线性 Runner——
// 它的“下一步”由 nextEvents() 给出：未来 24 小时内每个定时事件的下一次触发（各自独立）。
// 遵守 E6：描述性、非处方性，显式提示以医嘱为准。

import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { type Flow } from '../domain/types';
import { nextEvents } from '../runtime/engine';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { fmtTimeOfDay } from './format';
import { colors, spacing, radius } from './theme';

export function ScheduleScreen(props: { flow: Flow; onExit: () => void }) {
  const { flow } = props;
  const now = Date.now();
  const tz = -new Date().getTimezoneOffset(); // 显式时区：由 UTC 加到本地的分钟数（E3）
  const occurrences = nextEvents(flow, now, tz, MS_PER_DAY);

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
        <Text style={styles.sectionKicker}>未来 24 小时</Text>
        <View style={styles.card}>
          {occurrences.map((o, i) => (
            <View key={o.nodeId} style={[styles.row, i === 0 && styles.rowNext]}>
              <Text style={[styles.time, i === 0 && styles.timeNext]}>{fmtTimeOfDay(timeOfDay(o.at, tz))}</Text>
              <Text style={styles.label}>{o.label}</Text>
              {i === 0 ? <Text style={styles.nextTag}>下一次</Text> : null}
            </View>
          ))}
        </View>

        <Text style={styles.note}>
          {flow.description ?? ''}
          {'\n'}本表仅作提醒之用，不构成医疗处方；请以医嘱为准。
        </Text>
      </ScrollView>
    </View>
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
  content: { padding: spacing.md, gap: spacing.sm },
  sectionKicker: { fontSize: 13, color: colors.textMuted, letterSpacing: 1, marginLeft: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowNext: {},
  time: { fontSize: 18, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'], width: 60 },
  timeNext: { color: colors.accent },
  label: { flex: 1, fontSize: 15, color: colors.text },
  nextTag: {
    fontSize: 12, color: colors.accentText, backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden',
  },
  note: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md, lineHeight: 19 },
});
