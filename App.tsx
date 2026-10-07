// 准时 / Zhunshi —— 应用外壳。
// Catalog snapshot、提醒重排、提醒登记和持久化删除恢复统一走一个串行 coordinator。
// Home / 通知路由只消费 coordinator 发布的权威 snapshot。

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
  resolveCatalogEntryForRoute,
  type CatalogProjection,
  type FlowCatalogSource,
  type OwnedCatalogSnapshot,
} from './src/session/flowCatalog';
import { createCatalogCoordinator } from './src/session/catalogCoordinator';
import { createLegacyIdentityRegistry } from './src/session/legacyIdentityRegistry';
import { runCommittedCatalogMutation } from './src/session/catalogMutation';
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
  | { name: 'run'; flow: Flow; definitionKey: string; legacyFlowId?: string }
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
  const legacyIdentities = useMemo(() => createLegacyIdentityRegistry(asyncStorageKV), []);
  const library = useMemo(() => createLibrary(storage, legacyIdentities), [storage, legacyIdentities]);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const notificationResponses = useMemo(() => createExpoNotificationResponseSource(), []);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [catalog, setCatalog] = useState<OwnedCatalogSnapshot>(LOADING_CATALOG);
  const catalogCoordinator = useMemo(() => createCatalogCoordinator(setCatalog), []);

  const home = (): void => setScreen({ name: 'home' });

  const runCatalogTask = useCallback(async (
    mutation?: () => Promise<void>,
  ): Promise<CatalogProjection> => {
    if (mutation) await mutation();

    await recoverPendingOwnedFlowDeletions({
      kv: asyncStorageKV,
      removeFlow: (id) => library.remove(id),
      unenroll: (key, legacyId) => unenrollFlow(asyncStorageKV, key, legacyId),
      markLegacyAmbiguous: (id) => legacyIdentities.mark(id),
      deleteRun: (id) => storage.deleteRun(id),
      deleteDefinitionCheckIns: (key) => storage.deleteDefinitionCheckIns(key),
      deleteLegacyCheckIns: (id) => storage.deleteCheckIns(id),
    });

    const flows = await library.list();

    // Ambiguity is historical state, not merely a property of today's catalog. Before a
    // shadowing catalog can ever become ready, persist the tombstone so later example-set
    // changes, deletion, restart, or backup/restore cannot reopen bare-ID migration.
    const exampleIds = new Set(examples.map((flow) => flow.id));
    for (const flow of flows) {
      if (exampleIds.has(flow.id)) await legacyIdentities.mark(flow.id);
    }
    const legacyAmbiguousFlowIds = await legacyIdentities.read();

    await rescheduleReminders({
      kv: asyncStorageKV,
      notifier,
      flows: catalogEntriesWithOwnedPrecedence(examples, flows, legacyAmbiguousFlowIds),
      now: Date.now(),
      deviceTz: systemTimeZone,
    });
    return { flows, legacyAmbiguousFlowIds };
  }, [examples, legacyIdentities, library, notifier, storage]);

  const refreshCatalog = useCallback((
    mutation?: () => Promise<void>,
  ): Promise<void> => catalogCoordinator.request(() => runCatalogTask(mutation)),
  [catalogCoordinator, runCatalogTask]);

  const runCatalogMutation = useCallback(
    <T,>(mutation: () => Promise<T>): Promise<T> =>
      runCommittedCatalogMutation(refreshCatalog, mutation),
    [refreshCatalog],
  );

  const commitCatalogFlow = useCallback(
    (flow: Flow): Promise<Flow> => runCatalogMutation(() => library.commit(flow)),
    [library, runCatalogMutation],
  );
  const importCatalogFlow = useCallback(
    (text: string, now: number): Promise<Flow> =>
      runCatalogMutation(() => library.importFlow(text, now)),
    [library, runCatalogMutation],
  );
  const importCatalogBackup = useCallback(
    (backup: Parameters<typeof library.importBackup>[0]): Promise<number> =>
      runCatalogMutation(() => library.importBackup(backup)),
    [library, runCatalogMutation],
  );
  const restoreCatalogRevision = useCallback(
    (flow: Flow): Promise<Flow> => runCatalogMutation(() => library.restore(flow)),
    [library, runCatalogMutation],
  );

  const deleteOwnedFlow = useCallback((
    flow: Flow,
    definitionKey: string,
    legacyFlowId?: string,
  ): Promise<void> =>
    runCatalogMutation(() =>
      deleteOwnedFlowDurably(flow, definitionKey, legacyFlowId, {
        kv: asyncStorageKV,
        removeFlow: (id) => library.remove(id),
        unenroll: (key, legacyId) => unenrollFlow(asyncStorageKV, key, legacyId),
        markLegacyAmbiguous: (id) => legacyIdentities.mark(id),
        deleteRun: (id) => storage.deleteRun(id),
        deleteDefinitionCheckIns: (key) => storage.deleteDefinitionCheckIns(key),
        deleteLegacyCheckIns: (id) => storage.deleteCheckIns(id),
      })),
  [legacyIdentities, library, runCatalogMutation, storage]);

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
        projection.legacyAmbiguousFlowIds,
      );
      if (entry) {
        setScreen({
          name: 'run',
          flow: entry.flow,
          definitionKey: entry.definitionKey,
          ...(entry.legacyFlowId ? { legacyFlowId: entry.legacyFlowId } : {}),
        });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalogCoordinator, notificationResponses]);

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
          onRetry={refreshCatalogInBackground}
          onRun={(flow, definitionKey, legacyFlowId) =>
            setScreen({
              name: 'run',
              flow,
              definitionKey,
              ...(legacyFlowId ? { legacyFlowId } : {}),
            })}
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
            key={JSON.stringify([screen.definitionKey, screen.flow.version ?? 1])}
            flow={screen.flow}
            definitionKey={screen.definitionKey}
            legacyFlowId={screen.legacyFlowId}
            storage={storage}
            notifier={notifier}
            onEnrollReminders={(definitionKey) => {
              refreshCatalogInBackground(() => enrollFlow(asyncStorageKV, definitionKey));
            }}
            onExit={home}
          />
        ) : (
          <RunnerScreen
            key={JSON.stringify([screen.definitionKey, screen.flow.version ?? 1])}
            flow={screen.flow}
            definitionKey={screen.definitionKey}
            legacyFlowId={screen.legacyFlowId}
            storage={storage}
            notifier={notifier}
            onExit={home}
          />
        )
      ) : screen.name === 'edit' ? (
        <EditorScreen draft={screen.flow} saveFlow={commitCatalogFlow} onSaved={() => home()} onCancel={home} />
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
