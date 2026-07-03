// 日程型 Flow 的运行视图（创始场景：每日服药）。
// 一天是一条垂直时间轴：每个剂量是一颗时刻珠（待服空心 / 可服描边 / 已服实心 / 漏服暗色），
// 「现在」游标标出此刻在一天中的位置。各剂量相互独立，漏一颗不阻塞其它（C5）。
// 遵守 E6：描述性、非处方性，显式免责。

import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Animated, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
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
import { nextEvents } from '../runtime/engine';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { paletteFor, type Palette, spacing, radius, type, mono } from './theme';

const GRACE_MINUTES = 120;

const statusLabels = (t: Strings): Record<DoseStatus, string> => ({
  upcoming: t.doseUpcoming,
  due: t.doseDue,
  taken: t.doseTaken,
  missed: t.doseMissed,
});

const statusColors = (c: Palette): Record<DoseStatus, string> => ({
  upcoming: c.textMuted,
  due: c.accent,
  taken: c.accent,
  missed: c.warn,
});


type Styles = ReturnType<typeof createStyles>;
type BeadStyles = ReturnType<typeof createBeadStyles>;

/** 时刻珠：状态即形态；打卡瞬间弹一下（克制的确认感）。 */
function DoseBead(props: { status: DoseStatus; s: Styles; bs: BeadStyles }) {
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
    <Animated.View style={[props.s.bead, props.bs[props.status], { transform: [{ scale }] }]}>
      {props.status === 'taken' ? <Text style={props.s.beadCheck}>✓</Text> : null}
    </Animated.View>
  );
}

