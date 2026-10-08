// 环 + 珠：应用图标的形状语言直接成为界面。珠子在环上的位置即进度。
// 视觉进度只投影真实 runtime progress；事实源始终在 RunState。

import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { dark } from './theme';
import { motionDuration, motionEasing, useReducedMotion } from './motion';

const STALE_PROGRESS_GAP_MS = 1_200;

export function ProgressRing(props: {
  size: number;
  /** 0..1；珠子从 12 点方向出发顺时针走。 */
  progress: number;
  /** Step/status identity changes force a snap rather than replaying elapsed time. */
  motionKey?: string | number;
  /** 珠子颜色（如暂停时变暗、收尾时变暖）。 */
  beadColor?: string;
  children?: React.ReactNode;
}) {
  const { size } = props;
  const reducedMotion = useReducedMotion();
  const stroke = 2.5;
  const bead = 16;
  const r = size / 2 - stroke / 2;
  const progress = Math.min(Math.max(props.progress, 0), 1);
  const visualProgress = useRef(new Animated.Value(progress)).current;
  const previousKey = useRef(props.motionKey);
  const lastTargetAt = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    const keyChanged = previousKey.current !== props.motionKey;
    const staleGap =
      lastTargetAt.current !== null && now - lastTargetAt.current > STALE_PROGRESS_GAP_MS;

    previousKey.current = props.motionKey;
    lastTargetAt.current = now;
    visualProgress.stopAnimation();

    if (reducedMotion || keyChanged || staleGap) {
      visualProgress.setValue(progress);
      return;
    }

    const animation = Animated.timing(visualProgress, {
      toValue: progress,
      duration: motionDuration.progress,
      easing: motionEasing.continuous,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();

    return () => animation.stop();
  }, [progress, props.motionKey, reducedMotion, visualProgress]);

  const rotation = visualProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-90deg', '270deg'],
  });

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.track,
          { width: size, height: size, borderRadius: size / 2, borderWidth: stroke },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbit,
          {
            width: size,
            height: size,
            transform: [{ rotate: rotation }],
          },
        ]}
      >
        <View
          style={[
            styles.bead,
            {
              width: bead,
              height: bead,
              borderRadius: bead / 2,
              left: size / 2 + r - bead / 2,
              top: size / 2 - bead / 2,
              backgroundColor: props.beadColor ?? dark.accent,
            },
          ]}
        />
      </Animated.View>
      <View style={styles.center}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', borderColor: dark.border },
  orbit: { position: 'absolute', top: 0, left: 0 },
  bead: { position: 'absolute' },
  center: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
