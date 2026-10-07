// Flow 编辑器。编辑“可以复杂”——这里可增删步骤、改类型、填 rationale（“为什么”，C2）。
// 保存时经 library 提交为新修订（版本递增、旧版本入历史）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  type TextInputProps,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { type Flow, type FlowNode, type NodeKind, type Recurrence } from '../domain/types';
import { addNode, updateNode, removeNode, moveNode, setMeta } from '../domain/editing';
import { validateFlow } from '../domain/validate';
import { isValidTimeZoneName, timeZoneForFlow } from '../runtime/ianaTimeZone';
import { localDayIndex, weekdayOfDayIndex } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { paletteFor, type Palette, spacing, radius } from './theme';
import { HeaderBackButton, HeaderSideSpacer, mobileControlSize } from './mobileControls';
import {
  editorDurationInputKey,
  editorEveryNDaysInputKey,
  editorScheduledTimeInputKey,
  resolveEditorDraftState,
} from './editorInputBuffers';
import {
  applyEditorDurationPreset,
  createQuickWaitNode,
  selectedEditorDurationPreset,
  type EditorAuthoringState,
  type EditorDurationPreset,
} from './editorAuthoring';

const newNodeId = (): string => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function makeNode(kind: NodeKind, base: { id: string; label: string; rationale?: string }): FlowNode {
  switch (kind) {
    case 'timed':
      return { kind: 'timed', ...base, durationSec: 60 };
    case 'gate':
      return { kind: 'gate', ...base };
    case 'instant':
      return { kind: 'instant', ...base };
    case 'scheduled':
      return { kind: 'scheduled', ...base, at: 8 * 60 }; // 重复节律在 flow 级

    case 'parallel':
      return { kind: 'parallel', ...base, children: [] };
  }
}

const seqKinds = (t: Strings): { kind: NodeKind; label: string }[] => [
  { kind: 'timed', label: t.editorKindTimed },
  { kind: 'gate', label: t.editorKindGate },
  { kind: 'instant', label: t.editorKindInstant },
];

const durationPresets = (t: Strings): { durationSec: EditorDurationPreset; label: string }[] => [
  { durationSec: 30, label: t.editorDurationPreset30Sec },
  { durationSec: 60, label: t.editorDurationPreset1Min },
  { durationSec: 300, label: t.editorDurationPreset5Min },
  { durationSec: 600, label: t.editorDurationPreset10Min },
  { durationSec: 1800, label: t.editorDurationPreset30Min },
];

const repeatKinds = (t: Strings): { kind: Recurrence['kind']; label: string }[] => [
  { kind: 'once', label: t.editorRepeatOnce },
  { kind: 'daily', label: t.editorRepeatDaily },
  { kind: 'weekly', label: t.editorRepeatWeekly },
  { kind: 'everyNDays', label: t.editorRepeatEveryN },
];

/** 切换周几：保持有序去重；清空交给保存时的校验拦截。 */
function toggleWeekday(repeat: Recurrence, d: number): Recurrence {
  const days = repeat.kind === 'weekly' ? repeat.days : [];
  const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
  return { kind: 'weekly', days: next };
}

const inputContractStyles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  singleLine: {
    minHeight: 48,
    lineHeight: 20,
    paddingVertical: 0,
  },
  multiline: {
    minHeight: 96,
    lineHeight: 20,
    paddingVertical: 12,
  },
});

/**
 * One mobile text-input contract for the whole Editor.
 * Explicit metrics keep Android font/placeholder layout independent of
 * platform font padding; multiline fields opt into top alignment.
 */
function EditorTextInput({ style, multiline = false, ...props }: TextInputProps) {
  return (
    <TextInput
      {...props}
      multiline={multiline}
      underlineColorAndroid="transparent"
      textAlignVertical={multiline ? 'top' : 'center'}
      style={[
        inputContractStyles.base,
        multiline ? inputContractStyles.multiline : inputContractStyles.singleLine,
        style,
      ]}
    />
  );
}

interface EditorScreenProps {
  draft: Flow;
  saveFlow: (flow: Flow) => Promise<Flow>;
  onSaved: (flow: Flow) => void;
  onCancel: () => void;
  onBackHandlerChange?: (handler: (() => void) | null) => void;
}

