// 准时 / Zhunshi —— 应用外壳。
// Catalog snapshot、提醒重排、提醒登记和持久化删除恢复统一走一个串行 coordinator。
// Home / 通知路由只消费 coordinator 发布的权威 snapshot。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, Platform, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
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
  resolveCatalogEntryForRoute,
  type CatalogProjection,
  type FlowCatalogSource,
  type OwnedCatalogSnapshot,
} from './src/session/flowCatalog';
import { createCatalogCoordinator } from './src/session/catalogCoordinator';
import { createDefinitionRuntime, type RuntimeSession } from './src/session/definitionRuntime';
import { runCommittedCatalogMutation } from './src/session/catalogMutation';
import { runCatalogCycle } from './src/session/catalogCycle';
import { assertFlowMutationKeepsActiveRunReachable } from './src/session/catalogRunGuard';
import { deserializeFlow } from './src/domain/serialize';
import {
  deleteOwnedFlowDurably,
  recoverPendingOwnedFlowDeletions,
} from './src/session/deleteOwnedFlow';
import { createExpoNotifier } from './src/notifications/expoNotifier';
import { createExpoNotificationResponseSource } from './src/notifications/notificationResponses';
import { configureExpoNotificationPresentation } from './src/notifications/notificationPresentation';
import { type NotificationRouteData } from './src/notifications/notificationRoute';
import { cancelScheduledRemindersForDefinition, enrollFlow, rescheduleReminders, unenrollFlow } from './src/notifications/reschedule';
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
import { dark, paletteFor } from './src/ui/theme';
import { decideApplicationBack } from './src/ui/applicationBack';

configureExpoNotificationPresentation();

