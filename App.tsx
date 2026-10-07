// 准时 / Zhunshi —— 应用外壳。
// Catalog snapshot、提醒重排、提醒登记和持久化删除恢复统一走一个串行 coordinator。
// Home / 通知路由只消费 coordinator 发布的权威 snapshot。

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
import {
  catalogEntriesWithOwnedPrecedence,
  LOADING_CATALOG,
  resolveCatalogEntry,
  type OwnedCatalogSnapshot,
} from './src/session/flowCatalog';
import { createCatalogCoordinator } from './src/session/catalogCoordinator';
import {
  deleteOwnedFlowDurably,
  recoverPendingOwnedFlowDeletions,
} from './src/session/deleteOwnedFlow';
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
  const [fontsLoaded] = useFonts({ IBMPlexMono_200ExtraLight, IBMPlexMono_500Medium });
  const scheme = useColorScheme();
  const c = paletteFor(scheme);
  const { locale } = useI18n();
  const examples = useMemo(() => examplesFor(locale), [locale]);
  const storage = useMemo(() => createStorage(asyncStorageKV), []);
  const library = useMemo(() => createLibrary(storage), [storage]);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const notificationResponses = useMemo(() => createExpoNotificationResponseSource(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [catalog, setCatalog] = useState<OwnedCatalogSnapshot>(LOADING_CATALOG);
  const catalogCoordinator = useMemo(() => createCatalogCoordinator(setCatalog), []);

  const home = (): void => setScreen({ name: 'home' });

  const runCatalogTask = useCallback(async (
    mutation?: () => Promise<void>,
  ): Promise<Flow[]> => {
    if (mutation) await mutation();

    await recoverPendingOwnedFlowDeletions({
      kv: asyncStorageKV,
      removeFlow: (id) => library.remove(id),
      unenroll: (key, legacyId) => unenrollFlow(asyncStorageKV, key, legacyId),
    });

    const flows = await library.list();
    await rescheduleReminders({
      kv: asyncStorageKV,
      notifier,
      flows: catalogEntriesWithOwnedPrecedence(examples, flows),
      now: Date.now(),
      deviceTz: systemTimeZone,
    });
    return flows;
  }, [examples, library, notifier]);

  const refreshCatalog = useCallback((
    mutation?: () => Promise<void>,
  ): Promise<void> => catalogCoordinator.request(() => runCatalogTask(mutation)),
  [catalogCoordinator, runCatalogTask]);

  const homeRefreshed = (): void => {
    home();
    void refreshCatalog();
  };

  const deleteOwnedFlow = useCallback(async (
    flow: Flow,
    enrollmentKey: string,
    legacyEnrollmentId?: string,
  ): Promise<void> => {
    await refreshCatalog(() =>
      deleteOwnedFlowDurably(flow, enrollmentKey, legacyEnrollmentId, {
        kv: asyncStorageKV,
        removeFlow: (id) => library.remove(id),
        unenroll: (key, legacyId) => unenrollFlow(asyncStorageKV, key, legacyId),
      }));
  }, [library, refreshCatalog]);

  useEffect(() => {
    void refreshCatalog();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshCatalog();
    });
    return () => sub.remove();
  }, [refreshCatalog]);

  // response source 只启动一次；catalog 未 ready 时等待 coordinator，而不是退订 listener。
  // 因此加载/删除恢复窗口中的多个 tap 仍由 response source 的串行队列完整保留。
  useEffect(() => {
    let active = true;
    const unsubscribe = notificationResponses.start(async (route: NotificationRouteData) => {
      const flows = await catalogCoordinator.waitForReady();
      if (!active) return;
      const entry = resolveCatalogEntry(route.flowId, flows, examples);
      if (entry) setScreen({ name: 'run', flow: entry.flow, enrollmentKey: entry.enrollmentKey });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalogCoordinator, examples, notificationResponses]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {screen.name === 'home' ? (
        <HomeScreen
          library={library}
          examples={examples}
          catalog={catalog}
          sharer={systemSharer}
          onRetry={() => { void refreshCatalog(); }}
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
              void refreshCatalog(() => enrollFlow(asyncStorageKV, enrollmentKey));
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
