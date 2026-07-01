// 准时 / Zhunshi —— 应用外壳。
// Phase 3：内置示例 + 用户自建的 flow 库；可新建/编辑/导出/导入，按拓扑运行。
// 简单的状态机即导航（Constraint 0：先别引入路由库）。

import { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { type Flow, type Topology } from './src/domain/types';
import { createFlow } from './src/domain/editing';
import { coffeeFlow } from './src/examples/coffee';
import { medicationFlow } from './src/examples/medication';
import { createStorage } from './src/storage/storage';
import { asyncStorageKV } from './src/storage/asyncStorageKv';
import { createLibrary } from './src/session/library';
import { createExpoNotifier } from './src/notifications/expoNotifier';
import { HomeScreen } from './src/ui/HomeScreen';
import { RunnerScreen } from './src/ui/RunnerScreen';
import { ScheduleScreen } from './src/ui/ScheduleScreen';
import { EditorScreen } from './src/ui/EditorScreen';
import { ExportScreen } from './src/ui/ExportScreen';
import { ImportScreen } from './src/ui/ImportScreen';
import { colors } from './src/ui/theme';

const EXAMPLES: Flow[] = [coffeeFlow, medicationFlow];
const newFlowId = (): string => `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Screen =
  | { name: 'home' }
  | { name: 'run'; flow: Flow }
  | { name: 'edit'; flow: Flow }
  | { name: 'export'; flow: Flow }
  | { name: 'import' };

export default function App() {
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {screen.name === 'home' ? (
        <HomeScreen
          library={library}
          examples={EXAMPLES}
          refreshKey={refreshKey}
          onRun={(flow) => setScreen({ name: 'run', flow })}
          onNew={(topology: Topology) => setScreen({ name: 'edit', flow: createFlow({ id: newFlowId(), title: '', topology }) })}
          onEdit={(flow) => setScreen({ name: 'edit', flow })}
          onExport={(flow) => setScreen({ name: 'export', flow })}
          onImport={() => setScreen({ name: 'import' })}
        />
      ) : screen.name === 'run' ? (
        screen.flow.topology === 'scheduled' ? (
          <ScheduleScreen flow={screen.flow} storage={storage} notifier={notifier} onExit={home} />
        ) : (
          <RunnerScreen flow={screen.flow} storage={storage} notifier={notifier} onExit={home} />
        )
      ) : screen.name === 'edit' ? (
        <EditorScreen draft={screen.flow} library={library} onSaved={homeRefreshed} onCancel={home} />
      ) : screen.name === 'export' ? (
        <ExportScreen flow={screen.flow} onDone={home} />
      ) : (
        <ImportScreen library={library} onImported={homeRefreshed} onCancel={home} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
