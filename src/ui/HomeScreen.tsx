// 首页：先回答「此刻该干嘛」（接下来块），再是 flow 库（我的 + 示例）。
// 卡片带由 id 派生的低饱和色线与拓扑图形徽章，库一多也有节奏而不吵。

import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow, type Topology } from '../domain/types';
import { type Library } from '../session/library';
import { nextEvents, type ScheduledOccurrence } from '../runtime/engine';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { useAppScheme } from './settings-context';
import { paletteFor, type Palette, dark, spacing, radius, type, mono } from './theme';

/** 卡片色线的低饱和候选色；由 flow id 稳定派生。 */
const STRIPES = ['#7A9E87', '#C2915C', '#8B9DB0', '#B08B9B', '#9AA05F', '#7FA6A0'];
function stripeOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STRIPES[h % STRIPES.length];
}

function SeqGlyph(props: { color: string }) {
  return (
    <View style={glyph.row}>
      <View style={[glyph.dot, { backgroundColor: props.color }]} />
      <View style={[glyph.link, { backgroundColor: props.color }]} />
      <View style={[glyph.dot, { backgroundColor: props.color }]} />
      <View style={[glyph.link, { backgroundColor: props.color }]} />
      <View style={[glyph.dot, { backgroundColor: props.color }]} />
    </View>
  );
}

function SchedGlyph(props: { color: string }) {
  return (
    <View style={[glyph.ring, { borderColor: props.color }]}>
      <View style={[glyph.bead, { backgroundColor: props.color }]} />
    </View>
  );
}

export function HomeScreen(props: {
  library: Library;
  examples: Flow[];
  refreshKey: number;
  onRun: (flow: Flow) => void;
  onNew: (topology: Topology) => void;
  onEdit: (flow: Flow) => void;
  onExport: (flow: Flow) => void;
  onInsight: (flow: Flow) => void;
  onImport: () => void;
  onGenerate: () => void;
  onSettings: () => void;
}) {
  const c = paletteFor(useAppScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [mine, setMine] = useState<Flow[]>([]);

  const reload = (): void => {
    props.library.list().then(setMine).catch(() => {});
  };
  useEffect(reload, [props.refreshKey]);

  const del = (id: string): void => {
    props.library.remove(id).then(reload).catch(() => {});
  };

  const now = Date.now();
  const today = new Date(now);

  // 接下来：所有可见日程型 flow 的最近一次提醒（我的优先，无则看示例）
  const upNext = useMemo(() => {
    const mineSched = mine.filter((f) => f.topology === 'scheduled');
    const pool = mineSched.length > 0 ? mineSched : props.examples.filter((f) => f.topology === 'scheduled');
    let best: { flow: Flow; occ: ScheduledOccurrence } | null = null;
    for (const flow of pool) {
      const [occ] = nextEvents(flow, now, timeZoneForFlow(flow, systemTimeZone), MS_PER_DAY);
      if (occ && (!best || occ.at < best.occ.at)) best = { flow, occ };
    }
    return best;
  }, [mine, props.examples, props.refreshKey]);

  const card = (flow: Flow, own: boolean) => (
    <View key={flow.id} style={styles.card}>
      <View style={[styles.stripe, { backgroundColor: stripeOf(flow.id) }]} />
      <Pressable onPress={() => props.onRun(flow)}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle}>{flow.title}</Text>
          <View style={styles.badge}>
            {flow.topology === 'sequential' ? (
              <SeqGlyph color={c.textMuted} />
            ) : (
              <SchedGlyph color={c.textMuted} />
            )}
            {own ? <Text style={styles.badgeText}>v{flow.version ?? 1}</Text> : null}
          </View>
        </View>
        {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
        <Text style={styles.cardMeta}>{t.cardMeta(flow.nodes.length, flow.topology)}</Text>
      </Pressable>
      <View style={styles.rowActions}>
        <Pressable onPress={() => props.onInsight(flow)}><Text style={styles.link}>{t.linkInsight}</Text></Pressable>
        {own ? (
          <>
            <Pressable onPress={() => props.onEdit(flow)}><Text style={styles.link}>{t.linkEdit}</Text></Pressable>
            <Pressable onPress={() => props.onExport(flow)}><Text style={styles.link}>{t.linkShare}</Text></Pressable>
            <Pressable onPress={() => del(flow.id)}><Text style={[styles.link, styles.danger]}>{t.delete}</Text></Pressable>
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t.brand}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.date}>
            {t.headerDate(today.getMonth() + 1, today.getDate(), today.getDay())}
          </Text>
          <Pressable onPress={props.onSettings} hitSlop={12} accessibilityLabel={t.settingsTitle}>
            <Text style={styles.gear}>⚙︎</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {upNext ? (
          <Pressable style={styles.next} onPress={() => props.onRun(upNext.flow)}>
            <Text style={styles.nextTime}>{fmtTimeOfDay(timeOfDay(upNext.occ.at, systemTimeZone))}</Text>
            <View style={styles.nextBody}>
              <Text style={styles.nextKicker}>{t.upNext}</Text>
              <Text style={styles.nextLabel} numberOfLines={1}>{upNext.occ.label}</Text>
              <Text style={styles.nextFlow} numberOfLines={1}>{upNext.flow.title}</Text>
            </View>
            <Text style={styles.nextGo}>›</Text>
          </Pressable>
        ) : null}

        {/* 创建入口带一行微文案：拓扑的选择要在按下之前就知情（选后不可切换） */}
        <View style={styles.creates}>
          <Pressable style={styles.create} onPress={() => props.onNew('sequential')}>
            <Text style={styles.createTitle}>{t.newSequential}</Text>
            <Text style={styles.createHint}>{t.newSequentialHint}</Text>
          </Pressable>
          <Pressable style={styles.create} onPress={() => props.onNew('scheduled')}>
            <Text style={styles.createTitle}>{t.newScheduled}</Text>
            <Text style={styles.createHint}>{t.newScheduledHint}</Text>
          </Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onGenerate}>
            <Text style={styles.actionGhostText}>{t.aiGenerate}</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onImport}>
            <Text style={styles.actionGhostText}>{t.importAction}</Text>
          </Pressable>
        </View>

        {mine.length > 0 ? (
          <>
            <Text style={styles.sectionKicker}>{t.sectionMine}</Text>
            {mine.map((f) => card(f, true))}
          </>
        ) : null}

        <Text style={styles.sectionKicker}>{t.sectionExamples}</Text>
        {props.examples.map((f) => card(f, false))}
      </ScrollView>
    </View>
  );
}

