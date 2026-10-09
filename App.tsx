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
import { createModelConfigSession } from './src/ai/model/settings';
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
import { decideApplicationBackTarget } from './src/ui/applicationBack';
import { authorizeRouteExit, createRouteExitRegistry } from './src/ui/leaveGuard';

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
  // Shared by all Generate screen instances: pending legacy migration cannot
  // overtake a newer user-edited configuration save.
  const modelConfig = useMemo(() => createModelConfigSession(secureKV, asyncStorageKV), []);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const runtime = useMemo(() => createDefinitionRuntime({ storage, notifier, now: Date.now }), [storage, notifier]);
  const currentSession = useRef<RuntimeSession | null>(null);
  const notificationResponses = useMemo(() => createExpoNotificationResponseSource(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // Imperative route ownership is updated BEFORE React commits its next render.
  // Delayed AI/import completions cannot navigate after Back, including a return
  // to another instance of the same screen name.
  const activeRoute = useRef<Screen>(screen);
  const routeExits = useMemo(() => createRouteExitRegistry<Screen>(), []);
  useEffect(() => () => routeExits.close(), [routeExits]);
  // Deletion spans catalog, runtime retirement and notification cleanup. Hold a
  // synchronous app-level navigation fence across the entire accepted mutation.
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useCallback((next: Screen): void => {
    if (deletingRef.current) return;
    const previous = activeRoute.current;
    activeRoute.current = next;
    if (previous !== next) routeExits.invalidate(previous);
    setScreen(next);
  }, [routeExits]);

  // All external navigation uses the current screen's ONE registered guard.
  // A protected screen with no mounted guard fails closed, never silently
  // bypassing pending/failed writes or Editor dirty-discard.
  const authorizeLeave = useCallback((origin: Screen): Promise<boolean> => {
    if (activeRoute.current !== origin) return Promise.resolve(false);
    const protectedRoute = origin.name === 'edit' || origin.name === 'run';
    const request = protectedRoute ? routeExits.get(origin) : async () => true;
    if (!request) return Promise.resolve(false);
    return authorizeRouteExit(origin, () => activeRoute.current, request);
  }, [routeExits]);
  const [catalog, setCatalog] = useState<OwnedCatalogSnapshot>(LOADING_CATALOG);
  const catalogCoordinator = useMemo(() => createCatalogCoordinator(setCatalog), []);

  const home = useCallback((): void => {
    if (deletingRef.current) return;
    currentSession.current?.close();
    currentSession.current = null;
    navigate({ name: 'home' });
  }, [navigate]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // A notification may replace run A with run B without changing the name
      // "run". Always read the live route, never a closure-captured topology.
      const route = activeRoute.current;
      const target = decideApplicationBackTarget(
        { name: route.name, ...(route.name === 'run' ? { topology: route.flow.topology } : {}) },
        Keyboard.isVisible(),
      );
      if (target === 'system') return false;
      if (target === 'editor' || target === 'schedule' || target === 'runner') {
        // The same async confirmation used by notification-driven replacement.
        // Recheck route identity after the Alert settles: stale confirmations
        // must never close or navigate a newer RuntimeSession.
        void authorizeLeave(route).then((allowed) => {
          if (allowed && activeRoute.current === route) home();
        });
      } else {
        home();
      }
      return true;
    });

    return () => subscription.remove();
  }, [authorizeLeave, home]);

  const openRun = useCallback(async (flowId: string, definitionKey: string): Promise<void> => {
    if (deletingRef.current) return;
    const origin = activeRoute.current;
    // A notification for the CURRENT run should not throw away a retryable
    // check-in intent by needlessly creating another RuntimeSession.
    if (origin.name === 'run' && origin.flow.id === flowId &&
        origin.session.definitionKey === definitionKey) return;
    // Notification delivery is already serialized by notificationResponsesCore.
    // Await the actual UI decision before closing the old session or opening
    // a new one, preserving retry if the user cancels.
    if (!await authorizeLeave(origin) || deletingRef.current ||
        activeRoute.current !== origin) return;
    // Re-resolve AFTER confirmation: catalog ownership may change while
    // the user decides, and an obsolete notification must not open that Flow.
    const snapshot = catalogCoordinator.current();
    if (snapshot.status !== 'ready') return;
    const entry = resolveCatalogEntryForRoute(flowId, definitionKey, snapshot.flows, examplesRef.current);
    if (!entry) return;
    const session = runtime.open(entry.definitionKey);
    currentSession.current?.close();
    currentSession.current = session;
    const next: Screen = { name: 'run', flow: entry.flow, session };
    // The notification response source processes taps serially. Do not release
    // its next queued tap until this new run screen (scheduled or sequential)
    // has registered its leave guard in useLayoutEffect; no second tap can fall
    // through a mounting gap or be silently consumed without navigation.
    const mounted = routeExits.waitFor(next);
    navigate(next);
    await mounted;
  }, [authorizeLeave, catalogCoordinator, navigate, routeExits, runtime]);

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
  ): Promise<void> => {
    if (deletingRef.current) return Promise.reject(new Error('Deletion already in progress'));
    deletingRef.current = true; // Must precede any React render or async work.
    setDeleting(true);
    const result = runCatalogMutation(() =>
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
      }));
    return result.finally(() => {
      deletingRef.current = false;
      setDeleting(false);
    });
  }, [library, notifier, runCatalogMutation, runtime, storage]);

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
        // Await user confirmation before consuming the next queued notification.
        // Otherwise two foreground taps could race to replace the same Run.
        await openRun(entry.flow.id, entry.definitionKey);
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
          deleting={deleting}
          isActive={() => activeRoute.current === screen}
          catalog={catalog}
          sharer={systemSharer}
          onRetry={refreshCatalogInBackground}
          onRun={(flow, definitionKey) =>
            openRun(flow.id, definitionKey)}
          onNew={(topology: Topology) => navigate({ name: 'edit', flow: createFlow({ id: newFlowId(), title: '', topology }) })}
          onEdit={(flow) => navigate({ name: 'edit', flow })}
          onExport={(flow) => navigate({ name: 'export', flow })}
          onInsight={(flow, source) => navigate({ name: 'insight', flow, source })}
          onDelete={deleteOwnedFlow}
          onImport={() => navigate({ name: 'import' })}
          onGenerate={() => navigate({ name: 'generate' })}
        />
      ) : screen.name === 'run' ? (
        screen.flow.topology === 'scheduled' ? (
          <ScheduleScreen
            key={screen.session.id}
            flow={screen.flow}
            session={screen.session}
            notifier={notifier}
            onRegisterExit={(request) => routeExits.set(screen, request)}
            onEnrollReminders={() => {
              if (!screen.session.isOpen()) return;
              refreshCatalogInBackground(async () => {
                if (screen.session.isOpen()) await enrollFlow(asyncStorageKV, screen.session.definitionKey);
              });
            }}
            onExit={() => { if (activeRoute.current === screen) home(); }}
          />
        ) : (
          <RunnerScreen
            key={screen.session.id}
            flow={screen.flow}
            session={screen.session}
            onRegisterExit={(request) => routeExits.set(screen, request)}
            onExit={() => { if (activeRoute.current === screen) home(); }}
          />
        )
      ) : screen.name === 'edit' ? (
        <EditorScreen
          draft={screen.flow}
          saveFlow={commitCatalogFlow}
          onSaved={() => home()}
          onCancel={() => { if (activeRoute.current === screen) home(); }}
          onRegisterExit={(request) => routeExits.set(screen, request)}
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
          onChanged={() => {
            if (activeRoute.current === screen) home();
          }}
        />
      ) : screen.name === 'generate' ? (
        <GenerateScreen
          modelConfig={modelConfig}
          newFlowId={newFlowId}
          onDraft={(flow) => {
            if (activeRoute.current === screen) navigate({ name: 'edit', flow });
          }}
          onCancel={home}
        />
      ) : (
        <ImportScreen
          importFlow={importCatalogFlow}
          importBackup={importCatalogBackup}
          onImported={() => {
            if (activeRoute.current === screen) home();
          }}
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
