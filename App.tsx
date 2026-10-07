// 准时 / Zhunshi —— 应用外壳。
// Catalog snapshot、提醒重排和持久化删除恢复由 composition root 统一协调，
// Home 只消费已经就绪的 snapshot，避免多处异步读取产生短暂错误视图。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const refreshGeneration = useRef(0);

  const home = (): void => setScreen({ name: 'home' });

  const refreshCatalog = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current;
    setCatalog(LOADING_CATALOG);

    try {
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
      if (generation === refreshGeneration.current) {
        setCatalog({ status: 'ready', flows });
      }
    } catch {
      if (generation === refreshGeneration.current) setCatalog(LOADING_CATALOG);
    }
  }, [examples, library, notifier]);

  const homeRefreshed = (): void => {
    home();
    void refreshCatalog();
  };

  const deleteOwnedFlow = useCallback(async (
    flow: Flow,
    enrollmentKey: string,
    legacyEnrollmentId?: string,
  ): Promise<void> => {
    setCatalog(LOADING_CATALOG);
    try {
      await deleteOwnedFlowDurably(flow, enrollmentKey, legacyEnrollmentId, {
        kv: asyncStorageKV,
        removeFlow: (id) => library.remove(id),
        unenroll: (key, legacyId) => unenrollFlow(asyncStorageKV, key, legacyId),
      });
    } finally {
      await refreshCatalog();
    }
  }, [library, refreshCatalog]);

  useEffect(() => {
    void refreshCatalog();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshCatalog();
    });
    return () => sub.remove();
  }, [refreshCatalog]);

  useEffect(() => {
    if (catalog.status !== 'ready') return undefined;
    let active = true;
    const unsubscribe = notificationResponses.start(async (route: NotificationRouteData) => {
      if (!active) return;
      const entry = resolveCatalogEntry(route.flowId, catalog.flows, examples);
      if (entry) setScreen({ name: 'run', flow: entry.flow, enrollmentKey: entry.enrollmentKey });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalog, examples, notificationResponses]);

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
              enrollFlow(asyncStorageKV, enrollmentKey).then(refreshCatalog).catch(() => {});
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
