// 导入一个 Flow：粘贴开放格式 JSON → 校验 → 保存到库（登记来源时间）。

import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
import { type Library } from '../session/library';
import { extractFlowJson } from '../sharing/share';
import { useI18n } from './i18n';
import { paletteFor, type Palette, spacing, radius } from './theme';

export function ImportScreen(props: { library: Library; onImported: (f: Flow) => void; onCancel: () => void }) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doImport = (): void => {
    // 既接受纯 JSON，也接受「分享全文」（任何语言）——从中提取数据部分再导入。
    const json = extractFlowJson(text);
    if (!json) {
      setError(t.importNotFound);
      return;
    }
    props.library
      .importFlow(json, Date.now())
      .then(props.onImported)
      .catch((e) => setError(String(e)));
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onCancel} hitSlop={12}><Text style={styles.back}>{t.back}</Text></Pressable>
        <Text style={styles.title}>{t.importTitle}</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t.importHint}</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => { setText(t); setError(null); }}
          placeholder='{ "schemaVersion": 1, ... }'
          placeholderTextColor={c.pending}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={[styles.primary, !text && styles.primaryOff]} onPress={text ? doImport : undefined}>
          <Text style={styles.primaryText}>{t.importConfirm}</Text>
        </Pressable>
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
  content: { padding: spacing.md, gap: spacing.md },
  hint: { fontSize: 14, color: c.textMuted },
  input: {
    backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, fontSize: 13, color: c.text, minHeight: 220, textAlignVertical: 'top',
  },
  error: { color: c.warn, fontSize: 14 },
  primary: { backgroundColor: c.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: c.accentText, fontSize: 16, fontWeight: '700' },
});
