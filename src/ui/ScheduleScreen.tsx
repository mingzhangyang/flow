// 日程型 Flow 的运行视图（创始场景：每日服药）。
// 一天是一条垂直时间轴：每个剂量是一颗时刻珠（待服空心 / 可服描边 / 已服实心 / 漏服暗色），
// 「现在」游标标出此刻在一天中的位置。各剂量相互独立，漏一颗不阻塞其它（C5）。
// 遵守 E6：描述性、非处方性，显式免责。

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Animated, AppState, Linking, Alert, useColorScheme,
} from 'react-native';
import { type Flow } from '../domain/types';
import { type Notifier, type ReminderAvailability } from '../notifications/notifier';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { calendarDateAt } from '../runtime/calendarDate';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { describeRecurrence } from '../runtime/recurrence';
import {
  todayDoses,
  checkIn,
  type CheckIn,
  type DoseState,
  type DoseStatus,
} from '../runtime/adherence';
import { type RuntimeSession, type CheckInChange } from '../session/definitionRuntime';
import { nextEvents } from '../runtime/engine';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { paletteFor, type Palette, spacing, radius, type, mono } from './theme';
import { HeaderBackButton, HeaderSideSpacer, mobileControlSize } from './mobileControls';
import { MotionPressable } from './MotionPressable';
import { createLeaveGuard } from './leaveGuard';
import { motionScale, motionSpring, useReducedMotion } from './motion';

const GRACE_MINUTES = 120;

const statusLabels = (t: Strings): Record<DoseStatus, string> => ({
  upcoming: t.doseUpcoming,
  due: t.doseDue,
  taken: t.doseTaken,
  missed: t.doseMissed,
});

const statusColors = (c: Palette): Record<DoseStatus, string> => ({
  upcoming: c.textFaint,
  due: c.primary,
  taken: c.success,
  missed: c.danger,
});


type Styles = ReturnType<typeof createStyles>;
type BeadStyles = ReturnType<typeof createBeadStyles>;

/** 时刻珠：状态即形态；打卡瞬间弹一下（克制的确认感）。 */
function DoseBead(props: { status: DoseStatus; s: Styles; bs: BeadStyles }) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(props.status);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    running.current?.stop();
    running.current = null;

    if (reducedMotion) {
      scale.setValue(1);
      prev.current = props.status;
      return;
    }

    if (prev.current !== 'taken' && props.status === 'taken') {
      scale.setValue(motionScale.confirmationFrom);
      const animation = Animated.spring(scale, {
        toValue: 1,
        ...motionSpring.confirmation,
        useNativeDriver: true,
        isInteraction: false,
      });
      running.current = animation;
      animation.start(({ finished }) => {
        if (finished && running.current === animation) running.current = null;
      });
    } else if (props.status !== 'taken') {
      scale.setValue(1);
    }

    prev.current = props.status;
    return () => {
      running.current?.stop();
      running.current = null;
    };
  }, [props.status, reducedMotion, scale]);

  return (
    <Animated.View style={[props.s.bead, props.bs[props.status], { transform: [{ scale }] }]}>
      {props.status === 'taken' ? <Text style={props.s.beadCheck}>✓</Text> : null}
    </Animated.View>
  );
}