export function ScheduleScreen(props: {
  flow: Flow;
  storage: Storage;
  /** 打开即视为为这条 flow 开启提醒；实际登记与多日重排由 App 层编排。 */
  onEnrollReminders: (flowId: string) => void;
  onExit: () => void;
}) {
  const { flow, storage } = props;
  const c = paletteFor(useColorScheme());
  const { locale, t } = useI18n();
  const styles = useMemo(() => createStyles(c), [c]);
  const beadStyles = useMemo(() => createBeadStyles(c), [c]);
  // 显式注入时区（E3）：flow 锚定了 IANA 时区则按锚定时区，否则跟随设备；跨 DST 正确
  const tz = timeZoneForFlow(flow, systemTimeZone);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let alive = true;
    storage.loadCheckIns(flow.id).then((log) => alive && setCheckIns(log)).catch(() => {});
    props.onEnrollReminders(flow.id);
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
  // 节律在 flow 级：今天不在节律上时给出下一次的日子
  const cadence = describeRecurrence(flow.repeat ?? { kind: 'once' }, locale);
  const STATUS_LABEL = statusLabels(t);
  const [nextOcc] = doses.length === 0 ? nextEvents(flow, now, tz, 400 * MS_PER_DAY) : [];
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
          <Text style={styles.back}>{t.back}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{flow.title}</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionKicker}>{t.scheduleToday(cadence, flow.timeZone)}</Text>

        <View style={styles.card}>
          {doses.length === 0 ? (
            <Text style={styles.empty}>
              {t.scheduleOffDay(
                nextOcc
                  ? {
                      month: new Date(nextOcc.at).getMonth() + 1,
                      day: new Date(nextOcc.at).getDate(),
                      time: fmtTimeOfDay(timeOfDay(nextOcc.at, tz)),
                    }
                  : null,
              )}
            </Text>
          ) : null}
          {doses.map((d, i) => (
            <View key={d.nodeId}>
              {i === cursorAt ? <NowCursor minutes={nowMinutes} s={styles} t={t} /> : null}
              <View style={styles.row}>
                <Text style={[styles.time, d.status === 'taken' && styles.timeTaken]}>
                  {fmtTimeOfDay(timeOfDay(d.scheduledFor, tz))}
                </Text>
                <View style={styles.axis}>
                  {i > 0 || cursorAt === 0 ? <View style={styles.axisLineTop} /> : null}
                  <DoseBead status={d.status} s={styles} bs={beadStyles} />
                  {i < doses.length - 1 || cursorAt === doses.length ? (
                    <View style={styles.axisLineBottom} />
                  ) : null}
                </View>
                <View style={styles.body}>
                  <Text style={[styles.label, d.status === 'taken' && styles.labelTaken]}>{d.label}</Text>
                  <Text style={[styles.status, { color: statusColors(c)[d.status] }]}>
                    {STATUS_LABEL[d.status]}
                    {d.status === 'taken' && d.takenAt !== null ? ` · ${fmtTimeOfDay(timeOfDay(d.takenAt, tz))}` : ''}
                  </Text>
                </View>
                {d.status === 'taken' ? (
                  <Pressable onPress={() => undo(d)} hitSlop={8}>
                    <Text style={styles.undo}>{t.undo}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.take} onPress={() => take(d)}>
                    <Text style={styles.takeText}>{t.checkIn}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
          {cursorAt === doses.length && doses.length > 0 ? <NowCursor minutes={nowMinutes} s={styles} t={t} /> : null}
        </View>

        {(flow.repeat ?? { kind: 'once' }).kind === 'once' ? (
          // once「过时不候」——在运行视图里明说，不让默认语义只活在文档里
          <Text style={styles.onceNote}>{t.scheduleOnceNote}</Text>
        ) : null}
        <Text style={styles.note}>
          {flow.description ? flow.description + '\n' : ''}
          {t.scheduleNote}
        </Text>
      </ScrollView>
    </View>
  );
}

function NowCursor(props: { minutes: number; s: Styles; t: Strings }) {
  return (
    <View style={props.s.cursorRow}>
      <Text style={props.s.cursorLabel}>{props.t.scheduleNow(fmtTimeOfDay(props.minutes))}</Text>
      <View style={props.s.cursorLine} />
    </View>
  );
}

const BEAD = 22;

const createBeadStyles = (c: Palette) => StyleSheet.create({
  upcoming: { backgroundColor: c.surface, borderWidth: 2, borderColor: c.pending },
  due: { backgroundColor: c.surface, borderWidth: 3, borderColor: c.accent },
  taken: { backgroundColor: c.accent, borderWidth: 0 },
  missed: { backgroundColor: c.done, borderWidth: 0 },
});

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: c.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: type.emphasis - 1, fontWeight: '600', color: c.text },
  content: { padding: spacing.md, gap: spacing.sm },
  sectionKicker: { fontSize: type.caption + 1, color: c.textMuted, letterSpacing: 1, marginLeft: spacing.xs },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  time: {
    fontSize: type.emphasis, fontFamily: mono.medium, color: c.text,
    fontVariant: ['tabular-nums'], width: 56,
  },
  timeTaken: { color: c.textMuted },
  axis: { width: BEAD, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  axisLineTop: {
    position: 'absolute', top: -spacing.md, bottom: '50%', width: 2,
    backgroundColor: c.border, marginBottom: BEAD / 2 + 4,
  },
  axisLineBottom: {
    position: 'absolute', top: '50%', bottom: -spacing.md, width: 2,
    backgroundColor: c.border, marginTop: BEAD / 2 + 4,
  },
  bead: { width: BEAD, height: BEAD, borderRadius: BEAD / 2, alignItems: 'center', justifyContent: 'center' },
  beadCheck: { color: c.accentText, fontSize: 12, fontWeight: '800' },
  body: { flex: 1 },
  label: { fontSize: type.body, color: c.text },
  labelTaken: { color: c.textMuted, textDecorationLine: 'line-through' },
  status: { fontSize: type.caption + 1, marginTop: 2 },
  take: {
    backgroundColor: c.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  takeText: { color: c.accentText, fontSize: 14, fontWeight: '700' },
  undo: { color: c.textMuted, fontSize: 14, paddingHorizontal: spacing.sm },
  cursorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  cursorLabel: { fontSize: type.caption, color: c.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cursorLine: { flex: 1, height: 1.5, backgroundColor: c.accent, opacity: 0.45, borderRadius: 1 },
  empty: { fontSize: type.body - 1, color: c.textMuted, paddingVertical: spacing.md },
  onceNote: { fontSize: 13, color: c.accent, marginTop: spacing.xs, lineHeight: 19 },
  note: { fontSize: 13, color: c.textMuted, marginTop: spacing.md, lineHeight: 19 },
});
