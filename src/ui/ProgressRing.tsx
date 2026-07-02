// 环 + 珠：应用图标的形状语言直接成为界面。珠子在环上的位置即进度——
// 纯 View 实现（三角函数定位），不引入 SVG 依赖。纯展示组件。

import { View, StyleSheet } from 'react-native';
import { dark } from './theme';

export function ProgressRing(props: {
  size: number;
  /** 0..1；珠子从 12 点方向出发顺时针走。 */
  progress: number;
  /** 珠子颜色（如暂停时变暗、收尾时变暖）。 */
  beadColor?: string;
  children?: React.ReactNode;
}) {
  const { size } = props;
  const stroke = 2.5;
  const bead = 16;
  const r = size / 2 - stroke / 2;
  const angle = Math.min(Math.max(props.progress, 0), 1) * Math.PI * 2 - Math.PI / 2;
  const cx = size / 2 + r * Math.cos(angle);
  const cy = size / 2 + r * Math.sin(angle);

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.track,
          { width: size, height: size, borderRadius: size / 2, borderWidth: stroke },
        ]}
      />
      <View
        style={[
          styles.bead,
          {
            width: bead,
            height: bead,
            borderRadius: bead / 2,
            left: cx - bead / 2,
            top: cy - bead / 2,
            backgroundColor: props.beadColor ?? dark.accent,
          },
        ]}
      />
      <View style={styles.center}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', borderColor: dark.faint },
  bead: { position: 'absolute' },
  center: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
