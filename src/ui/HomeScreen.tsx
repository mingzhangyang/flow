// 首页：Flow 列表。点一条即进入运行/日程视图。

import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow } from '../domain/types';
import { colors, spacing, radius } from './theme';

const topologyLabel: Record<Flow['topology'], string> = {
  sequential: '顺序',
  scheduled: '日程',
};

export function HomeScreen(props: { flows: Flow[]; onOpen: (flow: Flow) => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>准时</Text>
        <Text style={styles.tagline}>把时间模式变成可运行的 flow</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {props.flows.map((flow) => (
          <Pressable key={flow.id} style={styles.card} onPress={() => props.onOpen(flow)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{flow.title}</Text>
              <Text style={styles.badge}>{topologyLabel[flow.topology]}</Text>
            </View>
            {flow.description ? <Text style={styles.cardDesc}>{flow.description}</Text> : null}
            <Text style={styles.cardMeta}>{flow.nodes.length} 步 ·  点按开始</Text>
          </Pressable>
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
});
