// 分享 / 导出一个 Flow。
// 社交面：可读文案（解读 + 「为什么」+ 免责）+ 可导入数据，一键唤起系统分享（微信/邮件…）；
// 数据面：开放格式 JSON（E5，可拥有 C6）。署名进入 provenance（E6 来源标注）。

import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { type Flow } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { buildShareText, buildSharePayload, dataDivider } from '../sharing/share';
import { type Sharer, type ShareOutcome } from '../sharing/sharer';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { useAppScheme } from './settings-context';
import { paletteFor, type Palette, spacing, radius } from './theme';

const outcomeText = (t: Strings): Record<ShareOutcome, string> => ({
  shared: t.shareOutcomeShared,
  copied: t.shareOutcomeCopied,
  unavailable: t.shareOutcomeUnavailable,
});

export function ExportScreen(props: { flow: Flow; sharer: Sharer; onDone: () => void }) {
  const c = paletteFor(useAppScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { locale, t } = useI18n();
  const [author, setAuthor] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const shareText = useMemo(() => buildShareText(props.flow, { author, locale }), [props.flow, author, locale]);
  const json = useMemo(() => serializeFlow(buildSharePayload(props.flow, { author })), [props.flow, author]);
  const readable = shareText.slice(0, shareText.indexOf(dataDivider(locale)));

  const send = (message: string): void => {
    props.sharer
      .share({ title: props.flow.title, message })
      .then((outcome) => setFeedback(outcomeText(t)[outcome]))
      .catch(() => setFeedback(null)); // 用户取消等——不打扰
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onDone} hitSlop={12}><Text style={styles.back}>{t.back}</Text></Pressable>
        <Text style={styles.title}>{t.exportTitle}</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t.exportHint}</Text>
        <TextInput
          style={styles.field}
          value={author}
          onChangeText={setAuthor}
          placeholder={t.exportAuthor}
          placeholderTextColor={c.pending}
        />

        <Text style={styles.sectionKicker}>{t.exportPreview}</Text>
        <Text style={styles.preview}>{readable.trimEnd()}</Text>

        <Pressable style={styles.primary} onPress={() => send(shareText)}>
          <Text style={styles.primaryText}>{t.exportShareFull}</Text>
        </Pressable>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

        <Text style={styles.sectionKicker}>{t.exportDataOnly}</Text>
        <TextInput style={styles.json} value={json} editable={false} multiline selectTextOnFocus />
        <Pressable style={[styles.primary, styles.secondary]} onPress={() => send(json)}>
          <Text style={styles.secondaryText}>{t.exportShareData}</Text>
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
  field: {
    backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, color: c.text,
  },
  sectionKicker: { fontSize: 13, color: c.textMuted, letterSpacing: 2, marginLeft: spacing.xs },
  preview: {
    backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, fontSize: 14, color: c.text, lineHeight: 21,
  },
  json: {
    backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, fontSize: 12, color: c.textMuted, minHeight: 160,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primary: { backgroundColor: c.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryText: { color: c.accentText, fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  secondaryText: { color: c.text, fontSize: 15, fontWeight: '600' },
  feedback: { color: c.accent, fontSize: 14, textAlign: 'center' },
});
