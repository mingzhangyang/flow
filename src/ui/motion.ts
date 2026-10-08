import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';
import { createReducedMotionSource } from './reducedMotionSource';

export * from './motionContract';

export const motionEasing = {
  press: Easing.out(Easing.quad),
  state: Easing.out(Easing.cubic),
  continuous: Easing.linear,
} as const;

const reducedMotionSource = createReducedMotionSource({
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  subscribe: (listener) => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', listener);
    return () => subscription.remove();
  },
});

/**
 * System-owned accessibility preference shared by every motion primitive.
 * The source starts conservatively at reduced motion until the platform value
 * resolves and reacts to runtime preference changes without persisting app state.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    reducedMotionSource.subscribe,
    reducedMotionSource.getSnapshot,
    reducedMotionSource.getSnapshot,
  );
}
