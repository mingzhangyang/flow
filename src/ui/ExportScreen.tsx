// 分享 / 导出一个 Flow。
// 社交面：可读文案（解读 + 「为什么」+ 免责）+ 可导入数据，一键唤起系统分享（微信/邮件…）；
// 数据面：开放格式 JSON（E5，可拥有 C6）。署名进入 provenance（E6 来源标注）。

import { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
import { serializeFlow } from '../domain/serialize';
import { buildShareText, buildSharePayload, dataDivider } from '../sharing/share';
import { type Sharer, type ShareOutcome } from '../sharing/sharer';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { paletteFor, type Palette, spacing, radius } from './theme';
import { HeaderBackButton, HeaderSideSpacer, mobileHitTarget } from './mobileControls';
import { MotionPressable } from './MotionPressable';

const outcomeText = (t: Strings): Record<ShareOutcome, string> => ({
  shared: t.shareOutcomeShared,
  copied: t.shareOutcomeCopied,
  unavailable: t.shareOutcomeUnavailable,
});

export function ExportScreen(props: { flow: Flow; sharer: Sharer; onDone: () => void }) {
  const c = paletteFor(useColorScheme());
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
        <HeaderBackButton accessibilityLabel={t.back} color={c.primary} onPress={props.onDone} />
        <Text style={styles.title} numberOfLines={1}>{t.exportTitle}</Text>
        <HeaderSideSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
        <Text style={styles.hint}>{t.exportHint}</Text>
        <TextInput
          style={styles.field}
          value={author}
          onChangeText={setAuthor}
          placeholder={t.exportAuthor}
          placeholderTextColor={c.textFaint}
        />

        <Text style={styles.sectionKicker}>{t.exportPreview}</Text>
        <Text style={styles.preview}>{readable.trimEnd()}</Text>

        <MotionPressable accessibilityRole="button" style={[mobileHitTarget.standard, styles.primary]} onPress={() => send(shareText)}>
          <Text style={styles.primaryText}>{t.exportShareFull}</Text>
        </MotionPressable>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

        <Text style={styles.sectionKicker}>{t.exportDataOnly}</Text>
        <TextInput style={styles.json} value={json} editable={false} multiline selectTextOnFocus />
        <MotionPressable accessibilityRole="button" style={[mobileHitTarget.standard, styles.primary, styles.secondary]} onPress={() => send(json)}>
          <Text style={styles.secondaryText}>{t.exportShareData}</Text>
        </MotionPressable>
      </ScrollView>
    </View>
  );
}

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  title: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 16, fontWeight: '600', color: c.text },
  content: { flexGrow: 1, padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hint: { fontSize: 14, color: c.textMuted },
  field: {
    minHeight: mobileHitTarget.compact.minHeight,
    backgroundColor: c.inputSurface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, color: c.text,
  },
  sectionKicker: { fontSize: 13, color: c.textFaint, letterSpacing: 2, marginLeft: spacing.xs },
  preview: {
    backgroundColor: c.surfaceRaised, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    padding: spacing.md, fontSize: 14, color: c.text, lineHeight: 21,
  },
  json: {
    backgroundColor: c.surfaceSubtle, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    padding: spacing.md, fontSize: 12, color: c.textMuted, minHeight: 160,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primary: { backgroundColor: c.primary, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: c.secondarySoft, borderWidth: 1, borderColor: c.secondary },
  secondaryText: { color: c.secondary, fontSize: 15, fontWeight: '600' },
  feedback: { color: c.success, fontSize: 14, textAlign: 'center' },
});
