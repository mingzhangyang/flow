// Application-level Android back contract.
//
// The shell decides whether Android should keep the native back action (Home /
// keyboard dismissal) or whether the current application screen should follow
// its existing exit path. Screen-specific confirmation stays with that screen.

export type ApplicationScreenName =
  | 'home'
  | 'run'
  | 'edit'
  | 'export'
  | 'insight'
  | 'import'
  | 'generate';

export type ApplicationBackDecision = 'system' | 'exit-screen';

export function decideApplicationBack(
  screen: ApplicationScreenName,
  keyboardVisible: boolean,
): ApplicationBackDecision {
  if (keyboardVisible || screen === 'home') return 'system';
  return 'exit-screen';
}
