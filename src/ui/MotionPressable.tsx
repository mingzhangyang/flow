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
  composePressTransform,
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
): StyleProp<ViewStyle> {
  const flattened = StyleSheet.flatten(style) ?? {};

  if (typeof flattened.transform === 'string') {
    const transform = scale.interpolate({
      inputRange: [0, 1],
      outputRange: [
        composePressTransform(flattened.transform, 0) as string,
        composePressTransform(flattened.transform, 1) as string,
      ],
    });
    return {
      ...flattened,
      transform: transform as unknown as ViewStyle['transform'],
    };
  }

  return {
    ...flattened,
    // AnimatedPressable accepts Animated.Value at runtime, while Pressable's
    // style callback type still describes the non-animated ViewStyle shape.
    transform: composePressTransform(
      flattened.transform,
      scale as unknown as number,
    ) as ViewStyle['transform'],
  };
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
      // Pressable accepts both array and string transforms, and callback styles
      // may switch representation over the component lifetime. Keep this short
      // 90–140 ms feedback on one stable JS driver rather than switching an
      // Animated.Value between native and JS drivers. Progress/reveal/confirmation
      // motion remains native-driven where the transform shape is fixed.
      useNativeDriver: false,
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
