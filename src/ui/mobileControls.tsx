// Shared mobile interaction geometry only: no navigation semantics or visual theme policy.
import { StyleSheet, Text, View, type ColorValue, type StyleProp, type TextStyle } from 'react-native';
import { MotionPressable } from './MotionPressable';

export const mobileControlSize = {
  compact: 44,
  standard: 48,
  headerSide: 48,
} as const;

export const mobileHitTarget = StyleSheet.create({
  compact: { minWidth: mobileControlSize.compact, minHeight: mobileControlSize.compact, alignItems: 'center', justifyContent: 'center' },
  standard: { minHeight: mobileControlSize.standard, justifyContent: 'center' },
});

/** Text actions own an actual hit box; no hitSlop can collide with a neighbor. */
export function MobileTextAction(props: { label: string; accessibilityLabel?: string; textStyle: StyleProp<TextStyle>; onPress: () => void; disabled?: boolean }) {
  const disabled = props.disabled ?? false;
  return (
    <MotionPressable accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled }} disabled={disabled} onPress={props.onPress}
      style={[mobileHitTarget.compact, styles.textAction, disabled && styles.disabled]}>
      <Text style={props.textStyle}>{props.label}</Text>
    </MotionPressable>
  );
}

export function HeaderBackButton(props: {
  accessibilityLabel: string;
  color: ColorValue;
  onPress: () => void;
  disabled?: boolean;
}) {
  const disabled = props.disabled ?? false;
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={[styles.headerSide, disabled && styles.disabled]}
    >
      <Text style={[styles.backIcon, { color: props.color }]}>‹</Text>
    </MotionPressable>
  );
}

export function HeaderSideSpacer() {
  return <View style={styles.headerSide} />;
}

const styles = StyleSheet.create({
  headerSide: {
    width: mobileControlSize.headerSide,
    minWidth: mobileControlSize.headerSide,
    minHeight: mobileControlSize.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 32, lineHeight: 32, marginTop: -2 },
  textAction: { paddingHorizontal: 8 },
  disabled: { opacity: 0.45 },
});
