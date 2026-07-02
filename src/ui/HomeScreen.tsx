// 首页：我的 flow 库 + 内置示例。可新建、导入；对自建 flow 可运行/编辑/导出/删除。

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow, type Topology } from '../domain/types';
import { type Library } from '../session/library';
import { colors, spacing, radius } from './theme';

const topologyLabel: Record<Topology, string> = { sequential: '顺序', scheduled: '日程' };

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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>准时</Text>
        <Text style={styles.tagline}>把时间模式变成可运行的 flow</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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
            {mine.map((flow) => (
              <View key={flow.id} style={styles.card}>
                <Pressable onPress={() => props.onRun(flow)}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{flow.title}</Text>
                    <Text style={styles.badge}>{topologyLabel[flow.topology]} · v{flow.version ?? 1}</Text>
                  </View>
                  {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
                  <Text style={styles.cardMeta}>{flow.nodes.length} 步 ·  点按运行</Text>
                </Pressable>
                <View style={styles.rowActions}>
                  <Pressable onPress={() => props.onInsight(flow)}><Text style={styles.link}>解读</Text></Pressable>
                  <Pressable onPress={() => props.onEdit(flow)}><Text style={styles.link}>编辑</Text></Pressable>
                  <Pressable onPress={() => props.onExport(flow)}><Text style={styles.link}>导出</Text></Pressable>
                  <Pressable onPress={() => del(flow.id)}><Text style={[styles.link, styles.danger]}>删除</Text></Pressable>
                </View>
              </View>
            ))}
          </>
        ) : null}

        <Text style={styles.sectionKicker}>示例</Text>
        {props.examples.map((flow) => (
          <View key={flow.id} style={styles.card}>
            <Pressable onPress={() => props.onRun(flow)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{flow.title}</Text>
                <Text style={styles.badge}>{topologyLabel[flow.topology]}</Text>
              </View>
              {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
              <Text style={styles.cardMeta}>{flow.nodes.length} 步 ·  点按运行</Text>
            </Pressable>
            <View style={styles.rowActions}>
              <Pressable onPress={() => props.onInsight(flow)}><Text style={styles.link}>解读</Text></Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  brand: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: 2 },
  tagline: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  content: { padding: spacing.md, gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actionText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },
  actionGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionGhostText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sectionKicker: { fontSize: 13, color: colors.textMuted, letterSpacing: 1, marginLeft: spacing.xs, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  badge: {
    fontSize: 12, color: colors.textMuted, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden',
  },
  cardDesc: { fontSize: 14, color: colors.textMuted },
  cardMeta: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  rowActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  link: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  danger: { color: colors.warn },
});
