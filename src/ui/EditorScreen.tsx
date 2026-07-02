// Flow 编辑器。编辑“可以复杂”——这里可增删步骤、改类型、填 rationale（“为什么”，C2）。
// 保存时经 library 提交为新修订（版本递增、旧版本入历史）。

import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type Flow, type FlowNode, type NodeKind } from '../domain/types';
import { addNode, updateNode, removeNode, moveNode, setMeta } from '../domain/editing';
import { validateFlow } from '../domain/validate';
import { isValidTimeZoneName } from '../runtime/ianaTimeZone';
import { type Library } from '../session/library';
import { fmtTimeOfDay } from './format';
import { colors, spacing, radius } from './theme';

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
      return { kind: 'scheduled', ...base, at: 8 * 60, repeat: { kind: 'daily' } };
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

const SEQ_KINDS: { kind: NodeKind; label: string }[] = [
  { kind: 'timed', label: '计时' },
  { kind: 'gate', label: '确认' },
  { kind: 'instant', label: '瞬时' },
];

export function EditorScreen(props: { draft: Flow; library: Library; onSaved: (f: Flow) => void; onCancel: () => void }) {
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

  const save = (): void => {
    const issues = validateFlow(flow);
    if (issues.length > 0) {
      setError(issues[0].path + ': ' + issues[0].message);
      return;
    }
    if (flow.timeZone && !isValidTimeZoneName(flow.timeZone)) {
      setError(`时区名无效：${flow.timeZone}（应为 IANA 名，如 Asia/Shanghai）`);
      return;
    }
    props.library.commit(flow).then(props.onSaved).catch((e) => setError(String(e)));
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onCancel} hitSlop={12}><Text style={styles.headerBtn}>取消</Text></Pressable>
        <Text style={styles.title}>编辑</Text>
        <Pressable onPress={save} hitSlop={12}><Text style={[styles.headerBtn, styles.save]}>保存</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          value={flow.title}
          onChangeText={(t) => setFlow((f) => setMeta(f, { title: t }))}
          placeholder="流程名称"
          placeholderTextColor={colors.pending}
        />
        <TextInput
          style={styles.descInput}
          value={flow.description ?? ''}
          onChangeText={(t) => setFlow((f) => setMeta(f, { description: t }))}
          placeholder="一句话描述（可选）"
          placeholderTextColor={colors.pending}
        />
        {isScheduled ? (
          <TextInput
            style={styles.descInput}
            value={flow.timeZone ?? ''}
            onChangeText={(t) => { setFlow((f) => setMeta(f, { timeZone: t })); setError(null); }}
            placeholder="锚定时区（可选，如 Asia/Shanghai；留空跟随设备）"
            placeholderTextColor={colors.pending}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}

        <Text style={styles.sectionKicker}>{isScheduled ? '定时事件' : '步骤'}</Text>
        {flow.nodes.map((node, i) => (
          <View key={node.id} style={styles.nodeCard}>
            <View style={styles.nodeTop}>
              <Text style={styles.nodeIndex}>{i + 1}</Text>
              <TextInput
                style={styles.nodeLabel}
                value={node.label}
                onChangeText={(t) => patch(node.id, { label: t })}
                placeholder={isScheduled ? '事件（如：早餐后服药）' : '这一步做什么'}
                placeholderTextColor={colors.pending}
              />
            </View>

            {isScheduled && node.kind === 'scheduled' ? (
              <Row label="时间">
                <TextInput
                  style={styles.smallInput}
                  defaultValue={fmtTimeOfDay(node.at)}
                  onChangeText={(t) => {
                    const m = parseTimeOfDay(t);
                    if (m !== null) patch(node.id, { at: m });
                  }}
                  placeholder="08:00"
                  placeholderTextColor={colors.pending}
                />
              </Row>
            ) : null}

            {!isScheduled ? (
              <View style={styles.kindRow}>
                {SEQ_KINDS.map((k) => (
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
              <Row label="时长(秒)">
                <TextInput
                  style={styles.smallInput}
                  keyboardType="number-pad"
                  defaultValue={String(node.durationSec)}
                  onChangeText={(t) => {
                    const s = Number(t);
                    if (Number.isFinite(s) && s > 0) patch(node.id, { durationSec: Math.floor(s) });
                  }}
                />
              </Row>
            ) : null}

            <TextInput
              style={styles.rationaleInput}
              value={node.rationale ?? ''}
              onChangeText={(t) => patch(node.id, { rationale: t || undefined })}
              placeholder="为什么（可选）"
              placeholderTextColor={colors.pending}
            />

            <View style={styles.nodeActions}>
              <Pressable onPress={() => setFlow((f) => moveNode(f, node.id, -1))} disabled={i === 0}>
                <Text style={[styles.action, i === 0 && styles.actionOff]}>↑</Text>
              </Pressable>
              <Pressable onPress={() => setFlow((f) => moveNode(f, node.id, 1))} disabled={i === flow.nodes.length - 1}>
                <Text style={[styles.action, i === flow.nodes.length - 1 && styles.actionOff]}>↓</Text>
              </Pressable>
              <Pressable onPress={() => setFlow((f) => removeNode(f, node.id))}>
                <Text style={[styles.action, styles.remove]}>删除</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable style={styles.addBtn} onPress={add}>
          <Text style={styles.addText}>＋ 添加{isScheduled ? '事件' : '步骤'}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  headerBtn: { fontSize: 16, color: colors.accent },
  save: { fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  titleInput: {
    fontSize: 22, fontWeight: '700', color: colors.text, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  descInput: {
    fontSize: 15, color: colors.text, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  sectionKicker: { fontSize: 13, color: colors.textMuted, letterSpacing: 1, marginTop: spacing.sm, marginLeft: spacing.xs },
  nodeCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: spacing.sm,
  },
  nodeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nodeIndex: { fontSize: 13, color: colors.textMuted, width: 18 },
  nodeLabel: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: spacing.xs },
  kindRow: { flexDirection: 'row', gap: spacing.xs },
  kindBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  kindBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindText: { fontSize: 13, color: colors.textMuted },
  kindTextOn: { color: colors.accentText, fontWeight: '700' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { fontSize: 13, color: colors.textMuted, width: 64 },
  smallInput: {
    fontSize: 15, color: colors.text, backgroundColor: colors.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 80,
  },
  rationaleInput: {
    fontSize: 14, color: colors.textMuted, backgroundColor: colors.bg,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },
  nodeActions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  action: { fontSize: 15, color: colors.accent },
  actionOff: { color: colors.pending },
  remove: { color: colors.warn },
  addBtn: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed',
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs,
  },
  addText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  error: { color: colors.warn, fontSize: 14, marginTop: spacing.sm },
});
