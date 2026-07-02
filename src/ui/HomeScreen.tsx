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
import { colors, dark, spacing, radius, type, mono } from './theme';

/** 卡片色线的低饱和候选色；由 flow id 稳定派生。 */
const STRIPES = ['#7A9E87', '#C2915C', '#8B9DB0', '#B08B9B', '#9AA05F', '#7FA6A0'];
function stripeOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STRIPES[h % STRIPES.length];
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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
}) {
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
              <SeqGlyph color={colors.textMuted} />
            ) : (
              <SchedGlyph color={colors.textMuted} />
            )}
            {own ? <Text style={styles.badgeText}>v{flow.version ?? 1}</Text> : null}
          </View>
        </View>
        {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
        <Text style={styles.cardMeta}>
          {flow.nodes.length} {flow.topology === 'sequential' ? '步' : '个时刻'} · 点按运行
        </Text>
      </Pressable>
      <View style={styles.rowActions}>
        <Pressable onPress={() => props.onInsight(flow)}><Text style={styles.link}>解读</Text></Pressable>
        {own ? (
          <>
            <Pressable onPress={() => props.onEdit(flow)}><Text style={styles.link}>编辑</Text></Pressable>
            <Pressable onPress={() => props.onExport(flow)}><Text style={styles.link}>分享</Text></Pressable>
            <Pressable onPress={() => del(flow.id)}><Text style={[styles.link, styles.danger]}>删除</Text></Pressable>
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>准时</Text>
        <Text style={styles.date}>
          {today.getMonth() + 1} 月 {today.getDate()} 日 · 周{WEEKDAYS[today.getDay()]}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {upNext ? (
          <Pressable style={styles.next} onPress={() => props.onRun(upNext.flow)}>
            <Text style={styles.nextTime}>{fmtTimeOfDay(timeOfDay(upNext.occ.at, systemTimeZone))}</Text>
            <View style={styles.nextBody}>
              <Text style={styles.nextKicker}>接下来</Text>
              <Text style={styles.nextLabel} numberOfLines={1}>{upNext.occ.label}</Text>
              <Text style={styles.nextFlow} numberOfLines={1}>{upNext.flow.title}</Text>
            </View>
            <Text style={styles.nextGo}>›</Text>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={() => props.onNew('sequential')}>
            <Text style={styles.actionText}>＋ 顺序</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => props.onNew('scheduled')}>
            <Text style={styles.actionText}>＋ 日程</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onGenerate}>
            <Text style={styles.actionGhostText}>✨ AI 生成</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onImport}>
            <Text style={styles.actionGhostText}>导入</Text>
          </Pressable>
        </View>

        {mine.length > 0 ? (
          <>
            <Text style={styles.sectionKicker}>我的</Text>
            {mine.map((f) => card(f, true))}
          </>
        ) : null}

        <Text style={styles.sectionKicker}>示例</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  brand: { fontSize: type.display, fontWeight: '800', color: colors.text, letterSpacing: 4 },
  date: { fontSize: type.body - 1, color: colors.textMuted, fontVariant: ['tabular-nums'] },
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

  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actionText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },
  actionGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionGhostText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sectionKicker: {
    fontSize: type.caption + 1, color: colors.textMuted, letterSpacing: 2,
    marginLeft: spacing.xs, marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.xs, overflow: 'hidden',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, opacity: 0.8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: type.title - 2, fontWeight: '700', color: colors.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badgeText: { fontSize: type.caption, color: colors.textMuted },
  cardDesc: { fontSize: type.body - 1, color: colors.textMuted },
  cardMeta: { fontSize: type.caption + 1, color: colors.textMuted, marginTop: spacing.xs },
  rowActions: {
    flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm,
  },
  link: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  danger: { color: colors.warn },
});
