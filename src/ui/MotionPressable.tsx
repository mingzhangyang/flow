import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  motionDuration,
  motionEasing,
  motionSpecFor,
  useReducedMotion,
} from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressMotion = 'compact' | 'card';

export type MotionPressableProps = PressableProps & {
  motion?: PressMotion;
};

function styleWithPressScale(
  style: StyleProp<ViewStyle>,
  scale: Animated.Value,
): Animated.WithAnimatedValue<ViewStyle> {
  const flattened = StyleSheet.flatten(style) ?? {};
  return {
    ...flattened,
    transform: [...(flattened.transform ?? []), { scale }],
  } as Animated.WithAnimatedValue<ViewStyle>;
}

/**
 * Shared tactile press feedback. It preserves the Pressable contract and only
 * projects interaction state into a visual transform; layout/touch geometry is
 * unchanged. Existing caller transforms are composed with the motion scale,
 * never replaced.
 */
export function MotionPressable({
  motion = 'compact',
  disabled = false,
  onPressIn,
  onPressOut,
  style,
  ...props
}: MotionPressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const stop = (): void => {
    running.current?.stop();
    running.current = null;
  };

  const animateTo = (toValue: number, duration: number): void => {
    stop();
    if (reducedMotion || disabled) {
      scale.setValue(1);
      return;
    }
    const animation = Animated.timing(scale, {
      toValue,
      duration,
      easing: motionEasing.press,
      useNativeDriver: true,
      isInteraction: false,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (finished && running.current === animation) running.current = null;
    });
  };

  useEffect(() => {
    if (reducedMotion || disabled) {
      stop();
      scale.setValue(1);
    }
  }, [disabled, reducedMotion, scale]);

  useEffect(() => () => stop(), []);

  const handlePressIn = (event: GestureResponderEvent): void => {
    if (!disabled) {
      animateTo(
        motionSpecFor(false, motion === 'card' ? 'pressCard' : 'pressCompact').scale,
        motionDuration.press,
      );
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent): void => {
    if (!disabled) animateTo(1, motionDuration.fast);
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={
        typeof style === 'function'
          ? (state) => styleWithPressScale(style(state), scale)
          : styleWithPressScale(style, scale)
      }
    />
  );
}
