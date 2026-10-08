import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

export * from './motionContract';

export const motionEasing = {
  press: Easing.out(Easing.quad),
  state: Easing.out(Easing.cubic),
  continuous: Easing.linear,
} as const;

/**
 * System-owned accessibility preference. Start conservatively so no motion is
 * emitted before the asynchronous platform preference has been read.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let alive = true;
    let observedRuntimeChange = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      observedRuntimeChange = true;
      if (alive) setReducedMotion(enabled);
    });

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive && !observedRuntimeChange) setReducedMotion(enabled);
      })
      .catch(() => {
        if (alive && !observedRuntimeChange) setReducedMotion(false);
      });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
