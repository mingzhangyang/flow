// Leave confirmation, web / default build. react-native-web's Alert.alert is a no-op,
// so an Alert-based prompt would never answer and Back would silently do nothing.
// The native build (confirmLeave.native.ts) uses the system Alert with the same contract.

export interface LeaveConfirmation {
  title: string;
  message: string;
  stayLabel: string;
  leaveLabel: string;
}

type BrowserConfirm = (message: string) => boolean;

/** Pure core: no confirm capability (or a throwing one) means "stay", never a bypass. */
export function answerWithBrowserConfirm(
  confirm: BrowserConfirm | undefined,
  dialog: LeaveConfirmation,
): boolean {
  if (typeof confirm !== 'function') return false;
  try {
    return confirm(`${dialog.title}\n\n${dialog.message}`) === true;
  } catch {
    return false;
  }
}

export function promptLeaveConfirmation(
  dialog: LeaveConfirmation,
  done: (approved: boolean) => void,
): void {
  const confirm = (globalThis as { confirm?: BrowserConfirm }).confirm;
  done(answerWithBrowserConfirm(confirm?.bind(globalThis), dialog));
}
