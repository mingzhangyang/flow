// 日程型 Flow 的运行视图（创始场景：每日服药）。
// 一天是一条垂直时间轴：每个剂量是一颗时刻珠（待服空心 / 可服描边 / 已服实心 / 漏服暗色），
// 「现在」游标标出此刻在一天中的位置。各剂量相互独立，漏一颗不阻塞其它（C5）。
// 遵守 E6：描述性、非处方性，显式免责。

import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Animated } from 'react-native';
import { type Flow, type FlowNode, type Recurrence } from '../domain/types';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { describeRecurrence } from '../runtime/recurrence';
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
import { colors, spacing, radius, type, mono } from './theme';

const GRACE_MINUTES = 120;

const STATUS: Record<DoseStatus, { label: string; color: string }> = {
  upcoming: { label: '待服', color: colors.textMuted },
  due: { label: '可服用', color: colors.accent },
  taken: { label: '已服', color: colors.accent },
  missed: { label: '漏服', color: colors.warn },
};

/** 收集所有 scheduled 节点的重复方式，非每天的在行内标注。 */
function repeatLabels(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (list: FlowNode[]): void => {
    for (const n of list) {
      if (n.kind === 'scheduled' && n.repeat.kind !== 'daily') {
        map.set(n.id, describeRecurrence(n.repeat as Recurrence));
      } else if (n.kind === 'parallel') {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return map;
}

/** 时刻珠：状态即形态；打卡瞬间弹一下（克制的确认感）。 */
function DoseBead(props: { status: DoseStatus }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(props.status);
  useEffect(() => {
    if (prev.current !== 'taken' && props.status === 'taken') {
      scale.setValue(0.4);
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: false }).start();
    }
    prev.current = props.status;
  }, [props.status, scale]);

  return (
    <Animated.View style={[styles.bead, beadStyles[props.status], { transform: [{ scale }] }]}>
      {props.status === 'taken' ? <Text style={styles.beadCheck}>✓</Text> : null}
    </Animated.View>
  );
}

export function ScheduleScreen(props: {
  flow: Flow;
  storage: Storage;
  notifier: Notifier;
  onExit: () => void;
}) {
  const { flow, storage, notifier } = props;
  // 显式注入时区（E3）：flow 锚定了 IANA 时区则按锚定时区，否则跟随设备；跨 DST 正确
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
  const labels = repeatLabels(flow.nodes);
  const nowMinutes = timeOfDay(now, tz);
  // 「现在」游标插在哪两剂之间
  const cursorIndex = doses.findIndex((d) => timeOfDay(d.scheduledFor, tz) > nowMinutes);
  const cursorAt = cursorIndex === -1 ? doses.length : cursorIndex;

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
            <View key={d.nodeId}>
              {i === cursorAt ? <NowCursor minutes={nowMinutes} /> : null}
              <View style={styles.row}>
                <Text style={[styles.time, d.status === 'taken' && styles.timeTaken]}>
                  {fmtTimeOfDay(timeOfDay(d.scheduledFor, tz))}
                </Text>
                <View style={styles.axis}>
                  {i > 0 || cursorAt === 0 ? <View style={styles.axisLineTop} /> : null}
                  <DoseBead status={d.status} />
                  {i < doses.length - 1 || cursorAt === doses.length ? (
                    <View style={styles.axisLineBottom} />
                  ) : null}
                </View>
                <View style={styles.body}>
                  <Text style={[styles.label, d.status === 'taken' && styles.labelTaken]}>{d.label}</Text>
                  <Text style={[styles.status, { color: STATUS[d.status].color }]}>
                    {STATUS[d.status].label}
                    {d.status === 'taken' && d.takenAt !== null ? ` · ${fmtTimeOfDay(timeOfDay(d.takenAt, tz))}` : ''}
                    {labels.has(d.nodeId) ? ` · ${labels.get(d.nodeId)}` : ''}
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
            </View>
          ))}
          {cursorAt === doses.length && doses.length > 0 ? <NowCursor minutes={nowMinutes} /> : null}
        </View>

        <Text style={styles.note}>
          {flow.description ? flow.description + '\n' : ''}
          本表仅作提醒之用，不构成医疗处方或诊断；请以医嘱为准。
        </Text>
      </ScrollView>
    </View>
  );
}

function NowCursor(props: { minutes: number }) {
  return (
    <View style={styles.cursorRow}>
      <Text style={styles.cursorLabel}>现在 {fmtTimeOfDay(props.minutes)}</Text>
      <View style={styles.cursorLine} />
    </View>
  );
}

const BEAD = 22;

const beadStyles: Record<DoseStatus, object> = StyleSheet.create({
  upcoming: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.pending },
  due: { backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.accent },
  taken: { backgroundColor: colors.accent, borderWidth: 0 },
  missed: { backgroundColor: colors.done, borderWidth: 0 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: colors.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: type.emphasis - 1, fontWeight: '600', color: colors.text },
  content: { padding: spacing.md, gap: spacing.sm },
  sectionKicker: { fontSize: type.caption + 1, color: colors.textMuted, letterSpacing: 1, marginLeft: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  time: {
    fontSize: type.emphasis, fontFamily: mono.medium, color: colors.text,
    fontVariant: ['tabular-nums'], width: 56,
  },
  timeTaken: { color: colors.textMuted },
  axis: { width: BEAD, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  axisLineTop: {
    position: 'absolute', top: -spacing.md, bottom: '50%', width: 2,
    backgroundColor: colors.border, marginBottom: BEAD / 2 + 4,
  },
  axisLineBottom: {
    position: 'absolute', top: '50%', bottom: -spacing.md, width: 2,
    backgroundColor: colors.border, marginTop: BEAD / 2 + 4,
  },
  bead: { width: BEAD, height: BEAD, borderRadius: BEAD / 2, alignItems: 'center', justifyContent: 'center' },
  beadCheck: { color: colors.accentText, fontSize: 12, fontWeight: '800' },
  body: { flex: 1 },
  label: { fontSize: type.body, color: colors.text },
  labelTaken: { color: colors.textMuted, textDecorationLine: 'line-through' },
  status: { fontSize: type.caption + 1, marginTop: 2 },
  take: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  takeText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },
  undo: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.sm },
  cursorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  cursorLabel: { fontSize: type.caption, color: colors.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cursorLine: { flex: 1, height: 1.5, backgroundColor: colors.accent, opacity: 0.45, borderRadius: 1 },
  note: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md, lineHeight: 19 },
});
