export interface ReducedMotionPlatform {
  read(): Promise<boolean>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}

export interface ReducedMotionSource {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * Small external store around the platform accessibility preference.
 *
 * - starts fail-closed in reduced-motion mode
 * - a runtime event wins over an older pending read
 * - read failures preserve the conservative snapshot
 * - one platform subscription is shared by every consumer
 */
export function createReducedMotionSource(
  platform: ReducedMotionPlatform,
): ReducedMotionSource {
  let snapshot = true;
  let started = false;
  let observedRuntimeChange = false;
  const listeners = new Set<() => void>();

  const publish = (enabled: boolean): void => {
    if (snapshot === enabled) return;
    snapshot = enabled;
    for (const listener of listeners) listener();
  };

  const start = (): void => {
    if (started) return;
    started = true;

    platform.subscribe((enabled) => {
      observedRuntimeChange = true;
      publish(enabled);
    });

    void platform.read()
      .then((enabled) => {
        if (!observedRuntimeChange) publish(enabled);
      })
      .catch(() => {
        // Fail closed: unknown accessibility state must never enable motion.
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
