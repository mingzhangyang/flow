// 首页：先回答「此刻该干嘛」（接下来块），再是 flow 库（我的 + 示例）。
// 卡片带由 id 派生的低饱和色线与拓扑图形徽章，库一多也有节奏而不吵。

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { type Flow, type Topology } from '../domain/types';
import { type Library } from '../session/library';
import { examplesVisibleAlongsideOwned, reminderEnrollmentIdentity, type OwnedCatalogSnapshot } from '../session/flowCatalog';
import { type Sharer, type ShareOutcome } from '../sharing/sharer';
import { nextEvents, type ScheduledOccurrence } from '../runtime/engine';
import { timeOfDay, MS_PER_DAY } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
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
  catalog: OwnedCatalogSnapshot;
  sharer: Sharer;
  onRun: (flow: Flow, enrollmentKey: string) => void;
  onNew: (topology: Topology) => void;
  onEdit: (flow: Flow) => void;
  onExport: (flow: Flow) => void;
  onInsight: (flow: Flow) => void;
  onDelete: (flow: Flow, enrollmentKey: string, legacyEnrollmentId?: string) => Promise<void>;
  onImport: () => void;
  onGenerate: () => void;
}) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const catalogReady = props.catalog.status === 'ready';
  const mine = catalogReady ? props.catalog.flows : [];

  // 整库备份（C6 兜底）：全部 flow + 历史修订 + 打卡日志，经系统分享面板存文件/发给自己。
  const backup = (): void => {
    const outcomeText: Record<ShareOutcome, string> = {
      shared: t.backupOutcomeShared,
      copied: t.backupOutcomeCopied,
      unavailable: t.backupOutcomeUnavailable,
    };
    props.library
      .exportBackup(Date.now())
      .then((text) => props.sharer.share({ title: t.backupShareTitle, message: text }))
      .then((outcome) => setBackupNote(outcomeText[outcome]))
      .catch(() => setBackupNote(null)); // 用户取消等——不打扰
  };
  const del = (flow: Flow): void => {
    const identity = reminderEnrollmentIdentity(flow.id, 'owned', props.examples);
    props.onDelete(flow, identity.key, identity.legacyId).catch(() => {});
  };

  const now = Date.now();
  const today = new Date(now);
  const visibleExamples = useMemo(
    () => catalogReady ? examplesVisibleAlongsideOwned(props.examples, mine) : [],
    [catalogReady, props.examples, mine],
  );

  const enrollmentKeyOf = (flow: Flow, own: boolean): string =>
    reminderEnrollmentIdentity(flow.id, own ? 'owned' : 'example', props.examples).key;

  // 接下来：所有可见日程型 flow 的最近一次提醒（我的优先，无则看未被同 id 用户 Flow 遮蔽的示例）
  const upNext = useMemo(() => {
    if (!catalogReady) return null;
    const mineSched = mine.filter((f) => f.topology === 'scheduled');
    const pool = mineSched.length > 0
      ? mineSched.map((flow) => ({ flow, own: true }))
      : visibleExamples.filter((f) => f.topology === 'scheduled').map((flow) => ({ flow, own: false }));
    let best: { flow: Flow; occ: ScheduledOccurrence; own: boolean } | null = null;
    for (const candidate of pool) {
      const [occ] = nextEvents(
        candidate.flow,
        now,
        timeZoneForFlow(candidate.flow, systemTimeZone),
        MS_PER_DAY,
      );
      if (occ && (!best || occ.at < best.occ.at)) best = { ...candidate, occ };
    }
    return best;
  }, [catalogReady, mine, visibleExamples]);

  const card = (flow: Flow, own: boolean) => (
    <View key={flow.id} style={styles.card}>
      <View style={[styles.stripe, { backgroundColor: stripeOf(flow.id) }]} />
      <Pressable onPress={() => props.onRun(flow, enrollmentKeyOf(flow, own))}>
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
            <Pressable onPress={() => del(flow)}><Text style={[styles.link, styles.danger]}>{t.delete}</Text></Pressable>
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t.brand}</Text>
        <Text style={styles.date}>
          {t.headerDate(today.getMonth() + 1, today.getDate(), today.getDay())}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {upNext ? (
          <Pressable style={styles.next} onPress={() => props.onRun(upNext.flow, enrollmentKeyOf(upNext.flow, upNext.own))}>
            <Text style={styles.nextTime}>{fmtTimeOfDay(timeOfDay(upNext.occ.at, systemTimeZone))}</Text>
            <View style={styles.nextBody}>
              <Text style={styles.nextKicker}>{t.upNext}</Text>
              <Text style={styles.nextLabel} numberOfLines={1}>{upNext.occ.label}</Text>
              <Text style={styles.nextFlow} numberOfLines={1}>{upNext.flow.title}</Text>
            </View>
            <Text style={styles.nextGo}>›</Text>
          </Pressable>
        ) : null}

        {catalogReady ? (
          <>
            <View style={styles.actions}>
              <Pressable style={styles.action} onPress={() => props.onNew('sequential')}>
                <Text style={styles.actionText}>{t.newSequential}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => props.onNew('scheduled')}>
                <Text style={styles.actionText}>{t.newScheduled}</Text>
              </Pressable>
              <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onGenerate}>
                <Text style={styles.actionGhostText}>{t.aiGenerate}</Text>
              </Pressable>
              <Pressable style={[styles.action, styles.actionGhost]} onPress={props.onImport}>
                <Text style={styles.actionGhostText}>{t.importAction}</Text>
              </Pressable>
              <Pressable style={[styles.action, styles.actionGhost]} onPress={backup}>
                <Text style={styles.actionGhostText}>{t.backupAction}</Text>
              </Pressable>
            </View>
            {backupNote ? <Text style={styles.backupNote}>{backupNote}</Text> : null}

            {mine.length > 0 ? (
              <>
                <Text style={styles.sectionKicker}>{t.sectionMine}</Text>
                {mine.map((f) => card(f, true))}
              </>
            ) : null}

            <Text style={styles.sectionKicker}>{t.sectionExamples}</Text>
            {visibleExamples.map((f) => card(f, false))}
          </>
        ) : null}
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
  date: { fontSize: type.body - 1, color: c.textMuted, fontVariant: ['tabular-nums'] },
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

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  backupNote: { fontSize: 13, color: c.accent, marginLeft: spacing.xs },
  action: {
    backgroundColor: c.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actionText: { color: c.accentText, fontSize: 14, fontWeight: '700' },
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
