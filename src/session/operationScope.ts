// UI results belong to the initiating screen, not to an async task's eventual completion.
// Closing the scope revokes result consumption but never interrupts accepted work (imports
// may have already committed). A submit slot closes synchronously against double taps.

export interface OperationHandlers<T> {
  success(value: T): void;
  failure(error: unknown): void;
  settled?(): void;
}

export interface OperationScope {
  submit<T>(work: () => Promise<T>, handlers: OperationHandlers<T>): boolean;
  latest<T>(work: () => Promise<T>, handlers: OperationHandlers<T>): void;
  /** Synchronously revoke a pending read projection when newer user input takes ownership. */
  invalidateLatest(): void;
  /** UI may start a side effect only while its initiating screen is still active. */
  isOpen(): boolean;
  /** The synchronous submission gate also guards navigation before React can rerender. */
  isBusy(): boolean;
  close(): void;
}

export function createOperationScope(): OperationScope {
  let open = true;
  let submitting = false;
  let latestToken = 0;
  return {
    submit(work, handlers) {
      if (!open || submitting) return false;
      submitting = true;
      latestToken++; // An accepted mutation supersedes unfinished read projections.
      void (async () => {
        try {
          const value = await work();
          if (open) handlers.success(value);
        } catch (error) {
          if (open) handlers.failure(error);
        } finally {
          submitting = false;
          if (open) handlers.settled?.();
        }
      })();
      return true;
    },
    latest(work, handlers) {
      if (!open) return;
      const token = ++latestToken;
      void (async () => {
        try {
          const value = await work();
          if (open && token === latestToken) handlers.success(value);
        } catch (error) {
          if (open && token === latestToken) handlers.failure(error);
        } finally {
          if (open && token === latestToken) handlers.settled?.();
        }
      })();
    },
    invalidateLatest() {
      latestToken++;
    },
    isOpen: () => open,
    isBusy: () => submitting,
    close() {
      open = false;
      latestToken++;
    },
  };
}
