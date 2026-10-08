// 导入：粘贴单条 flow（开放格式 JSON / 分享全文）或整库备份 → 校验 → 入库。
// 备份自动识别（parseBackup），恢复时绝不覆盖本机数据（C6）。

import { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
import { parseBackup, type Backup } from '../storage/backup';
import { extractFlowJson } from '../sharing/share';
import { createOperationScope } from '../session/operationScope';
import { useI18n } from './i18n';
import { paletteFor, type Palette, spacing, radius } from './theme';
import { HeaderBackButton, HeaderSideSpacer } from './mobileControls';
import { MotionPressable } from './MotionPressable';

export function ImportScreen(props: {
  importFlow: (text: string, now: number) => Promise<Flow>;
  importBackup: (backup: Backup) => Promise<number>;
  onImported: () => void;
  onCancel: () => void;
}) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useMemo(() => createOperationScope(), []);
  useEffect(() => () => operation.close(), [operation]);
  // 整库备份自动识别：是备份就整库恢复，否则按单条 flow 走
  const backup = useMemo(() => parseBackup(text), [text]);

  const doImport = (): void => {
    // Capture a single intent. A committed import is never cancelled mid-write:
    // navigating away only revokes this page's right to consume its result.
    const selectedBackup = backup;
    const json = selectedBackup ? null : extractFlowJson(text);
    if (!selectedBackup && !json) {
      setError(t.importNotFound);
      return;
    }
    const accepted = operation.submit(
      () => selectedBackup ? props.importBackup(selectedBackup) : props.importFlow(json!, Date.now()),
      {
        success: () => props.onImported(),
        failure: (error) => setError(String(error)),
        settled: () => setBusy(false),
      },
    );
    if (accepted) {
      setBusy(true);
      setError(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <HeaderBackButton accessibilityLabel={t.back} color={c.primary}
          onPress={() => { operation.close(); props.onCancel(); }} />
        <Text style={styles.title} numberOfLines={1}>{t.importTitle}</Text>
        <HeaderSideSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t.importHint}</Text>
        <TextInput
          style={styles.input}
          value={text}
          editable={!busy}
          onChangeText={(t) => { setText(t); setError(null); }}
          placeholder='{ "schemaVersion": 1, ... }'
          placeholderTextColor={c.textFaint}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        {backup ? <Text style={styles.backupNote}>{t.importBackupDetected(backup.flows.length)}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <MotionPressable
          style={[styles.primary, (!text || busy) && styles.primaryOff]}
          disabled={!text || busy}
          accessibilityState={{ disabled: !text || busy }}
          onPress={doImport}
        >
          <Text style={styles.primaryText}>{busy ? t.importBusy : t.importConfirm}</Text>
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
  content: { padding: spacing.md, gap: spacing.md },
  hint: { fontSize: 14, color: c.textMuted },
  input: {
    backgroundColor: c.inputSurface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, fontSize: 13, color: c.text, minHeight: 220, textAlignVertical: 'top',
  },
  backupNote: { color: c.success, fontSize: 14 },
  error: { color: c.danger, fontSize: 14 },
  primary: { backgroundColor: c.primary, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },
});
