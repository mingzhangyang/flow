// 日程型 Flow 的运行视图（创始场景：每日服药）。
// 今天每个剂量一行：到点提示 + 打卡；各剂量相互独立，漏一颗不阻塞其它（C5）。
// 遵守 E6：描述性、非处方性，显式免责。

import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { type Flow } from '../domain/types';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import {
  todayDoses,
  recordCheckIn,
  checkIn,
  type CheckIn,
  type DoseState,
  type DoseStatus,
} from '../runtime/adherence';
import { type Storage } from '../storage/storage';
import { type Notifier } from '../notifications/notifier';
import { planScheduledReminders } from '../notifications/plan';
import { fmtTimeOfDay } from './format';
import { colors, spacing, radius } from './theme';

const GRACE_MINUTES = 120;

const STATUS: Record<DoseStatus, { label: string; color: string }> = {
  upcoming: { label: '待服', color: colors.textMuted },
  due: { label: '可服用', color: colors.accent },
  taken: { label: '已服', color: colors.accent },
  missed: { label: '漏服', color: colors.warn },
};

export function ScheduleScreen(props: {
  flow: Flow;
  storage: Storage;
  notifier: Notifier;
  onExit: () => void;
}) {
  const { flow, storage, notifier } = props;
  // 显式注入时区（E3）：flow 锚定了 IANA 时区则按锚定时区，否则跟随设备；偏移按时刻取值，跨 DST 正确
  const tz = timeZoneForFlow(flow, systemTimeZone);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let alive = true;
    storage.loadCheckIns(flow.id).then((log) => alive && setCheckIns(log)).catch(() => {});
    notifier.schedule(planScheduledReminders(flow, Date.now(), tz, MS_PER_DAY)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [flow]);

  // 让 due → missed 等状态随时间推移刷新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const doses = todayDoses(flow, checkIns, now, tz, GRACE_MINUTES);

  const persist = (next: CheckIn[]): void => {
    setCheckIns(next);
    storage.saveCheckIns(flow.id, next).catch(() => {});
  };
  const take = (d: DoseState): void =>
    persist(recordCheckIn(checkIns, checkIn(d.nodeId, d.scheduledFor, true, Date.now())));
  const undo = (d: DoseState): void =>
    persist(checkIns.filter((c) => !(c.nodeId === d.nodeId && c.scheduledFor === d.scheduledFor)));

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
        <Text style={styles.sectionKicker}>
          今天{flow.timeZone ? ` · 按 ${flow.timeZone} 时区` : ''}
        </Text>
        <View style={styles.card}>
          {doses.map((d, i) => (
            <View key={d.nodeId} style={[styles.row, i > 0 && styles.rowDivider]}>
              <Text style={[styles.time, d.status === 'taken' && styles.timeTaken]}>
                {fmtTimeOfDay(timeOfDay(d.scheduledFor, tz))}
              </Text>
              <View style={styles.body}>
                <Text style={[styles.label, d.status === 'taken' && styles.labelTaken]}>{d.label}</Text>
                <Text style={[styles.status, { color: STATUS[d.status].color }]}>
                  {STATUS[d.status].label}
                  {d.status === 'taken' && d.takenAt !== null ? ` · ${fmtTimeOfDay(timeOfDay(d.takenAt, tz))}` : ''}
                </Text>
              </View>
              {d.status === 'taken' ? (
                <Pressable onPress={() => undo(d)} hitSlop={8}>
                  <Text style={styles.undo}>撤销</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.take} onPress={() => take(d)}>
                  <Text style={styles.takeText}>打卡</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>

        <Text style={styles.note}>
          {flow.description ? flow.description + '\n' : ''}
          本表仅作提醒之用，不构成医疗处方或诊断；请以医嘱为准。
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  time: { fontSize: 18, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'], width: 56 },
  timeTaken: { color: colors.textMuted },
  body: { flex: 1 },
  label: { fontSize: 15, color: colors.text },
  labelTaken: { color: colors.textMuted, textDecorationLine: 'line-through' },
  status: { fontSize: 13, marginTop: 2 },
  take: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  takeText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },
  undo: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.sm },
  note: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md, lineHeight: 19 },
});
