// AI 助手（离线解释器版本）。严格按 AI-C4 的能力顺序：解读 → 洞察/瓶颈 → 版本对比。
// AI 永远只“提议与解释”，由用户决定（AI-C1）；任何改动都能先看差异、可回退（AI-C3）。
// 不调用任何外部模型——全部由本地纯函数生成。

import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
import { type Library } from '../session/library';
import { explain } from '../ai/explain';
import { analyze, type Finding } from '../ai/analyze';
import { diffFlows, describeChange, type Change } from '../ai/diff';
import { useI18n } from './i18n';
import { paletteFor, type Palette, spacing, radius } from './theme';

export function InsightScreen(props: { flow: Flow; library: Library; onExit: () => void; onChanged: () => void }) {
  const { flow } = props;
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { locale, t } = useI18n();
  const [previous, setPrevious] = useState<Flow | null>(null);

  useEffect(() => {
    let alive = true;
    props.library
      .revisions(flow.id)
      .then((revs) => alive && setPrevious(revs.length > 0 ? revs[revs.length - 1] : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [flow]);

  const lines = explain(flow, locale);
  const findings = analyze(flow, locale);
  const changes: Change[] = previous ? diffFlows(previous, flow) : [];

  const restore = (): void => {
    if (!previous) return;
    props.library.restore(previous).then(props.onChanged).catch(() => {});
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onExit} hitSlop={12}><Text style={styles.back}>{t.back}</Text></Pressable>
        <Text style={styles.title}>{t.insightTitle}</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionKicker}>{t.insightReading}</Text>
        <View style={styles.card}>
          {lines.map((l, i) => (
            <Text key={i} style={i === 0 ? styles.lead : styles.line}>{l}</Text>
          ))}
        </View>

        <Text style={styles.sectionKicker}>{t.insightFindings}</Text>
        <View style={styles.card}>
          {findings.length === 0 ? (
            <Text style={styles.line}>{t.insightNoFindings}</Text>
          ) : (
            findings.map((f: Finding) => (
              <View key={f.id} style={styles.finding}>
                <View style={[styles.dot, f.severity === 'warn' ? styles.dotWarn : styles.dotInfo]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.findingTitle}>{f.title}</Text>
                  <Text style={styles.findingDetail}>{f.detail}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {previous ? (
          <>
            <Text style={styles.sectionKicker}>{t.insightDiffTitle(previous.version ?? 1)}</Text>
            <View style={styles.card}>
              {changes.length === 0 ? (
                <Text style={styles.line}>{t.insightNoDiff}</Text>
              ) : (
                changes.map((c, i) => <Text key={i} style={styles.change}>{describeChange(c, locale)}</Text>)
              )}
              <Pressable style={styles.restore} onPress={restore}>
                <Text style={styles.restoreText}>{t.insightRestore}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Text style={styles.note}>{t.insightNote}</Text>
      </ScrollView>
    </View>
  );
}

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: c.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: c.text },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  sectionKicker: { fontSize: 13, color: c.textMuted, letterSpacing: 2, marginLeft: spacing.xs, marginTop: spacing.sm },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, gap: spacing.xs,
  },
  lead: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: spacing.xs },
  line: { fontSize: 14, color: c.text, lineHeight: 21 },
  finding: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotWarn: { backgroundColor: c.warn },
  dotInfo: { backgroundColor: c.accent },
  findingTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  findingDetail: { fontSize: 13, color: c.textMuted, lineHeight: 19, marginTop: 2 },
  change: { fontSize: 14, color: c.text, paddingVertical: 2 },
  restore: {
    marginTop: spacing.sm, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: c.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  restoreText: { color: c.accent, fontSize: 14, fontWeight: '600' },
  note: { fontSize: 12, color: c.textMuted, marginTop: spacing.md, lineHeight: 18 },
});
