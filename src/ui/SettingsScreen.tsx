// 设置：语言与外观的用户覆盖（缺省跟随系统）+ 数据区（整库备份导出，C6 的正式入口）。
// 选项即点即存即生效；「跟随系统」= 清掉覆盖字段（settings 的缺省语义）。
// 面板只承载已存在的能力，不引入新概念（Constraint 0）。

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Library } from '../session/library';
import { type Sharer, type ShareOutcome } from '../sharing/sharer';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/locale';
import { useI18n } from './i18n';
import { useSettings, useAppScheme } from './settings-context';
import { paletteFor, type Palette, spacing, radius, type } from './theme';

/** 语言自称——不随界面语言翻译，用户在陌生语言下也能认出自己的母语。 */
const LOCALE_NAMES: Record<Locale, string> = { zh: '简体中文', 'zh-Hant': '繁體中文', en: 'English' };

export function SettingsScreen(props: { library: Library; sharer: Sharer; onBack: () => void }) {
  const c = paletteFor(useAppScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [backupNote, setBackupNote] = useState<string | null>(null);

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

  const choice = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={key} style={[styles.choice, selected && styles.choiceOn]} onPress={onPress}>
      <Text style={selected ? styles.choiceTextOn : styles.choiceText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} hitSlop={12}><Text style={styles.back}>{t.back}</Text></Pressable>
        <Text style={styles.title}>{t.settingsTitle}</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>{t.settingsLanguage}</Text>
        <View style={styles.choices}>
          {choice('system', t.followSystem, settings.locale === undefined, () => update({ ...settings, locale: undefined }))}
          {SUPPORTED_LOCALES.map((l) =>
            choice(l, LOCALE_NAMES[l], settings.locale === l, () => update({ ...settings, locale: l })),
          )}
        </View>

        <Text style={styles.kicker}>{t.settingsAppearance}</Text>
        <View style={styles.choices}>
          {choice('system', t.followSystem, settings.appearance === undefined, () => update({ ...settings, appearance: undefined }))}
          {choice('light', t.appearanceLight, settings.appearance === 'light', () => update({ ...settings, appearance: 'light' }))}
          {choice('dark', t.appearanceDark, settings.appearance === 'dark', () => update({ ...settings, appearance: 'dark' }))}
        </View>

        <Text style={styles.kicker}>{t.settingsData}</Text>
        <View style={styles.choices}>
          {choice('backup', t.backupAction, false, backup)}
        </View>
        {backupNote ? <Text style={styles.note}>{backupNote}</Text> : null}
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
  content: { padding: spacing.md, gap: spacing.sm },
  kicker: {
    fontSize: type.caption, color: c.textMuted, letterSpacing: 2, textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  choiceOn: { backgroundColor: c.accent, borderColor: c.accent },
  choiceText: { color: c.text, fontSize: 14, fontWeight: '600' },
  choiceTextOn: { color: c.accentText, fontSize: 14, fontWeight: '700' },
  note: { fontSize: 13, color: c.accent, marginLeft: spacing.xs },
});