const glyph = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  link: { width: 6, height: 1.5 },
  ring: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, alignItems: 'center' },
  bead: { width: 5, height: 5, borderRadius: 2.5, marginTop: -3 },
});

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  brand: { fontSize: type.display, fontWeight: '800', color: c.text, letterSpacing: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  date: { fontSize: type.body - 1, color: c.textMuted, fontVariant: ['tabular-nums'] },
  gear: { fontSize: 20, color: c.textMuted },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  next: {
    backgroundColor: dark.bg, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  nextTime: {
    fontSize: type.display, fontFamily: mono.thin, color: dark.text,
    fontVariant: ['tabular-nums'], letterSpacing: 1,
  },
  nextBody: { flex: 1 },
  nextKicker: { fontSize: type.caption, color: dark.accent, letterSpacing: 2 },
  nextLabel: { fontSize: type.emphasis, fontWeight: '600', color: dark.text, marginTop: 2 },
  nextFlow: { fontSize: type.caption + 1, color: dark.textMuted, marginTop: 1 },
  nextGo: { fontSize: 28, color: dark.textMuted, fontWeight: '300' },

  creates: { flexDirection: 'row', gap: spacing.sm },
  create: {
    flex: 1, backgroundColor: c.accent, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: 2,
  },
  createTitle: { color: c.accentText, fontSize: 15, fontWeight: '700' },
  createHint: { color: c.accentText, opacity: 0.8, fontSize: type.caption },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    backgroundColor: c.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actionGhost: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  actionGhostText: { color: c.text, fontSize: 14, fontWeight: '600' },
  sectionKicker: {
    fontSize: type.caption + 1, color: c.textMuted, letterSpacing: 2,
    marginLeft: spacing.xs, marginTop: spacing.sm,
  },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    padding: spacing.lg, gap: spacing.xs, overflow: 'hidden',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, opacity: 0.8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: type.title - 2, fontWeight: '700', color: c.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badgeText: { fontSize: type.caption, color: c.textMuted },
  cardDesc: { fontSize: type.body - 1, color: c.textMuted },
  cardMeta: { fontSize: type.caption + 1, color: c.textMuted, marginTop: spacing.xs },
  rowActions: {
    flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: spacing.sm,
  },
  link: { fontSize: 14, color: c.accent, fontWeight: '600' },
  danger: { color: c.warn },
});
