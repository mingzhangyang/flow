// 首页：先回答「此刻该干嘛」（接下来块），再是 flow 库（我的 + 示例）。
// 卡片带由 id 派生的低饱和色线与拓扑图形徽章，库一多也有节奏而不吵。

import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, AppState, useColorScheme } from 'react-native';
import { type Flow, type Topology } from '../domain/types';
import { type Library } from '../session/library';
import { createOperationScope } from '../session/operationScope';
import { catalogDefinitionKey, examplesVisibleAlongsideOwned, type FlowCatalogSource, type OwnedCatalogSnapshot } from '../session/flowCatalog';
import { type Sharer, type ShareOutcome } from '../sharing/sharer';
import { timeOfDay } from '../runtime/clock';
import { projectHomeTime } from '../session/homeTime';
import { createHomeClockWatch } from './homeClockWatch';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { timeZoneForFlow } from '../runtime/ianaTimeZone';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { paletteFor, flowIdentityFor, type Palette, dark, spacing, radius, type, mono } from './theme';
import { MotionPressable } from './MotionPressable';

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
  /** App-owned lifetime and deletion fence; do not infer from catalog loading. */
  deleting: boolean;
  isActive: () => boolean;
  catalog: OwnedCatalogSnapshot;
  sharer: Sharer;
  onRetry: () => void;
  onRun: (flow: Flow, definitionKey: string) => void;
  onNew: (topology: Topology) => void;
  onEdit: (flow: Flow) => void;
  onExport: (flow: Flow) => void;
  onInsight: (flow: Flow, source: FlowCatalogSource) => void;
  onDelete: (flow: Flow, definitionKey: string) => Promise<void>;
  onImport: () => void;
  onGenerate: () => void;
}) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<{ flow: Flow; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const operations = useMemo(() => createOperationScope(), []);
  useEffect(() => () => operations.close(), [operations]);
  const catalogReady = props.catalog.status === 'ready';
  const mine: Flow[] = props.catalog.status === 'ready' ? props.catalog.flows : [];
  // 整库备份（C6 兜底）：全部 flow + 历史修订 + 打卡日志，经系统分享面板存文件/发给自己。
  const backup = (): void => {
    const outcomeText: Record<ShareOutcome, string> = {
      shared: t.backupOutcomeShared,
      copied: t.backupOutcomeCopied,
      unavailable: t.backupOutcomeUnavailable,
    };
    const accepted = operations.submit(async () => {
      const text = await props.library.exportBackup(Date.now());
      // Export is a read-only background operation. Its share-sheet/clipboard
      // effect, unlike accepted data commits, requires a still-active Home.
      if (!operations.isOpen() || !props.isActive()) return null;
      return props.sharer.share({ title: t.backupShareTitle, message: text });
    }, {
      success(outcome) { if (outcome !== null) setBackupNote(outcomeText[outcome]); },
      failure(error) { setBackupNote(`${t.backupFailed}: ${String(error)}`); },
      settled() { setBusy(false); },
    });
    if (accepted) {
      setBusy(true);
      setBackupNote(null);
    }
  };
  const del = (flow: Flow): void => {
    if (!props.isActive()) return;
    const accepted = operations.submit(
      () => props.onDelete(flow, catalogDefinitionKey(flow.id, 'owned')),
      {
        success() { setDeleteIssue(null); },
        failure(error) { setDeleteIssue({ flow, message: String(error) }); },
        settled() { setBusy(false); },
      },
    );
    if (accepted) {
      setBusy(true);
      setDeleteIssue(null);
    }
  };

  const [clockSample, setClockSample] = useState(() => Date.now());
  const visibleExamples = useMemo(
    () => catalogReady ? examplesVisibleAlongsideOwned(props.examples, mine) : [],
    [catalogReady, props.examples, mine],
  );

  const run = (flow: Flow, own: boolean): void => {
    if (props.deleting) return;
    props.onRun(flow, catalogDefinitionKey(flow.id, own ? 'owned' : 'example'));
  };

  // 接下来：所有可见日程型 flow 的最近一次提醒（我的优先，无则看未被同 id 用户 Flow 遮蔽的示例）
  // Clock samples invalidate the memo only at meaningful boundaries. Catalog
  // and example changes are independent invalidations: sample current time
  // here rather than reusing a possibly hours-old clock-triggered timestamp.
  // Header and Up Next share this one snapshot, without an extra React update.
  const projection = useMemo(() => {
    const at = Date.now();
    return {
      ...projectHomeTime(catalogReady ? mine : [], catalogReady ? visibleExamples : [], at, systemTimeZone),
      at,
    };
  }, [catalogReady, mine, visibleExamples, clockSample]);
  const today = new Date(projection.at);
  const upNext = projection.upNext;

  // Clock sampling is a persistent UI adapter, not a side effect of whether
  // a React memo's refresh deadline happened to change. It re-arms itself after
  // EVERY timeout and only updates React at meaningful time/zone boundaries.
  const clockWatch = useMemo(() => createHomeClockWatch({
    now: () => Date.now(),
    zoneId: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    schedule: (callback: () => void, delay: number) => setTimeout(callback, delay),
    cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    refresh: (actual: number) => setClockSample(actual),
  }), []);

  useEffect(() => {
    clockWatch.start(projection.nextRefreshAt);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') clockWatch.foreground();
    });
    return () => {
      sub.remove();
      clockWatch.stop();
    };
  }, [clockWatch]);

  useEffect(() => {
    clockWatch.updateDeadline(projection.nextRefreshAt);
  }, [clockWatch, projection.nextRefreshAt]);

  const card = (flow: Flow, own: boolean) => {
    const tone = flowIdentityFor(c, flow.id);
    return (
    <View key={flow.id} style={[styles.card, { backgroundColor: tone.soft }]}>
      <View style={[styles.stripe, { backgroundColor: tone.accent }]} />
      <MotionPressable motion="card" disabled={props.deleting} onPress={() => run(flow, own)}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle}>{flow.title}</Text>
          <View style={styles.badge}>
            {flow.topology === 'sequential' ? (
              <SeqGlyph color={tone.accent} />
            ) : (
              <SchedGlyph color={tone.accent} />
            )}
            {own ? <Text style={styles.badgeText}>v{flow.version ?? 1}</Text> : null}
          </View>
        </View>
        {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
        <Text style={styles.cardMeta}>{t.cardMeta(flow.nodes.length, flow.topology)}</Text>
      </MotionPressable>
      <View style={styles.rowActions}>
        <Pressable disabled={props.deleting} onPress={() => props.onInsight(flow, own ? 'owned' : 'example')}><Text style={styles.link}>{t.linkInsight}</Text></Pressable>
        {own ? (
          <>
            <Pressable disabled={props.deleting} onPress={() => props.onEdit(flow)}><Text style={styles.link}>{t.linkEdit}</Text></Pressable>
            <Pressable disabled={props.deleting} onPress={() => props.onExport(flow)}><Text style={styles.link}>{t.linkShare}</Text></Pressable>
            <Pressable disabled={busy || props.deleting} onPress={() => del(flow)}>
              <Text style={[styles.link, styles.danger]}>{t.delete}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t.brand}</Text>
        <Text style={styles.date}>
          {t.headerDate(today.getMonth() + 1, today.getDate(), today.getDay())}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {deleteIssue ? (
          <View style={styles.catalogError}>
            <Text style={styles.catalogErrorText}>{t.deleteFailed}: {deleteIssue.message}</Text>
            <MotionPressable style={styles.retryButton} disabled={busy} onPress={() => del(deleteIssue.flow)}>
              <Text style={styles.retryText}>{t.retry}</Text>
            </MotionPressable>
          </View>
        ) : null}
        {props.catalog.status === 'error' ? (
          <View style={styles.catalogError}>
            <Text style={styles.catalogErrorText}>{t.catalogUnavailable}</Text>
            <MotionPressable style={styles.retryButton} disabled={props.deleting} onPress={() => props.onRetry()}>
              <Text style={styles.retryText}>{t.retry}</Text>
            </MotionPressable>
          </View>
        ) : null}

        {upNext ? (
          <MotionPressable motion="card" style={styles.next} testID="home-up-next"
            disabled={props.deleting}
            onPress={() => run(upNext.flow, upNext.own)}>
            <Text style={styles.nextTime}>{fmtTimeOfDay(timeOfDay(upNext.occ.at, timeZoneForFlow(upNext.flow, systemTimeZone)))}</Text>
            <View style={styles.nextBody}>
              <Text style={styles.nextKicker}>{t.upNext}</Text>
              <Text style={styles.nextLabel} numberOfLines={1}>{upNext.occ.label}</Text>
              <Text style={styles.nextFlow} numberOfLines={1}>{upNext.flow.title}</Text>
            </View>
            <Text style={styles.nextGo}>›</Text>
          </MotionPressable>
        ) : null}

        {catalogReady ? (
          <>
            <View style={styles.actions}>
              <MotionPressable style={styles.action} disabled={props.deleting} onPress={() => props.onNew('sequential')}>
                <Text style={styles.actionText}>{t.newSequential}</Text>
              </MotionPressable>
              <MotionPressable style={styles.action} disabled={props.deleting} onPress={() => props.onNew('scheduled')}>
                <Text style={styles.actionText}>{t.newScheduled}</Text>
              </MotionPressable>
              <MotionPressable style={[styles.action, styles.actionGhost]} disabled={props.deleting} onPress={props.onGenerate}>
                <Text style={styles.actionGhostText}>{t.aiGenerate}</Text>
              </MotionPressable>
              <MotionPressable style={[styles.action, styles.actionGhost]} disabled={props.deleting} onPress={props.onImport}>
                <Text style={styles.actionGhostText}>{t.importAction}</Text>
              </MotionPressable>
              <MotionPressable style={[styles.action, styles.actionGhost]} disabled={busy || props.deleting} onPress={backup}>
                <Text style={styles.actionGhostText}>{t.backupAction}</Text>
              </MotionPressable>
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
  screen: { flex: 1, backgroundColor: c.canvas },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  brand: { fontSize: type.display, fontWeight: '800', color: c.primary, letterSpacing: 4 },
  date: { fontSize: type.body - 1, color: c.textMuted, fontVariant: ['tabular-nums'] },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  next: {
    backgroundColor: dark.bg, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: dark.border,
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
  backupNote: { fontSize: 13, color: c.primary, marginLeft: spacing.xs },
  catalogError: {
    backgroundColor: c.dangerSoft, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.danger,
    padding: spacing.md, gap: spacing.sm,
  },
  catalogErrorText: { fontSize: 14, color: c.danger },
  retryButton: {
    alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, borderColor: c.primary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  retryText: { color: c.primary, fontSize: 14, fontWeight: '600' },
  action: {
    backgroundColor: c.primary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actionText: { color: c.onPrimary, fontSize: 14, fontWeight: '700' },
  actionGhost: { backgroundColor: c.surfaceSubtle, borderWidth: 1, borderColor: c.border },
  actionGhostText: { color: c.text, fontSize: 14, fontWeight: '600' },
  sectionKicker: {
    fontSize: type.caption + 1, color: c.textFaint, letterSpacing: 2,
    marginLeft: spacing.xs, marginTop: spacing.sm,
  },
  card: {
    backgroundColor: c.surfaceRaised, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
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
  link: { fontSize: 14, color: c.primary, fontWeight: '600' },
  danger: { color: c.danger },
});
