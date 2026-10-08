// AI 生成：自然语言描述 → 任意模型供应商（ModelPort）→ Flow 草稿 → 编辑器审阅。
// 生成结果不直接入库：用户在编辑器里确认后保存为新版本（AI-C1 用户决定、AI-C3 可 Diff/Undo）。
// 供应商可切换：Anthropic（Claude）或任何 OpenAI 兼容端点；配置与密钥只存本机（C6）。

import { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, useColorScheme } from 'react-native';
import { type Flow } from '../domain/types';
import { generateFlow } from '../ai/generate';
import { createOperationScope } from '../session/operationScope';
import {
  createModelPort,
  OPENAI_COMPATIBLE_PRESETS,
  type ModelProviderConfig,
  type ProviderKind,
} from '../ai/model/providers';
import { ANTHROPIC_DEFAULT_MODEL } from '../ai/model/anthropic';
import { type ModelConfigSession } from '../ai/model/settings';
import { type FetchLike } from '../ai/model/port';
import { localDayIndex } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { useI18n } from './i18n';
import { paletteFor, type Palette, spacing, radius } from './theme';
import { HeaderBackButton, HeaderSideSpacer, mobileControlSize, mobileHitTarget } from './mobileControls';
import { MotionPressable } from './MotionPressable';

const platformFetch: FetchLike = (url, init) =>
  fetch(url, init).then((r) => ({ ok: r.ok, status: r.status, text: () => r.text() }));

