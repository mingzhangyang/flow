// 准时 / Zhunshi —— 应用外壳。
// Phase 1 MVP：内置两条示例 flow；点开后按拓扑进入运行界面（顺序型 Runner / 日程型 Schedule）。
// 简单的状态切换即导航，暂不引入路由库（Constraint 0：先别增加复杂度）。

import { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { type Flow } from './src/domain/types';
import { coffeeFlow } from './src/examples/coffee';
import { medicationFlow } from './src/examples/medication';
import { createStorage } from './src/storage/storage';
import { asyncStorageKV } from './src/storage/asyncStorageKv';
import { createExpoNotifier } from './src/notifications/expoNotifier';
import { HomeScreen } from './src/ui/HomeScreen';
import { RunnerScreen } from './src/ui/RunnerScreen';
import { ScheduleScreen } from './src/ui/ScheduleScreen';
import { colors } from './src/ui/theme';

const FLOWS: Flow[] = [coffeeFlow, medicationFlow];

export default function App() {
  const [active, setActive] = useState<Flow | null>(null);
  const storage = useMemo(() => createStorage(asyncStorageKV), []);
  const notifier = useMemo(() => createExpoNotifier(), []);
  const goHome = () => setActive(null);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {active === null ? (
        <HomeScreen flows={FLOWS} onOpen={setActive} />
      ) : active.topology === 'scheduled' ? (
        <ScheduleScreen flow={active} notifier={notifier} onExit={goHome} />
      ) : (
        <RunnerScreen flow={active} storage={storage} notifier={notifier} onExit={goHome} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
