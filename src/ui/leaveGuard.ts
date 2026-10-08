// A single ownership contract for leaving screens with unsaved user intent.
// The screen decides whether to allow, block, or ask. The App owns navigation
// and checks route identity AFTER an asynchronous confirmation (C6/C9/AI-C1).

export type LeaveDisposition = 'allow' | 'block' | 'confirm';

export interface LeaveGuard {
  request(): Promise<boolean>;
  /** Abort an unresolved confirmation when the initiating screen goes away. */
  cancel(): void;
}

/** A shared confirmation is consumed by concurrent Back and notification actions. */
export function createLeaveGuard(deps: {
  disposition(): LeaveDisposition;
  prompt(resolve: (approved: boolean) => void): void;
}): LeaveGuard {
  let pending: { result: Promise<boolean>; finish: (approved: boolean) => void } | null = null;

  return {
    request() {
      if (pending) return pending.result;
      const disposition = deps.disposition();
      if (disposition !== 'confirm') return Promise.resolve(disposition === 'allow');

      let release!: (approved: boolean) => void;
      const result = new Promise<boolean>((resolve) => { release = resolve; });
      const current: { result: Promise<boolean>; finish: (approved: boolean) => void } = {
        result,
        finish: (approved: boolean) => {
          if (pending !== current) return; // Alert dismissal can follow button press.
          pending = null;
          // A new save may start while a confirmation is visible. Approval
          // must never overrule the screen's current "saving" block.
          release(approved && deps.disposition() !== 'block');
        },
      };
      pending = current;
      try {
        deps.prompt(current.finish);
      } catch {
        current.finish(false); // Never bypass the guard when a platform alert fails.
      }
      return result;
    },
    cancel() {
      pending?.finish(false);
    },
  };
}

/**
 * Route ownership is the same object identity used by App.activeRoute.
 * An old confirmation cannot replace a newer route, regardless of approval.
 */
export async function authorizeRouteExit<Route>(
  origin: Route,
  current: () => Route,
  request: () => Promise<boolean>,
): Promise<boolean> {
  try {
    const approved = await request();
    return approved && current() === origin;
  } catch {
    // A failed confirmation is not permission to leave.
    return false;
  }
}