const newFlowId = (): string => `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Screen =
  | { name: 'home' }
  | { name: 'run'; flow: Flow; session: RuntimeSession }
  | { name: 'edit'; flow: Flow }
  | { name: 'export'; flow: Flow }
  | { name: 'insight'; flow: Flow; source: FlowCatalogSource }
  | { name: 'import' }
  | { name: 'generate' };

export default function App() {
  const [fontsLoaded] = useFonts({ IBMPlexMono_200ExtraLight, IBMPlexMono_500Medium });
  const scheme = useColorScheme();
  const c = paletteFor(scheme);
  const { locale } = useI18n();
  const examples = useMemo(() => examplesFor(locale), [locale]);
  const examplesRef = useRef(examples);
  examplesRef.current = examples;
  const storage = useMemo(() => createStorage(asyncStorageKV), []);
  const library = useMemo(() => createLibrary(storage), [storage]);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const runtime = useMemo(() => createDefinitionRuntime({ storage, notifier, now: Date.now }), [storage, notifier]);
  const currentSession = useRef<RuntimeSession | null>(null);
  const notificationResponses = useMemo(() => createExpoNotificationResponseSource(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const editorBackHandler = useRef<(() => void) | null>(null);
  const registerEditorBackHandler = useCallback((handler: (() => void) | null): void => {
    editorBackHandler.current = handler;
  }, []);
  const [catalog, setCatalog] = useState<OwnedCatalogSnapshot>(LOADING_CATALOG);
  const catalogCoordinator = useMemo(() => createCatalogCoordinator(setCatalog), []);

  const home = useCallback((): void => {
    currentSession.current?.close();
    currentSession.current = null;
    setScreen({ name: 'home' });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Keep the first Back native while the IME is visible. Android gets to
      // dismiss the keyboard before application navigation is considered.
      if (decideApplicationBack(screen.name, Keyboard.isVisible()) === 'system') return false;

      if (screen.name === 'edit') {
        (editorBackHandler.current ?? home)();
      } else {
        // Every other non-Home screen already exits through home(), including
        // Runner/Schedule where home() closes the active RuntimeSession first.
        home();
      }
      return true;
    });

    return () => subscription.remove();
  }, [home, screen.name]);

  const openRun = useCallback((flowId: string, definitionKey: string): void => {
    const snapshot = catalogCoordinator.current();
    if (snapshot.status !== 'ready') return;
    const entry = resolveCatalogEntryForRoute(flowId, definitionKey, snapshot.flows, examplesRef.current);
    if (!entry) return;
    currentSession.current?.close();
    const session = runtime.open(entry.definitionKey);
    currentSession.current = session;
    setScreen({ name: 'run', flow: entry.flow, session });
  }, [catalogCoordinator, runtime]);

  useEffect(() => () => currentSession.current?.close(), []);

  const recoverDeletions = useCallback(() =>
    recoverPendingOwnedFlowDeletions({
      kv: asyncStorageKV,
      runtime,
      removeFlow: (id) => library.remove(id),
      unenroll: (key) => unenrollFlow(asyncStorageKV, key),
      cancelScheduledNotifications: (key) => cancelScheduledRemindersForDefinition({ kv: asyncStorageKV, notifier, definitionKey: key }),
      cancelNotifications: (ids) => notifier.cancel(ids),
      deleteRun: (id) => storage.deleteRun(id),
      deleteCheckIns: (key) => storage.deleteCheckIns(key),
      deleteRevisions: (id) => storage.deleteRevisions(id),
    }),
  [library, notifier, runtime, storage]);

  const projectCatalog = useCallback(async (): Promise<CatalogProjection> => {
    const flows = await library.list();
    await rescheduleReminders({
      kv: asyncStorageKV,
      notifier,
      flows: catalogEntriesWithOwnedPrecedence(examples, flows),
      now: Date.now(),
      deviceTz: systemTimeZone,
    });
    return { flows };
  }, [examples, library, notifier]);

  const runCatalogTask = useCallback((
    mutation?: () => Promise<void>,
  ): Promise<CatalogProjection> =>
    runCatalogCycle({
      recover: recoverDeletions,
      mutation,
      project: projectCatalog,
    }),
  [projectCatalog, recoverDeletions]);

  const refreshCatalog = useCallback((
    mutation?: () => Promise<void>,
  ): Promise<void> => catalogCoordinator.request(() => runCatalogTask(mutation)),
  [catalogCoordinator, runCatalogTask]);

  const runCatalogMutation = useCallback(
    <T,>(mutation: () => Promise<T>): Promise<T> =>
      runCommittedCatalogMutation(refreshCatalog, mutation),
    [refreshCatalog],
  );

  const guardFlowMutation = useCallback(async (flow: Flow): Promise<void> => {
    await assertFlowMutationKeepsActiveRunReachable({
      nextFlow: flow,
      currentOwned: await library.get(flow.id),
      examples,
      runs: storage,
    });
  }, [examples, library, storage]);

  const commitCatalogFlow = useCallback(
    (flow: Flow): Promise<Flow> =>
      runCatalogMutation(async () => {
        await guardFlowMutation(flow);
        return library.commit(flow);
      }),
    [guardFlowMutation, library, runCatalogMutation],
  );
  const importCatalogFlow = useCallback(
    (text: string, now: number): Promise<Flow> =>
      runCatalogMutation(async () => {
        await guardFlowMutation(deserializeFlow(text));
        return library.importFlow(text, now);
      }),
    [guardFlowMutation, library, runCatalogMutation],
  );
  const importCatalogBackup = useCallback(
    (backup: Parameters<typeof library.importBackup>[0]): Promise<number> =>
      runCatalogMutation(async () => {
        for (const flow of backup.flows) await guardFlowMutation(flow);
        return library.importBackup(backup);
      }),
    [guardFlowMutation, library, runCatalogMutation],
  );
  const restoreCatalogRevision = useCallback(
    (flow: Flow): Promise<Flow> =>
      runCatalogMutation(async () => {
        await guardFlowMutation(flow);
        return library.restore(flow);
      }),
    [guardFlowMutation, library, runCatalogMutation],
  );

  const deleteOwnedFlow = useCallback((
    flow: Flow,
    definitionKey: string,
  ): Promise<void> =>
    runCatalogMutation(() =>
      deleteOwnedFlowDurably(flow, definitionKey, {
        kv: asyncStorageKV,
        runtime,
        removeFlow: (id) => library.remove(id),
        unenroll: (key) => unenrollFlow(asyncStorageKV, key),
        cancelScheduledNotifications: (key) => cancelScheduledRemindersForDefinition({ kv: asyncStorageKV, notifier, definitionKey: key }),
        cancelNotifications: (ids) => notifier.cancel(ids),
        deleteRun: (id) => storage.deleteRun(id),
        deleteCheckIns: (key) => storage.deleteCheckIns(key),
        deleteRevisions: (id) => storage.deleteRevisions(id),
      })),
  [library, notifier, runCatalogMutation, runtime, storage]);

  const refreshCatalogInBackground = useCallback((
    mutation?: () => Promise<void>,
  ): void => {
    catalogCoordinator.background(() => runCatalogTask(mutation));
  }, [catalogCoordinator, runCatalogTask]);

  useEffect(() => {
    refreshCatalogInBackground();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshCatalogInBackground();
    });
    return () => sub.remove();
  }, [refreshCatalogInBackground]);

  // response source 只启动一次；catalog 未 ready 时等待 coordinator，而不是退订 listener。
  // 因此加载/删除恢复窗口中的多个 tap 仍由 response source 的串行队列完整保留。
  useEffect(() => {
    let active = true;
    const unsubscribe = notificationResponses.start(async (route: NotificationRouteData) => {
      const projection = await catalogCoordinator.waitForReady();
      if (!active) return;
      const entry = resolveCatalogEntryForRoute(
        route.flowId,
        route.definitionKey,
        projection.flows,
        examplesRef.current,
      );
      if (entry) {
        openRun(entry.flow.id, entry.definitionKey);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalogCoordinator, notificationResponses, openRun]);

  if (!fontsLoaded) return null;

  // Runner uses a dark immersive scene independent of the system appearance.
  // The shell owns safe-area paint and system-bar contrast for every screen.
  const immersiveRun = screen.name === 'run' && screen.flow.topology === 'sequential';
  const appBackground = immersiveRun ? dark.bg : c.canvas;
  const statusBarStyle = immersiveRun || scheme === 'dark' ? 'light' : 'dark';

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={styles.root}>
      <SafeAreaView
        style={[styles.root, { backgroundColor: appBackground }]}
        edges={['top', 'right', 'bottom', 'left']}
      >
        <StatusBar style={statusBarStyle} />
      {screen.name === 'home' ? (
        <HomeScreen
          library={library}
          examples={examples}
          catalog={catalog}
          sharer={systemSharer}
          onRetry={refreshCatalogInBackground}
          onRun={(flow, definitionKey) =>
            openRun(flow.id, definitionKey)}
          onNew={(topology: Topology) => setScreen({ name: 'edit', flow: createFlow({ id: newFlowId(), title: '', topology }) })}
          onEdit={(flow) => setScreen({ name: 'edit', flow })}
          onExport={(flow) => setScreen({ name: 'export', flow })}
          onInsight={(flow, source) => setScreen({ name: 'insight', flow, source })}
          onDelete={deleteOwnedFlow}
          onImport={() => setScreen({ name: 'import' })}
          onGenerate={() => setScreen({ name: 'generate' })}
        />
      ) : screen.name === 'run' ? (
        screen.flow.topology === 'scheduled' ? (
          <ScheduleScreen
            key={screen.session.id}
            flow={screen.flow}
            session={screen.session}
            notifier={notifier}
            onEnrollReminders={() => {
              if (!screen.session.isOpen()) return;
              refreshCatalogInBackground(async () => {
                if (screen.session.isOpen()) await enrollFlow(asyncStorageKV, screen.session.definitionKey);
              });
            }}
            onExit={home}
          />
        ) : (
          <RunnerScreen
            key={screen.session.id}
            flow={screen.flow}
            session={screen.session}
            onExit={home}
          />
        )
      ) : screen.name === 'edit' ? (
        <EditorScreen
          draft={screen.flow}
          saveFlow={commitCatalogFlow}
          onSaved={() => home()}
          onCancel={home}
          onBackHandlerChange={registerEditorBackHandler}
        />
      ) : screen.name === 'export' ? (
        <ExportScreen flow={screen.flow} sharer={systemSharer} onDone={home} />
      ) : screen.name === 'insight' ? (
        <InsightScreen
          flow={screen.flow}
          source={screen.source}
          library={library}
          restoreFlow={restoreCatalogRevision}
          onExit={home}
          onChanged={home}
        />
      ) : screen.name === 'generate' ? (
        <GenerateScreen
          secrets={secureKV}
          legacySecrets={asyncStorageKV}
          newFlowId={newFlowId}
          onDraft={(flow) => setScreen({ name: 'edit', flow })}
          onCancel={home}
        />
      ) : (
        <ImportScreen
          importFlow={importCatalogFlow}
          importBackup={importCatalogBackup}
          onImported={home}
          onCancel={home}
        />
      )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
