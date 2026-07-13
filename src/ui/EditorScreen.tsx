// Flow 编辑器。编辑“可以复杂”——这里可增删步骤、改类型、填 rationale（“为什么”，C2）。
// 保存时经 library 提交为新修订（版本递增、旧版本入历史）。

import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow, type FlowNode, type NodeKind, type Recurrence } from '../domain/types';
import { addNode, updateNode, removeNode, moveNode, setMeta } from '../domain/editing';
import { validateFlow } from '../domain/validate';
import { isValidTimeZoneName, timeZoneForFlow } from '../runtime/ianaTimeZone';
import { localDayIndex, weekdayOfDayIndex } from '../runtime/clock';
import { systemTimeZone } from '../runtime/systemTimeZone';
import { type Library } from '../session/library';
import { fmtTimeOfDay } from './format';
import { useI18n } from './i18n';
import { type Strings } from './strings';
import { useAppScheme } from './settings-context';
import { paletteFor, type Palette, spacing, radius } from './theme';

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

function parseTimeOfDay(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const seqKinds = (t: Strings): { kind: NodeKind; label: string }[] => [
  { kind: 'timed', label: t.editorKindTimed },
  { kind: 'gate', label: t.editorKindGate },
  { kind: 'instant', label: t.editorKindInstant },
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

export function EditorScreen(props: { draft: Flow; library: Library; onSaved: (f: Flow) => void; onCancel: () => void }) {
  const c = paletteFor(useAppScheme());
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useI18n();
  const [flow, setFlow] = useState<Flow>(props.draft);
  const [error, setError] = useState<string | null>(null);
  const isScheduled = flow.topology === 'scheduled';

  const patch = (id: string, p: Partial<FlowNode>): void => setFlow((f) => updateNode(f, id, p));
  const changeKind = (id: string, kind: NodeKind): void =>
    setFlow((f) => ({
      ...f,
      nodes: f.nodes.map((n) => (n.id === id ? makeNode(kind, { id: n.id, label: n.label, rationale: n.rationale }) : n)),
    }));

  const add = (): void => {
    const base = { id: newNodeId(), label: '' };
    setFlow((f) => addNode(f, makeNode(isScheduled ? 'scheduled' : 'timed', base)));
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

  const save = (): void => {
    const issues = validateFlow(flow);
    if (issues.length > 0) {
      setError(issues[0].path + ': ' + issues[0].message);
      return;
    }
    if (flow.timeZone && !isValidTimeZoneName(flow.timeZone)) {
      setError(t.editorInvalidTimeZone(flow.timeZone));
      return;
    }
    props.library.commit(flow).then(props.onSaved).catch((e) => setError(String(e)));
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onCancel} hitSlop={12}><Text style={styles.headerBtn}>{t.cancel}</Text></Pressable>
        <Text style={styles.title}>{t.editorTitle}</Text>
        <Pressable onPress={save} hitSlop={12}><Text style={[styles.headerBtn, styles.save]}>{t.save}</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          value={flow.title}
          onChangeText={(text) => setFlow((f) => setMeta(f, { title: text }))}
          placeholder={t.editorFlowName}
          placeholderTextColor={c.pending}
        />
        <TextInput
          style={styles.descInput}
          value={flow.description ?? ''}
          onChangeText={(text) => setFlow((f) => setMeta(f, { description: text }))}
          placeholder={t.editorDescription}
          placeholderTextColor={c.pending}
        />
        {isScheduled ? (
          <>
            <TextInput
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
                <View style={styles.kindRow}>
                  {repeatKinds(t).map((r) => {
                    const on = (flow.repeat ?? { kind: 'once' }).kind === r.kind;
                    return (
                      <Pressable
                        key={r.kind}
                        style={[styles.kindBtn, on && styles.kindBtnOn]}
                        onPress={() => setFlow((f) => setMeta(f, { repeat: defaultRepeat(r.kind) }))}
                      >
                        <Text style={[styles.kindText, on && styles.kindTextOn]}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Row>
              {flow.repeat?.kind === 'weekly' ? (
                <Row label={t.editorWeekdaysLabel}>
                  <View style={styles.kindRow}>
                    {t.weekdayNames.map((name, d) => {
                      const on = flow.repeat?.kind === 'weekly' && flow.repeat.days.includes(d);
                      return (
                        <Pressable
                          key={name}
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
                  <TextInput
                    style={styles.smallInput}
                    keyboardType="number-pad"
                    defaultValue={String(flow.repeat.n)}
                    onChangeText={(t) => {
                      const n = Number(t);
                      if (Number.isInteger(n) && n >= 1) {
                        setFlow((f) =>
                          f.repeat?.kind === 'everyNDays' ? setMeta(f, { repeat: { ...f.repeat, n } }) : f,
                        );
                      }
                    }}
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
              <TextInput
                style={styles.nodeLabel}
                value={node.label}
                onChangeText={(text) => patch(node.id, { label: text })}
                placeholder={isScheduled ? t.editorEventPlaceholder : t.editorStepPlaceholder}
                placeholderTextColor={c.pending}
              />
            </View>

            {isScheduled && node.kind === 'scheduled' ? (
              <Row label={t.editorTime}>
                <TextInput
                  style={styles.smallInput}
                  defaultValue={fmtTimeOfDay(node.at)}
                  onChangeText={(text) => {
                    const m = parseTimeOfDay(text);
                    if (m !== null) patch(node.id, { at: m });
                  }}
                  placeholder="08:00"
                  placeholderTextColor={c.pending}
                />
              </Row>
            ) : null}

            {!isScheduled ? (
              <View style={styles.kindRow}>
                {seqKinds(t).map((k) => (
                  <Pressable
                    key={k.kind}
                    style={[styles.kindBtn, node.kind === k.kind && styles.kindBtnOn]}
                    onPress={() => changeKind(node.id, k.kind)}
                  >
                    <Text style={[styles.kindText, node.kind === k.kind && styles.kindTextOn]}>{k.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {node.kind === 'timed' ? (
              <Row label={t.editorDuration}>
                <TextInput
                  style={styles.smallInput}
                  keyboardType="number-pad"
                  defaultValue={String(node.durationSec)}
                  onChangeText={(text) => {
                    const s = Number(text);
                    if (Number.isFinite(s) && s > 0) patch(node.id, { durationSec: Math.floor(s) });
                  }}
                />
              </Row>
            ) : null}

            <TextInput
              style={styles.rationaleInput}
              value={node.rationale ?? ''}
              onChangeText={(text) => patch(node.id, { rationale: text || undefined })}
              placeholder={t.editorWhy}
              placeholderTextColor={c.pending}
            />

            <View style={styles.nodeActions}>
              <Pressable onPress={() => setFlow((f) => moveNode(f, node.id, -1))} disabled={i === 0}>
                <Text style={[styles.action, i === 0 && styles.actionOff]}>↑</Text>
              </Pressable>
              <Pressable onPress={() => setFlow((f) => moveNode(f, node.id, 1))} disabled={i === flow.nodes.length - 1}>
                <Text style={[styles.action, i === flow.nodes.length - 1 && styles.actionOff]}>↓</Text>
              </Pressable>
              <Pressable onPress={() => setFlow((f) => removeNode(f, node.id))}>
                <Text style={[styles.action, styles.remove]}>{t.delete}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable style={styles.addBtn} onPress={add}>
          <Text style={styles.addText}>{isScheduled ? t.editorAddEvent : t.editorAddStep}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  const c = paletteFor(useAppScheme());
  return (
    <View style={rowStyles.fieldRow}>
      <Text style={[rowStyles.fieldLabel, { color: c.textMuted }]}>{props.label}</Text>
      {props.children}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { fontSize: 13, width: 64 },
});

const createStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  headerBtn: { fontSize: 16, color: c.accent },
  save: { fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '600', color: c.text },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  titleInput: {
    fontSize: 22, fontWeight: '700', color: c.text, backgroundColor: c.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md,
  },
  descInput: {
    fontSize: 15, color: c.text, backgroundColor: c.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md,
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
  nodeLabel: { flex: 1, fontSize: 16, color: c.text, paddingVertical: spacing.xs },
  kindRow: { flexDirection: 'row', gap: spacing.xs },
  kindBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border,
  },
  kindBtnOn: { backgroundColor: c.accent, borderColor: c.accent },
  kindText: { fontSize: 13, color: c.textMuted },
  kindTextOn: { color: c.accentText, fontWeight: '700' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { fontSize: 13, color: c.textMuted, width: 64 },
  smallInput: {
    fontSize: 15, color: c.text, backgroundColor: c.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 80,
  },
  rationaleInput: {
    fontSize: 14, color: c.textMuted, backgroundColor: c.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, padding: spacing.sm,
  },
  nodeActions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  action: { fontSize: 15, color: c.accent },
  actionOff: { color: c.pending },
  remove: { color: c.warn },
  addBtn: {
    borderRadius: radius.md, borderWidth: 1, borderColor: c.accent, borderStyle: 'dashed',
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs,
  },
  addText: { color: c.accent, fontSize: 15, fontWeight: '600' },
  error: { color: c.warn, fontSize: 14, marginTop: spacing.sm },
});
