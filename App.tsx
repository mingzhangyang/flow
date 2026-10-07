// 准时 / Zhunshi —— 应用外壳。
// Phase 3：内置示例 + 用户自建的 flow 库；可新建/编辑/导出/导入，按拓扑运行。
// 简单的状态机即导航（Constraint 0：先别引入路由库）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, SafeAreaView, StyleSheet, useColorScheme } from 'react-native';
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
import { catalogEntriesWithOwnedPrecedence, reminderEnrollmentKey, resolveCatalogEntry } from './src/session/flowCatalog';
import { createExpoNotifier } from './src/notifications/expoNotifier';
import { createExpoNotificationResponseSource } from './src/notifications/notificationResponses';
import { configureExpoNotificationPresentation } from './src/notifications/notificationPresentation';
import { type NotificationRouteData } from './src/notifications/notificationRoute';
import { enrollFlow, rescheduleReminders, unenrollFlow } from './src/notifications/reschedule';
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
import { useI18n } from './src/ui/i18n';
import { paletteFor } from './src/ui/theme';

configureExpoNotificationPresentation();

const newFlowId = (): string => `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Screen =
  | { name: 'home' }
  | { name: 'run'; flow: Flow; enrollmentKey: string }
  | { name: 'edit'; flow: Flow }
  | { name: 'export'; flow: Flow }
  | { name: 'insight'; flow: Flow }
  | { name: 'import' }
  | { name: 'generate' };

export default function App() {
  // 数字展示字体（时刻/倒计时专用）；加载极快，未就绪前不渲染以免字体跳变
  const [fontsLoaded] = useFonts({ IBMPlexMono_200ExtraLight, IBMPlexMono_500Medium });
  // 跟随系统深/浅色模式（运行页除外——那是不随模式变的沉浸场景）
  const scheme = useColorScheme();
  const c = paletteFor(scheme);
  // 语言在此读取一次，向下显式传递；示例内容随语言切换（id 不变，记录不丢）
  const { locale } = useI18n();
  const examples = useMemo(() => examplesFor(locale), [locale]);
  const storage = useMemo(() => createStorage(asyncStorageKV), []);
  const library = useMemo(() => createLibrary(storage), [storage]);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const notificationResponses = useMemo(() => createExpoNotificationResponseSource(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [refreshKey, setRefreshKey] = useState(0);

  const home = (): void => setScreen({ name: 'home' });
  const homeRefreshed = (): void => {
    setRefreshKey((k) => k + 1);
    home();
  };

  const deleteOwnedFlow = useCallback(async (flowId: string): Promise<void> => {
    // 只关闭 owned catalog identity；同 id 示例若曾单独登记，不会被误删。
    await unenrollFlow(asyncStorageKV, reminderEnrollmentKey(flowId, 'owned', examples));
    try {
      await library.remove(flowId);
    } finally {
      setRefreshKey((k) => k + 1);
    }
  }, [examples, library]);

  // 通知只携带稳定 id；真正的 Flow 总是从当前示例/本地库重新读取，
  // 避免把可能过期的定义快照塞进系统通知（C6/E5）。
  const openFlowFromNotification = useCallback(async (flowId: string): Promise<void> => {
    const owned = await library.get(flowId);
    const entry = resolveCatalogEntry(flowId, owned ? [owned] : [], examples);
    if (entry) setScreen({ name: 'run', flow: entry.flow, enrollmentKey: entry.enrollmentKey });
  }, [examples, library]);

  // 重排已登记 flow 未来数日的日程提醒——启动、回到前台、库变更时各续一次（C5）。
  const refreshReminders = useCallback((): void => {
    library
      .list()
      .then((flows) =>
        rescheduleReminders({
          kv: asyncStorageKV,
          notifier,
          flows: catalogEntriesWithOwnedPrecedence(examples, flows),
          now: Date.now(),
          deviceTz: systemTimeZone,
        }),
      )
      .catch(() => {});
  }, [library, notifier, examples]);

  useEffect(() => {
    refreshReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshReminders();
    });
    return () => sub.remove();
  }, [refreshReminders, refreshKey]);

  // 原生 response source 内部协调冷启动 last response 与运行中 listener：
  // 启动窗口先读 initial、缓冲 listener，再按顺序去重交付，避免重复/乱序导航。
  useEffect(() => {
    let active = true;
    const unsubscribe = notificationResponses.start(async (route: NotificationRouteData) => {
      if (!active) return;
      try {
        await openFlowFromNotification(route.flowId);
      } catch {
        // 单次路由失败不打断后续通知响应队列。
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [notificationResponses, openFlowFromNotification]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {screen.name === 'home' ? (
        <HomeScreen
          library={library}
          examples={examples}
          refreshKey={refreshKey}
          sharer={systemSharer}
          onRun={(flow, enrollmentKey) => setScreen({ name: 'run', flow, enrollmentKey })}
          onNew={(topology: Topology) => setScreen({ name: 'edit', flow: createFlow({ id: newFlowId(), title: '', topology }) })}
          onEdit={(flow) => setScreen({ name: 'edit', flow })}
          onExport={(flow) => setScreen({ name: 'export', flow })}
          onInsight={(flow) => setScreen({ name: 'insight', flow })}
          onDelete={deleteOwnedFlow}
          onImport={() => setScreen({ name: 'import' })}
          onGenerate={() => setScreen({ name: 'generate' })}
        />
      ) : screen.name === 'run' ? (
        screen.flow.topology === 'scheduled' ? (
          <ScheduleScreen
            flow={screen.flow}
            enrollmentKey={screen.enrollmentKey}
            storage={storage}
            notifier={notifier}
            onEnrollReminders={(enrollmentKey) => {
              enrollFlow(asyncStorageKV, enrollmentKey).then(refreshReminders).catch(() => {});
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
      ) : (
        <ImportScreen library={library} onImported={homeRefreshed} onCancel={home} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
