// AI 生成：自然语言描述 → 任意模型供应商（ModelPort）→ Flow 草稿 → 编辑器审阅。
// 生成结果不直接入库：用户在编辑器里确认后保存为新版本（AI-C1 用户决定、AI-C3 可 Diff/Undo）。
// 供应商可切换：Anthropic（Claude）或任何 OpenAI 兼容端点；配置与密钥只存本机（C6）。

import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow } from '../domain/types';
import { type KVStore } from '../storage/kv';
import { generateFlow } from '../ai/generate';
import {
  createModelPort,
  OPENAI_COMPATIBLE_PRESETS,
  type ModelProviderConfig,
  type ProviderKind,
} from '../ai/model/providers';
import { ANTHROPIC_DEFAULT_MODEL } from '../ai/model/anthropic';
import { loadModelConfig, saveModelConfig } from '../ai/model/settings';
import { type FetchLike } from '../ai/model/port';
import { colors, spacing, radius } from './theme';

const platformFetch: FetchLike = (url, init) =>
  fetch(url, init).then((r) => ({ ok: r.ok, status: r.status, text: () => r.text() }));

export function GenerateScreen(props: {
  kv: KVStore;
  newFlowId: () => string;
  onDraft: (flow: Flow) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<ProviderKind>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(ANTHROPIC_DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadModelConfig(props.kv)
      .then((saved) => {
        if (!saved) return;
        setProvider(saved.provider);
        setApiKey(saved.apiKey);
        setModel(saved.model);
        setBaseUrl(saved.provider === 'openai-compatible' ? saved.baseUrl : (saved.baseUrl ?? ''));
      })
      .catch(() => {});
  }, [props.kv]);

  const switchProvider = (next: ProviderKind): void => {
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
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const cfg = config();
    saveModelConfig(props.kv, cfg).catch(() => {});
    generateFlow(createModelPort(cfg, platformFetch), description, { id: props.newFlowId() })
      .then((res) => {
        if (res.ok) props.onDraft(res.flow);
        else setError(res.error);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onCancel} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable>
        <Text style={styles.title}>AI 生成</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>用一句话描述你的时间模式，AI 会转写成一条 flow 草稿，由你审阅后保存。</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={(t) => { setDescription(t); setError(null); }}
          placeholder="例：法压咖啡——倒 92 度热水，浸泡 4 分钟，压下压杆再倒出"
          placeholderTextColor={colors.pending}
          multiline
          testID="gen-description"
        />

        <Text style={styles.sectionKicker}>模型设置</Text>
        <View style={styles.row}>
          {(['anthropic', 'openai-compatible'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.chip, provider === p && styles.chipOn]}
              onPress={() => switchProvider(p)}
            >
              <Text style={[styles.chipText, provider === p && styles.chipTextOn]}>
                {p === 'anthropic' ? 'Claude' : 'OpenAI 兼容'}
              </Text>
            </Pressable>
          ))}
        </View>

        {provider === 'openai-compatible' ? (
          <>
            <Text style={styles.label}>端点（Base URL）</Text>
            <TextInput
              style={styles.field}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://api.deepseek.com/v1"
              placeholderTextColor={colors.pending}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.rowWrap}>
              {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
                <Pressable key={preset.label} style={styles.presetChip} onPress={() => setBaseUrl(preset.baseUrl)}>
                  <Text style={styles.presetText}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>模型</Text>
        <TextInput
          style={styles.field}
          value={model}
          onChangeText={setModel}
          placeholder={provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '如 deepseek-chat'}
          placeholderTextColor={colors.pending}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>API Key（只保存在本机）</Text>
        <TextInput
          style={styles.field}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={provider === 'openai-compatible' ? '本地服务（Ollama）可留空' : 'sk-...'}
          placeholderTextColor={colors.pending}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.primary, (!ready || busy) && styles.primaryOff]}
          onPress={doGenerate}
          testID="gen-submit"
        >
          <Text style={styles.primaryText}>{busy ? '生成中…' : '生成草稿'}</Text>
        </Pressable>
        <Text style={styles.footnote}>生成后会进入编辑器，确认无误再保存；保存即产生可回退的新版本。</Text>
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
  content: { padding: spacing.md, gap: spacing.sm },
  hint: { fontSize: 14, color: colors.textMuted },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: 15, color: colors.text, minHeight: 110, textAlignVertical: 'top',
  },
  sectionKicker: { fontSize: 13, color: colors.textMuted, letterSpacing: 1, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  chipTextOn: { color: colors.accentText },
  presetChip: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  presetText: { fontSize: 12, color: colors.textMuted },
  label: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  field: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, color: colors.text,
  },
  error: { color: colors.warn, fontSize: 14, marginTop: spacing.xs },
  primary: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.sm,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
