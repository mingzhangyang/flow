import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import {
  motionEasing,
  motionSpecFor,
  useReducedMotion,
  type SemanticMotion,
} from './motion';

type RevealMotion = Extract<SemanticMotion, 'state' | 'insertion' | 'confirmation'>;

export function MotionReveal(props: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  motion: RevealMotion;
  replayKey?: string | number;
  active?: boolean;
  animateOnMount?: boolean;
}) {
  const {
    active = true,
    animateOnMount = true,
    children,
    motion,
    replayKey,
    style,
  } = props;
  const reducedMotion = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    running.current?.stop();
    running.current = null;

    const shouldAnimate = active && (animateOnMount || mounted.current);
    mounted.current = true;

    if (!shouldAnimate || reducedMotion) {
      value.setValue(1);
      return;
    }

    const spec = motionSpecFor(false, motion);
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: spec.duration,
      easing: motionEasing.state,
      useNativeDriver: true,
      isInteraction: false,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (finished && running.current === animation) running.current = null;
    });

    return () => {
      animation.stop();
      if (running.current === animation) running.current = null;
    };
  }, [active, animateOnMount, motion, reducedMotion, replayKey, value]);

  useEffect(() => () => running.current?.stop(), []);

  const spec = motionSpecFor(reducedMotion, motion);
  const opacity = value.interpolate({ inputRange: [0, 1], outputRange: [spec.opacity, 1] });
  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [spec.translateY, 0] });
  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [spec.scale, 1] });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