export function ScheduleScreen(props: {
  flow: Flow;
  session: RuntimeSession;
  notifier: Pick<Notifier, 'status'>;
  /** 打开即视为为这条 flow 开启提醒；实际登记与多日重排由 App 层编排。 */
  onEnrollReminders: () => void;
  onExit: () => void;
  /** App navigation, Android Back and notification replacement share this permission. */
  onRegisterExit?: (request: (() => Promise<boolean>) | null) => void;
}) {
  const { flow, session } = props;
  const c = paletteFor(useColorScheme());
  const { locale, t } = useI18n();
  const styles = useMemo(() => createStyles(c), [c]);
  const beadStyles = useMemo(() => createBeadStyles(c), [c]);
  // 显式注入时区（E3）：flow 锚定了 IANA 时区则按锚定时区，否则跟随设备；跨 DST 正确
  const tz = timeZoneForFlow(flow, systemTimeZone);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [checkInsStatus, setCheckInsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [checkInsAttempt, setCheckInsAttempt] = useState(0);
  const [writeStatus, setWriteStatus] = useState<'idle' | 'pending' | 'failed'>('idle');
  const inFlight = useRef(false);
  const pendingIntent = useRef<CheckInChange | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const [now, setNow] = useState<number>(() => Date.now());
  // 提醒可用状态：被拒/不支持时必须让用户看见（E6 诚实原则——静默失效会伤人）。
  // 打开与回到前台时各查一次（从系统设置回来后横幅要能消失）。
  const [notifStatus, setNotifStatus] = useState<ReminderAvailability>('ready');
  useEffect(() => {
    const refresh = (): void => {
      props.notifier.status().then(setNotifStatus).catch(() => {});
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [props.notifier]);

  useEffect(() => {
    let alive = true;
    setCheckIns([]);
    setCheckInsStatus('loading');

    session.loadCheckIns()
      .then((log) => {
        if (!alive) return;
        setCheckIns(log);
        setCheckInsStatus('ready');
      })
      .catch(() => {
        if (alive) setCheckInsStatus('error');
      });

    props.onEnrollReminders();
    return () => {
      alive = false;
    };
  }, [checkInsAttempt, flow, session]);

  // 让 due → missed 等状态随时间推移刷新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Foreground recovery reads from the same serialized session lane. This
  // cannot overtake a pending write or reconstruct success from stale UI state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setNow(Date.now());
      if (pendingIntent.current) return; // Failed intent stays visible until retried.
      void session.loadCheckIns()
        .then((log) => {
          if (alive.current) {
            setCheckIns(log);
            setCheckInsStatus('ready');
          }
        })
        .catch(() => { if (alive.current) setCheckInsStatus('error'); });
    });
    return () => sub.remove();
  }, [session]);

  const checkInsReady = checkInsStatus === 'ready';
  const doses = checkInsReady ? todayDoses(flow, checkIns, now, tz, GRACE_MINUTES) : [];
  // 节律在 flow 级：今天不在节律上时给出下一次的日子
  const cadence = describeRecurrence(flow.repeat ?? { kind: 'once' }, locale);
  const STATUS_LABEL = statusLabels(t);
  const [nextOcc] = doses.length === 0 ? nextEvents(flow, now, tz, 400 * MS_PER_DAY) : [];
  const nowMinutes = timeOfDay(now, tz);
  // 「现在」游标插在哪两剂之间
  const cursorIndex = doses.findIndex((d) => timeOfDay(d.scheduledFor, tz) > nowMinutes);
  const cursorAt = cursorIndex === -1 ? doses.length : cursorIndex;

  // Confirmed-write UI: the dose does not become "taken" until the storage lane
  // acknowledges the update. A failed intent stays retryable with its original timestamp.
  const submitIntent = (intent: CheckInChange): void => {
    if (inFlight.current || !checkInsReady) return;
    inFlight.current = true;
    pendingIntent.current = intent;
    setWriteStatus('pending');
    void session.changeCheckIn(intent)
      .then((committed) => {
        pendingIntent.current = null;
        if (!alive.current) return;
        setCheckIns(committed);
        setWriteStatus('idle');
      })
      .catch(async () => {
        // A rejected storage call may have applied the write before throwing.
        // Re-read the authoritative log; never derive rollback from a stale UI array.
        try {
          const persisted = await session.loadCheckIns();
          if (alive.current) {
            setCheckIns(persisted);
            setCheckInsStatus('ready');
          }
        } catch {
          if (alive.current) setCheckInsStatus('error');
        }
        if (alive.current) setWriteStatus('failed');
      })
      .finally(() => { inFlight.current = false; });
  };
  const take = (d: DoseState): void => submitIntent({
    kind: 'record', entry: checkIn(d.nodeId, d.scheduledFor, true, Date.now()),
  });
  const undo = (d: DoseState): void => submitIntent({
    kind: 'undo', nodeId: d.nodeId, scheduledFor: d.scheduledFor,
  });
  // All exits (header, Android Back, notification replacement) ask this same
  // screen-owned guard. Only App may perform the eventual route transition.
  const confirmLeave = useRef<(done: (approved: boolean) => void) => void>(() => {});
  confirmLeave.current = (done) => Alert.alert(t.scheduleUnsavedTitle, t.scheduleUnsavedExit, [
    { text: t.cancel, style: 'cancel', onPress: () => done(false) },
    { text: t.scheduleLeaveAnyway, style: 'destructive', onPress: () => done(true) },
  ], { cancelable: true, onDismiss: () => done(false) });
  const leaveGuard = useMemo(() => createLeaveGuard({
    // Check the synchronous intent refs, not the lagging rendered status.
    disposition: () => pendingIntent.current || inFlight.current ? 'confirm' : 'allow',
    prompt: (done) => confirmLeave.current(done),
  }), []);

  const requestExit = (): void => {
    void leaveGuard.request().then((approved) => {
      if (approved && alive.current && session.isOpen()) props.onExit();
    });
  };
  useLayoutEffect(() => {
    props.onRegisterExit?.(leaveGuard.request);
    return () => props.onRegisterExit?.(null);
  }, [leaveGuard, props.onRegisterExit]);
  useEffect(() => () => leaveGuard.cancel(), [leaveGuard]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <HeaderBackButton accessibilityLabel={t.back} color={c.primary} onPress={requestExit} />
        <Text style={styles.title} numberOfLines={1}>{flow.title}</Text>
        <HeaderSideSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {notifStatus === 'denied' ? (
          <MotionPressable accessibilityRole="button" accessibilityLabel={t.scheduleNotifSettings}
            style={styles.notifBanner} onPress={() => { Linking.openSettings().catch(() => {}); }}>
            <Text style={styles.notifBannerText}>{t.scheduleNotifDenied}</Text>
            <Text style={styles.notifBannerLink}>{t.scheduleNotifSettings}</Text>
          </MotionPressable>
        ) : notifStatus === 'unsupported' ? (
          <Text style={styles.notifWeb}>{t.scheduleNotifWeb}</Text>
        ) : null}
        <Text style={styles.sectionKicker}>{t.scheduleToday(cadence, flow.timeZone)}</Text>

        {checkInsStatus === 'error' ? (
          <View style={styles.storageError}>
            <Text style={styles.storageErrorText}>{t.scheduleStorageUnavailable}</Text>
            <MotionPressable style={styles.retryButton} onPress={() => setCheckInsAttempt((n) => n + 1)}>
              <Text style={styles.retryText}>{t.retry}</Text>
            </MotionPressable>
          </View>
        ) : null}

        {writeStatus !== 'idle' ? (
          <View style={styles.storageError}>
            <Text style={styles.storageErrorText}>
              {writeStatus === 'pending' ? t.scheduleSaving : t.scheduleSaveFailed}
            </Text>
            {writeStatus === 'failed' && pendingIntent.current ? (
              <MotionPressable
                style={styles.retryButton}
                disabled={!checkInsReady}
                onPress={() => { if (pendingIntent.current) submitIntent(pendingIntent.current); }}
              >
                <Text style={styles.retryText}>{t.retry}</Text>
              </MotionPressable>
            ) : null}
          </View>
        ) : null}
        {checkInsReady ? (
        <View style={styles.card}>
          {doses.length === 0 ? (
            <Text style={styles.empty}>
              {t.scheduleOffDay(
                nextOcc
                  ? {
                      month: calendarDateAt(nextOcc.at, tz).month,
                      day: calendarDateAt(nextOcc.at, tz).day,
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
                  <MotionPressable
                    accessibilityRole="button"
                    style={styles.undoButton}
                    disabled={writeStatus !== 'idle'}
                    accessibilityState={{ disabled: writeStatus !== 'idle' }}
                    onPress={() => undo(d)}
                  >
                    <Text style={styles.undo}>{t.undo}</Text>
                  </MotionPressable>
                ) : (
                  <MotionPressable accessibilityRole="button" style={styles.take}
                    disabled={writeStatus !== 'idle'}
                    accessibilityState={{ disabled: writeStatus !== 'idle' }}
                    onPress={() => take(d)}>
                    <Text style={styles.takeText}>{t.checkIn}</Text>
                  </MotionPressable>
                )}
              </View>
            </View>
          ))}
          {cursorAt === doses.length && doses.length > 0 ? <NowCursor minutes={nowMinutes} s={styles} t={t} /> : null}
        </View>
        ) : null}

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
  upcoming: { backgroundColor: c.inputSurface, borderWidth: 2, borderColor: c.textFaint },
  due: { backgroundColor: c.primarySoft, borderWidth: 3, borderColor: c.primary },
  taken: { backgroundColor: c.success, borderWidth: 0 },
  missed: { backgroundColor: c.dangerSoft, borderWidth: 2, borderColor: c.danger },
});

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  title: {
    flex: 1, minWidth: 0, textAlign: 'center',
    fontSize: type.emphasis - 1, fontWeight: '600', color: c.text,
  },
  content: { flexGrow: 1, padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  notifBanner: {
    backgroundColor: c.warningSoft, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.warning,
    padding: spacing.md, gap: spacing.xs,
  },
  notifBannerText: { color: c.warning, fontSize: 14, lineHeight: 20 },
  notifBannerLink: { color: c.primary, fontSize: 14, fontWeight: '600' },
  notifWeb: { fontSize: 13, color: c.textMuted, marginLeft: spacing.xs },
  sectionKicker: { fontSize: type.caption + 1, color: c.textMuted, letterSpacing: 1, marginLeft: spacing.xs },
  storageError: {
    backgroundColor: c.dangerSoft, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.danger,
    padding: spacing.md, gap: spacing.sm,
  },
  storageErrorText: { color: c.danger, fontSize: 14, lineHeight: 20 },
  retryButton: {
    minHeight: mobileControlSize.compact, justifyContent: 'center',
    alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, borderColor: c.primary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  retryText: { color: c.primary, fontSize: 14, fontWeight: '600' },
  card: {
    backgroundColor: c.surfaceRaised, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  time: {
    fontSize: type.emphasis, fontFamily: mono.medium, color: c.text,
    fontVariant: ['tabular-nums'], minWidth: 56, flexShrink: 0,
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
  beadCheck: { color: c.onPrimary, fontSize: 12, fontWeight: '800' },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: type.body, color: c.text },
  labelTaken: { color: c.textMuted, textDecorationLine: 'line-through' },
  status: { fontSize: type.caption + 1, marginTop: 2 },
  take: {
    minHeight: mobileControlSize.compact, justifyContent: 'center',
    backgroundColor: c.primary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  takeText: { color: c.onPrimary, fontSize: 14, fontWeight: '700' },
  undoButton: {
    minWidth: mobileControlSize.compact, minHeight: mobileControlSize.compact,
    alignItems: 'center', justifyContent: 'center',
  },
  undo: { color: c.textMuted, fontSize: 14, paddingHorizontal: spacing.sm },
  cursorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  cursorLabel: { fontSize: type.caption, color: c.primary, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cursorLine: { flex: 1, height: 1.5, backgroundColor: c.primary, opacity: 0.45, borderRadius: 1 },
  empty: { fontSize: type.body - 1, color: c.textMuted, paddingVertical: spacing.md },
  onceNote: { fontSize: 13, color: c.primary, marginTop: spacing.xs, lineHeight: 19 },
  note: { fontSize: 13, color: c.textMuted, marginTop: spacing.md, lineHeight: 19 },
});
