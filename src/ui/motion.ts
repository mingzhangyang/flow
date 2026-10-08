import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

export * from './motionContract';

export const motionEasing = {
  press: Easing.out(Easing.quad),
  state: Easing.out(Easing.cubic),
  continuous: Easing.linear,
} as const;

let reducedMotionSnapshot = true;
let reducedMotionSubscriptionInstalled = false;
let reducedMotionReadStarted = false;
let observedRuntimeChange = false;
const reducedMotionListeners = new Set<(enabled: boolean) => void>();

function publishReducedMotion(enabled: boolean): void {
  reducedMotionSnapshot = enabled;
  for (const listener of reducedMotionListeners) listener(enabled);
}

function ensureReducedMotionSource(): void {
  if (!reducedMotionSubscriptionInstalled) {
    reducedMotionSubscriptionInstalled = true;
    AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      observedRuntimeChange = true;
      publishReducedMotion(enabled);
    });
  }

  if (!reducedMotionReadStarted) {
    reducedMotionReadStarted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!observedRuntimeChange) publishReducedMotion(enabled);
      })
      .catch(() => {
        // Fail closed: if the platform preference is unavailable, keep the
        // conservative reduced-motion snapshot (or a later runtime event).
      });
  }
}

/**
 * System-owned accessibility preference, shared by every motion primitive.
 * The cache starts conservatively at reduced motion until the platform value
 * resolves; later-mounted controls synchronously reuse the resolved value.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(reducedMotionSnapshot);

  useEffect(() => {
    ensureReducedMotionSource();
    setReducedMotion(reducedMotionSnapshot);
    reducedMotionListeners.add(setReducedMotion);
    return () => {
      reducedMotionListeners.delete(setReducedMotion);
    };
  }, []);

  return reducedMotion;
}
