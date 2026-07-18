// 准时 / Zhunshi —— 应用外壳。
// Phase 3：内置示例 + 用户自建的 flow 库；可新建/编辑/导出/导入，按拓扑运行。
// 简单的状态机即导航（Constraint 0：先别引入路由库）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  IBMPlexMono_200ExtraLight,
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono';
import { type Flow, type Topology } from './src/domain/types';
import { createFlow } from './src/domain/editing';
import { examplesFor } from './src/examples';
import { createStorage } from './src/storage/storage';
import { asyncStorageKV } from './src/storage/asyncStorageKv';
import { secureKV } from './src/storage/secureKv';
import { createLibrary } from './src/session/library';
import { loadSettings, saveSettings, type Settings } from './src/session/settings';
import { createExpoNotifier } from './src/notifications/expoNotifier';
import { enrollFlow, rescheduleReminders, unenrollFlow } from './src/notifications/reschedule';
import { activeRunId } from './src/runtime/runIdentity';
import { systemTimeZone } from './src/runtime/systemTimeZone';
import { systemSharer } from './src/sharing/systemSharer';
import { HomeScreen } from './src/ui/HomeScreen';
import { RunnerScreen } from './src/ui/RunnerScreen';
import { ScheduleScreen } from './src/ui/ScheduleScreen';
import { EditorScreen } from './src/ui/EditorScreen';
import { ExportScreen } from './src/ui/ExportScreen';
import { ImportScreen } from './src/ui/ImportScreen';
import { InsightScreen } from './src/ui/InsightScreen';
import { GenerateScreen } from './src/ui/GenerateScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { useI18n } from './src/ui/i18n';
import { SettingsContext, useAppScheme } from './src/ui/settings-context';
import { paletteFor } from './src/ui/theme';

const newFlowId = (): string => `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Screen =
  | { name: 'home' }
  | { name: 'run'; flow: Flow }
  | { name: 'edit'; flow: Flow }
  | { name: 'export'; flow: Flow }
  | { name: 'insight'; flow: Flow }
  | { name: 'import' }
  | { name: 'generate' }
  | { name: 'settings' };

export default function App() {
  // 数字展示字体（时刻/倒计时专用）；加载极快，未就绪前不渲染以免字体跳变
  const [fontsLoaded] = useFonts({ IBMPlexMono_200ExtraLight, IBMPlexMono_500Medium });
  // 用户偏好（语言/外观覆盖）：启动读一次入 state；更新即存即生效
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    loadSettings(asyncStorageKV).then(setSettings).catch(() => setSettings({}));
  }, []);
  const update = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(asyncStorageKV, next).catch(() => {});
  }, []);
  const ctx = useMemo(() => (settings === null ? null : { settings, update }), [settings, update]);

  if (!fontsLoaded || ctx === null) return null;
  return (
    <SettingsContext.Provider value={ctx}>
      <Shell />
    </SettingsContext.Provider>
  );
}

function Shell() {
  // 深/浅色：用户覆盖 ?? 系统模式（运行页除外——那是不随模式变的沉浸场景）
  const scheme = useAppScheme();
  const c = paletteFor(scheme);
  // 语言在此读取一次，向下显式传递；示例内容随语言切换（id 不变，记录不丢）
  const { locale } = useI18n();
  const examples = useMemo(() => examplesFor(locale), [locale]);
  const storage = useMemo(() => createStorage(asyncStorageKV), []);
  const library = useMemo(() => createLibrary(storage), [storage]);
  const notifier = useMemo(() => createExpoNotifier(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [refreshKey, setRefreshKey] = useState(0);

  const home = (): void => setScreen({ name: 'home' });
  const homeRefreshed = (): void => {
    setRefreshKey((k) => k + 1);
    home();
  };

  // 重排已登记 flow 未来数日的日程提醒——启动、回到前台、库变更时各续一次（C5）。
  const refreshReminders = useCallback(async (): Promise<void> => {
    try {
      const flows = await library.list();
      await rescheduleReminders({
        kv: asyncStorageKV,
        notifier,
        flows: [...examples, ...flows],
        now: Date.now(),
        deviceTz: systemTimeZone,
      });
    } catch {
      // 提醒能力不可用不阻塞本地 Flow 操作；ScheduleScreen 会向用户展示能力状态。
    }
  }, [library, notifier, examples]);

  const removeFlow = useCallback(async (flowId: string): Promise<void> => {
    await library.remove(flowId); // 定义 + 历史 + Run + 打卡由 Storage 一并清理
    await unenrollFlow(asyncStorageKV, flowId);
    // 顺序计时提醒不在日程提醒批次清单里，按稳定的 active Run id 单独取消。
    await notifier.cancel([activeRunId(flowId)]).catch(() => {});
    await refreshReminders(); // 取消上一批日程提醒，并仅为剩余 flow 重排
  }, [library, notifier, refreshReminders]);

  useEffect(() => {
    void refreshReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshReminders();
    });
    return () => sub.remove();
  }, [refreshReminders, refreshKey]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {screen.name === 'home' ? (
        <HomeScreen
          library={library}
          examples={examples}
          refreshKey={refreshKey}
          onRun={(flow) => setScreen({ name: 'run', flow })}
          onNew={(topology: Topology) => setScreen({ name: 'edit', flow: createFlow({ id: newFlowId(), title: '', topology }) })}
          onEdit={(flow) => setScreen({ name: 'edit', flow })}
          onExport={(flow) => setScreen({ name: 'export', flow })}
          onInsight={(flow) => setScreen({ name: 'insight', flow })}
          onDelete={removeFlow}
          onImport={() => setScreen({ name: 'import' })}
          onGenerate={() => setScreen({ name: 'generate' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      ) : screen.name === 'run' ? (
        screen.flow.topology === 'scheduled' ? (
          <ScheduleScreen
            flow={screen.flow}
            storage={storage}
            notifier={notifier}
            onEnrollReminders={(flowId) => {
              enrollFlow(asyncStorageKV, flowId).then(refreshReminders).catch(() => {});
            }}
            onExit={home}
          />
        ) : (
          <RunnerScreen flow={screen.flow} storage={storage} notifier={notifier} onExit={home} />
        )
      ) : screen.name === 'edit' ? (
        <EditorScreen draft={screen.flow} library={library} onSaved={homeRefreshed} onCancel={home} />
      ) : screen.name === 'export' ? (
        <ExportScreen flow={screen.flow} sharer={systemSharer} onDone={home} />
      ) : screen.name === 'insight' ? (
        <InsightScreen flow={screen.flow} library={library} onExit={home} onChanged={homeRefreshed} />
      ) : screen.name === 'generate' ? (
        <GenerateScreen
          secrets={secureKV}
          legacySecrets={asyncStorageKV}
          newFlowId={newFlowId}
          onDraft={(flow) => setScreen({ name: 'edit', flow })}
          onCancel={home}
        />
      ) : screen.name === 'settings' ? (
        <SettingsScreen library={library} sharer={systemSharer} onBack={homeRefreshed} />
      ) : (
        <ImportScreen library={library} onImported={homeRefreshed} onCancel={home} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