export function EditorScreen(props: EditorScreenProps) {
  const c = paletteFor(useColorScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [authoringState, setAuthoringState] = useState<EditorAuthoringState>(() => ({
    flow: props.draft,
    inputBuffers: {},
  }));
  const { flow, inputBuffers } = authoringState;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const isScheduled = flow.topology === 'scheduled';
  const resolvedDraft = useMemo(
    () => resolveEditorDraftState(props.draft, flow, inputBuffers),
    [flow, inputBuffers, props.draft],
  );
  const isDirty = resolvedDraft.dirty;

  const setFlow = useCallback((update: (current: Flow) => Flow): void => {
    setAuthoringState((current) => {
      const flow = update(current.flow);
      return flow === current.flow ? current : { ...current, flow };
    });
  }, []);

  const setInputBuffer = useCallback((key: string, text: string): void => {
    setAuthoringState((current) => ({
      ...current,
      inputBuffers: { ...current.inputBuffers, [key]: text },
    }));
  }, []);

  const clearInputBufferKeys = useCallback((keys: string[]): void => {
    setAuthoringState((current) => {
      let changed = false;
      const inputBuffers = { ...current.inputBuffers };
      for (const key of keys) {
        if (key in inputBuffers) {
          delete inputBuffers[key];
          changed = true;
        }
      }
      return changed ? { ...current, inputBuffers } : current;
    });
  }, []);

  const applyDurationPreset = useCallback((nodeId: string, durationSec: EditorDurationPreset): void => {
    setAuthoringState((current) => applyEditorDurationPreset(current, nodeId, durationSec));
  }, []);

  const requestExit = useCallback((): void => {
    // Once a commit starts, navigation is temporarily owned by the save flow.
    // This prevents Back/discard from racing the eventual onSaved transition.
    if (savingRef.current) return;

    if (!isDirty) {
      props.onCancel();
      return;
    }

    Alert.alert(
      t.editorDiscardTitle,
      t.editorDiscardMessage,
      [
        { text: t.editorContinueEditing, style: 'cancel' },
        { text: t.editorDiscardChanges, style: 'destructive', onPress: props.onCancel },
      ],
    );
  }, [isDirty, props.onCancel, t]);

  useEffect(() => {
    props.onBackHandlerChange?.(requestExit);
    return () => props.onBackHandlerChange?.(null);
  }, [props.onBackHandlerChange, requestExit]);

  const patch = (id: string, p: Partial<FlowNode>): void => setFlow((f) => updateNode(f, id, p));
  const changeKind = (id: string, kind: NodeKind): void => {
    clearInputBufferKeys([editorDurationInputKey(id), editorScheduledTimeInputKey(id)]);
    setFlow((f) => ({
      ...f,
      nodes: f.nodes.map((n) => (n.id === id ? makeNode(kind, { id: n.id, label: n.label, rationale: n.rationale }) : n)),
    }));
  };

  const add = (): void => {
    const base = { id: newNodeId(), label: '' };
    setFlow((f) => addNode(f, makeNode(isScheduled ? 'scheduled' : 'timed', base)));
  };

  const addWait = (): void => {
    if (isScheduled) return;
    setFlow((f) => addNode(f, createQuickWaitNode(newNodeId(), t.editorWaitLabel)));
  };

  // 切换重复方式时的初值：每周默认勾今天的星期，隔 N 天默认隔天、从今天起算。
  // 「今天」按 flow 锚定的时区（无锚定则设备时区）计——与运行时口径一致。
  const defaultRepeat = (kind: Recurrence['kind']): Recurrence => {
    const today = localDayIndex(Date.now(), timeZoneForFlow(flow, systemTimeZone));
    switch (kind) {
      case 'once':
        return { kind: 'once' };
      case 'daily':
        return { kind: 'daily' };
      case 'weekly':
        return { kind: 'weekly', days: [weekdayOfDayIndex(today)] };
      case 'everyNDays':
        return { kind: 'everyNDays', n: 2, fromDay: today };
    }
  };

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;

    if (resolvedDraft.invalid) {
      setError(t.editorInvalidCompactInput);
      return;
    }

    const candidate = resolvedDraft.flow;
    const issues = validateFlow(candidate);
    if (issues.length > 0) {
      setError(issues[0].path + ': ' + issues[0].message);
      return;
    }
    if (candidate.timeZone && !isValidTimeZoneName(candidate.timeZone)) {
      setError(t.editorInvalidTimeZone(candidate.timeZone));
      return;
    }

    // The ref closes the same-frame double-tap window before React can render
    // the disabled button state.
    savingRef.current = true;
    setSaving(true);
    Keyboard.dismiss();
    setError(null);
    try {
      const saved = await props.saveFlow(candidate);
      props.onSaved(saved);
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      setError(String(e));
    }
  }, [props.onSaved, props.saveFlow, resolvedDraft, t]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <HeaderBackButton
          accessibilityLabel={t.back}
          color={c.accent}
          disabled={saving}
          onPress={requestExit}
        />
        <Text style={styles.title} numberOfLines={1}>{t.editorTitle}</Text>
        <HeaderSideSpacer />
      </View>

      <ScrollView
        pointerEvents={saving ? 'none' : 'auto'}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <EditorTextInput
          editable={!saving}
          style={styles.titleInput}
          value={flow.title}
          onChangeText={(text) => setFlow((f) => setMeta(f, { title: text }))}
          placeholder={t.editorFlowName}
          placeholderTextColor={c.pending}
        />
        <EditorTextInput
          editable={!saving}
          style={styles.descInput}
          value={flow.description ?? ''}
          onChangeText={(text) => setFlow((f) => setMeta(f, { description: text }))}
          placeholder={t.editorDescription}
          placeholderTextColor={c.pending}
        />
        {isScheduled ? (
          <>
            <EditorTextInput
          editable={!saving}
              style={styles.descInput}
              value={flow.timeZone ?? ''}
              onChangeText={(text) => { setFlow((f) => setMeta(f, { timeZone: text })); setError(null); }}
              placeholder={t.editorTimeZone}
              placeholderTextColor={c.pending}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* 重复节律属于整个模式（flow 级），不属于单个事件 */}
            <View style={styles.repeatCard}>
              <Row label={t.editorRepeat}>
                <View style={styles.chipRow}>
                  {repeatKinds(t).map((r) => {
                    const on = (flow.repeat ?? { kind: 'once' }).kind === r.kind;
                    return (
                      <Pressable
                        key={r.kind}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: saving }}
                        disabled={saving}
                        style={[styles.kindBtn, on && styles.kindBtnOn]}
                        onPress={() => {
                          clearInputBufferKeys([editorEveryNDaysInputKey]);
                          setFlow((f) => setMeta(f, { repeat: defaultRepeat(r.kind) }));
                        }}
                      >
                        <Text style={[styles.kindText, on && styles.kindTextOn]}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Row>
              {flow.repeat?.kind === 'weekly' ? (
                <Row label={t.editorWeekdaysLabel}>
                  <View style={styles.chipRow}>
                    {t.weekdayNames.map((name, d) => {
                      const on = flow.repeat?.kind === 'weekly' && flow.repeat.days.includes(d);
                      return (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on, disabled: saving }}
                          disabled={saving}
                          style={[styles.kindBtn, on && styles.kindBtnOn]}
                          onPress={() =>
                            setFlow((f) => setMeta(f, { repeat: toggleWeekday(f.repeat ?? { kind: 'weekly', days: [] }, d) }))
                          }
                        >
                          <Text style={[styles.kindText, on && styles.kindTextOn]}>{name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Row>
              ) : null}
              {(flow.repeat ?? { kind: 'once' }).kind === 'once' ? (
                // once 的「过时不候」语义在选择处就说清（默认值尤其要显眼）
                <Text style={styles.repeatHint}>{t.editorOnceHint}</Text>
              ) : null}
              {flow.repeat?.kind === 'everyNDays' ? (
                <Row label={t.editorEveryNDays}>
                  <EditorTextInput
          editable={!saving}
                    style={styles.smallInput}
                    keyboardType="number-pad"
                    value={inputBuffers[editorEveryNDaysInputKey] ?? String(flow.repeat.n)}
                    onChangeText={(text) => setInputBuffer(editorEveryNDaysInputKey, text)}
                  />
                </Row>
              ) : null}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionKicker}>{isScheduled ? t.editorSectionScheduled : t.editorSectionSteps}</Text>
        {flow.nodes.map((node, i) => (
          <View key={node.id} style={styles.nodeCard}>
            <View style={styles.nodeTop}>
              <Text style={styles.nodeIndex}>{i + 1}</Text>
              <EditorTextInput
          editable={!saving}
                style={styles.nodeLabel}
                value={node.label}
                onChangeText={(text) => patch(node.id, { label: text })}
                placeholder={isScheduled ? t.editorEventPlaceholder : t.editorStepPlaceholder}
                placeholderTextColor={c.pending}
              />
            </View>

            {isScheduled && node.kind === 'scheduled' ? (
              <Row label={t.editorTime}>
                <EditorTextInput
          editable={!saving}
                  style={styles.smallInput}
                  value={inputBuffers[editorScheduledTimeInputKey(node.id)] ?? fmtTimeOfDay(node.at)}
                  onChangeText={(text) => setInputBuffer(editorScheduledTimeInputKey(node.id), text)}
                  placeholder="08:00"
                  placeholderTextColor={c.pending}
                />
              </Row>
            ) : null}

            {!isScheduled ? (
              <View style={styles.chipRow}>
                {seqKinds(t).map((k) => (
                  <Pressable
                    key={k.kind}
                    accessibilityRole="button"
                    accessibilityState={{ selected: node.kind === k.kind, disabled: saving }}
                    disabled={saving}
                    style={[styles.kindBtn, node.kind === k.kind && styles.kindBtnOn]}
                    onPress={() => changeKind(node.id, k.kind)}
                  >
                    <Text style={[styles.kindText, node.kind === k.kind && styles.kindTextOn]}>{k.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!isScheduled && node.kind === 'timed' ? (
              <View style={styles.durationEditor}>
                <Text style={styles.durationLabel}>{t.editorDuration}</Text>
                <View style={styles.durationPresetRow}>
                  {durationPresets(t).map((preset) => {
                    const selected =
                      selectedEditorDurationPreset(
                        node,
                        inputBuffers[editorDurationInputKey(node.id)],
                      ) === preset.durationSec;
                    return (
                      <Pressable
                        key={preset.durationSec}
                        accessibilityRole="button"
                        accessibilityLabel={preset.label}
                        accessibilityState={{ selected, disabled: saving }}
                        disabled={saving}
                        onPress={() => applyDurationPreset(node.id, preset.durationSec)}
                        style={[
                          styles.durationPresetBtn,
                          selected && styles.durationPresetBtnOn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.durationPresetText,
                            selected && styles.durationPresetTextOn,
                          ]}
                        >
                          {selected ? `✓ ${preset.label}` : preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.durationCustomRow}>
                  <Text style={styles.durationCustomLabel}>{t.editorDurationCustomSeconds}</Text>
                  <EditorTextInput
                    accessibilityLabel={t.editorDurationCustomSeconds}
                    editable={!saving}
                    style={[styles.smallInput, styles.durationInput]}
                    keyboardType="number-pad"
                    value={inputBuffers[editorDurationInputKey(node.id)] ?? String(node.durationSec)}
                    onChangeText={(text) => setInputBuffer(editorDurationInputKey(node.id), text)}
                  />
                </View>
              </View>
            ) : null}

            <EditorTextInput
          editable={!saving}
              style={styles.rationaleInput}
              value={node.rationale ?? ''}
              onChangeText={(text) => patch(node.id, { rationale: text || undefined })}
              placeholder={t.editorWhy}
              placeholderTextColor={c.pending}
            />

            <View style={styles.nodeActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.editorMoveUp}
                accessibilityState={{ disabled: i === 0 || saving }}
                disabled={i === 0 || saving}
                style={[styles.nodeActionButton, (i === 0 || saving) && styles.nodeActionDisabled]}
                onPress={() => setFlow((f) => moveNode(f, node.id, -1))}
              >
                <Text style={styles.nodeActionText}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.editorMoveDown}
                accessibilityState={{ disabled: i === flow.nodes.length - 1 || saving }}
                disabled={i === flow.nodes.length - 1 || saving}
                style={[
                  styles.nodeActionButton,
                  (i === flow.nodes.length - 1 || saving) && styles.nodeActionDisabled,
                ]}
                onPress={() => setFlow((f) => moveNode(f, node.id, 1))}
              >
                <Text style={styles.nodeActionText}>↓</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.editorDeleteNode}
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                style={[
                  styles.nodeActionButton,
                  styles.removeActionButton,
                  saving && styles.nodeActionDisabled,
                ]}
                onPress={() => setFlow((f) => removeNode(f, node.id))}
              >
                <Text style={[styles.nodeActionText, styles.remove]}>{t.editorDeleteNode}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <View style={styles.addActions}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            style={[styles.addBtn, styles.addAction]}
            onPress={add}
          >
            <Text style={styles.addText}>{isScheduled ? t.editorAddEvent : t.editorAddStep}</Text>
          </Pressable>
          {!isScheduled ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              style={[styles.addBtn, styles.addAction, styles.quickWaitBtn]}
              onPress={addWait}
            >
              <Text style={styles.addText}>{t.editorAddWait}</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <KeyboardAvoidingView
        enabled={Platform.OS === 'ios'}
        behavior={Platform.OS === 'ios' ? 'position' : undefined}
        style={styles.footerAvoider}
        contentContainerStyle={styles.footerAvoiderContent}
      >
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={save}
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          >
            <Text style={styles.saveButtonText}>{saving ? t.editorSaving : t.save}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  const c = paletteFor(useColorScheme());
  return (
    <View style={rowStyles.fieldRow}>
      <Text style={[rowStyles.fieldLabel, { color: c.textMuted }]}>{props.label}</Text>
      <View style={rowStyles.fieldContent}>{props.children}</View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { fontSize: 13, width: 64 },
  fieldContent: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
});

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  title: {
    flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22,
    fontWeight: '600', color: c.text, textAlign: 'center',
  },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  titleInput: {
    minHeight: 56, lineHeight: 28,
    fontSize: 22, fontWeight: '700', color: c.text, backgroundColor: c.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md,
  },
  descInput: {
    fontSize: 15, color: c.text, backgroundColor: c.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.md,
  },
  sectionKicker: { fontSize: 13, color: c.textMuted, letterSpacing: 2, marginTop: spacing.sm, marginLeft: spacing.xs },
  repeatCard: {
    backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, gap: spacing.sm,
  },
  repeatHint: { fontSize: 13, color: c.textMuted, lineHeight: 18 },
  nodeCard: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, gap: spacing.sm,
  },
  nodeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nodeIndex: { fontSize: 13, color: c.textMuted, width: 18 },
  nodeLabel: { flex: 1, fontSize: 16, lineHeight: 22, color: c.text, paddingHorizontal: 0 },
  chipRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  kindBtn: {
    minWidth: mobileControlSize.compact, minHeight: mobileControlSize.compact,
    flexShrink: 0, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border,
  },
  kindBtnOn: { backgroundColor: c.accent, borderColor: c.accent },
  kindText: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
  kindTextOn: { color: c.accentText, fontWeight: '700' },
  durationEditor: { gap: spacing.xs },
  durationLabel: { fontSize: 13, color: c.textMuted },
  durationPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  durationPresetBtn: {
    minWidth: mobileControlSize.compact, minHeight: mobileControlSize.compact,
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.md, borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border,
  },
  durationPresetBtnOn: { backgroundColor: c.accent, borderColor: c.accent },
  durationPresetText: { fontSize: 13, color: c.textMuted },
  durationPresetTextOn: { color: c.accentText, fontWeight: '700' },
  durationCustomRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm,
  },
  durationCustomLabel: { fontSize: 13, color: c.textMuted },
  durationInput: { flexGrow: 1, minWidth: 96 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { fontSize: 13, color: c.textMuted, width: 64 },
  smallInput: {
    minHeight: 44,
    fontSize: 15, color: c.text, backgroundColor: c.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.sm, minWidth: 80,
  },
  rationaleInput: {
    fontSize: 14, color: c.textMuted, backgroundColor: c.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.sm,
  },
  nodeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  nodeActionButton: {
    minWidth: mobileControlSize.compact, minHeight: mobileControlSize.compact,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.sm,
  },
  nodeActionDisabled: { opacity: 0.38 },
  nodeActionText: { fontSize: 15, color: c.accent, fontWeight: '600' },
  removeActionButton: { borderColor: c.warn },
  remove: { color: c.warn },
  addActions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs,
  },
  addBtn: {
    minHeight: 48, justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, borderStyle: 'dashed',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'center',
  },
  addAction: { flexGrow: 1, flexBasis: 136 },
  quickWaitBtn: { borderStyle: 'solid', backgroundColor: c.surface },
  addText: { color: c.accent, fontSize: 15, fontWeight: '600' },
  error: { color: c.warn, fontSize: 14, marginTop: spacing.sm },
  footerAvoider: { backgroundColor: c.bg },
  footerAvoiderContent: { backgroundColor: c.bg },
  footer: {
    borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  saveButton: {
    minHeight: 48, borderRadius: radius.md, backgroundColor: c.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
  },
  saveButtonDisabled: { opacity: 0.55 },
  saveButtonText: { color: c.accentText, fontSize: 16, lineHeight: 22, fontWeight: '700' },
});
