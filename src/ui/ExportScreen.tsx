// 导出/分享一个 Flow 为开放格式 JSON（E5：可读、可 diff、可拥有 C6）。
// Web 上复制到剪贴板；原生上唤起系统分享。

import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, Share } from 'react-native';
import { type Flow } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { colors, spacing, radius } from './theme';

async function shareText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    if (nav?.clipboard) {
      await nav.clipboard.writeText(text);
      return true;
    }
    return false;
  }
  await Share.share({ message: text });
  return true;
}

export function ExportScreen(props: { flow: Flow; onDone: () => void }) {
  const json = serializeFlow(props.flow);
  const [copied, setCopied] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onDone} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable>
        <Text style={styles.title}>导出 · 分享</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>这是一份开放格式的 flow，可复制、分享、备份或用文本导入到别处。</Text>
        <TextInput style={styles.json} value={json} editable={false} multiline selectTextOnFocus />
        <Pressable
          style={styles.primary}
          onPress={() => shareText(json).then(setCopied).catch(() => setCopied(false))}
        >
          <Text style={styles.primaryText}>{Platform.OS === 'web' ? (copied ? '已复制 ✓' : '复制到剪贴板') : '分享'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  back: { fontSize: 16, color: colors.accent, width: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text },
  content: { padding: spacing.md, gap: spacing.md },
  hint: { fontSize: 14, color: colors.textMuted },
  json: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: 12, color: colors.text, minHeight: 260,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  primaryText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
});