export function GenerateScreen(props: {
  /** Application-owned queue: migrated settings reads precede newer user saves. */
  modelConfig: ModelConfigSession;
  newFlowId: () => string;
  onDraft: (flow: Flow) => void;
  onCancel: () => void;
}) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { locale, t } = useI18n();
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<ProviderKind>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(ANTHROPIC_DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useMemo(() => createOperationScope(), []);
  useEffect(() => () => operation.close(), [operation]);

  useEffect(() => {
    operation.latest(() => props.modelConfig.load(), {
      success(saved) {
        if (!saved) return;
        setProvider(saved.provider);
        setApiKey(saved.apiKey);
        setModel(saved.model);
        setBaseUrl(saved.provider === 'openai-compatible' ? saved.baseUrl : (saved.baseUrl ?? ''));
      },
      failure(error) {
        setError(String(error));
      },
    });
  }, [operation, props.modelConfig]);

  const switchProvider = (next: ProviderKind): void => {
    operation.invalidateLatest(); // User input now owns the form; discard late defaults.
    setProvider(next);
    setError(null);
    if (next === 'anthropic') {
      setModel((m) => m || ANTHROPIC_DEFAULT_MODEL);
    } else {
      setModel('');
      setBaseUrl((u) => u || OPENAI_COMPATIBLE_PRESETS[0].baseUrl);
    }
  };

  const config = (): ModelProviderConfig =>
    provider === 'anthropic'
      ? { provider, apiKey, model: model || ANTHROPIC_DEFAULT_MODEL, ...(baseUrl ? { baseUrl } : {}) }
      : { provider, apiKey, model, baseUrl };

  const ready =
    description.trim().length > 0 &&
    model.trim().length > 0 &&
    (provider === 'anthropic' ? apiKey.trim().length > 0 : baseUrl.trim().length > 0);

  const doGenerate = (): void => {
    if (!ready) return;
    const cfg = config();
    const request = {
      id: props.newFlowId(),
      locale,
      todayDayIndex: localDayIndex(Date.now(), systemTimeZone),
    };
    const accepted = operation.submit(async () => {
      // A failed secure-storage write must not silently claim the settings were saved.
      await props.modelConfig.save(cfg);
      return generateFlow(createModelPort(cfg, platformFetch, locale), description, request);
    }, {
      success(res) {
        if (res.ok) props.onDraft(res.flow);
        else setError(res.error);
      },
      failure(error) {
        setError(error instanceof Error ? error.message : String(error));
      },
      settled() {
        setBusy(false);
      },
    });
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
        <Text style={styles.title} numberOfLines={1}>{t.generateTitle}</Text>
        <HeaderSideSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
        <Text style={styles.hint}>{t.generateHint}</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={(text) => { setDescription(text); setError(null); }}
          placeholder={t.generatePlaceholder}
          placeholderTextColor={c.textFaint}
          multiline
          testID="gen-description"
        />

        <Text style={styles.sectionKicker}>{t.generateModelSettings}</Text>
        <View style={styles.row}>
          {(['anthropic', 'openai-compatible'] as const).map((p) => (
            <MotionPressable
              key={p}
              style={[mobileHitTarget.compact, styles.chip, provider === p && styles.chipOn]}
              accessibilityRole="button" accessibilityLabel={p === 'anthropic' ? 'Claude' : t.generateProviderOpenAI}
              accessibilityState={{ selected: provider === p }}
              onPress={() => switchProvider(p)}
            >
              <Text style={[styles.chipText, provider === p && styles.chipTextOn]}>
                {p === 'anthropic' ? 'Claude' : t.generateProviderOpenAI}
              </Text>
            </MotionPressable>
          ))}
        </View>

        {provider === 'openai-compatible' ? (
          <>
            <Text style={styles.label}>{t.generateBaseUrl}</Text>
            <TextInput
              style={styles.field}
              value={baseUrl}
              onChangeText={(value) => { operation.invalidateLatest(); setBaseUrl(value); setError(null); }}
              placeholder="https://api.deepseek.com/v1"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.rowWrap}>
              {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
                <MotionPressable key={preset.label} style={[mobileHitTarget.compact, styles.presetChip]}
                  accessibilityRole="button" accessibilityLabel={preset.label}
                  accessibilityState={{ selected: baseUrl === preset.baseUrl }}
                  onPress={() => { operation.invalidateLatest(); setBaseUrl(preset.baseUrl); setError(null); }}>
                  <Text style={styles.presetText}>{preset.label}</Text>
                </MotionPressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{t.generateModel}</Text>
        <TextInput
          style={styles.field}
          value={model}
          onChangeText={(value) => { operation.invalidateLatest(); setModel(value); setError(null); }}
          placeholder={provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : t.generateModelPlaceholder}
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>{t.generateApiKey}</Text>
        <TextInput
          style={styles.field}
          value={apiKey}
          onChangeText={(value) => { operation.invalidateLatest(); setApiKey(value); setError(null); }}
          placeholder={provider === 'openai-compatible' ? t.generateKeyOptional : 'sk-...'}
          placeholderTextColor={c.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <MotionPressable
          style={[mobileHitTarget.standard, styles.primary, (!ready || busy) && styles.primaryOff]}
          accessibilityRole="button"
          disabled={!ready || busy}
          accessibilityState={{ disabled: !ready || busy }}
          onPress={doGenerate}
          testID="gen-submit"
        >
          <Text style={styles.primaryText}>{busy ? t.generateBusy : t.generateSubmit}</Text>
        </MotionPressable>
        <Text style={styles.footnote}>{t.generateFootnote}</Text>
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
  content: { flexGrow: 1, padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  hint: { fontSize: 14, color: c.textMuted },
  input: {
    backgroundColor: c.inputSurface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, fontSize: 15, color: c.text, minHeight: 110, textAlignVertical: 'top',
  },
  sectionKicker: { fontSize: 13, color: c.textFaint, letterSpacing: 2, marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  chipOn: { backgroundColor: c.primarySoft, borderColor: c.primary },
  chipText: { fontSize: 14, color: c.text, fontWeight: '600' },
  chipTextOn: { color: c.onPrimarySoft },
  presetChip: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.secondarySoft, paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  presetText: { fontSize: 12, color: c.secondary },
  label: { fontSize: 13, color: c.textMuted, marginTop: spacing.xs },
  field: {
    minHeight: mobileControlSize.compact,
    backgroundColor: c.inputSurface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, color: c.text,
  },
  error: { color: c.danger, fontSize: 14, marginTop: spacing.xs },
  primary: {
    backgroundColor: c.primary, borderRadius: radius.pill, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.sm,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },
  footnote: { fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
