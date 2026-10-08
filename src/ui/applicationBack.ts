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

export type ApplicationBackTarget = 'system' | 'editor' | 'schedule' | 'home';
export interface ApplicationBackRoute {
  name: ApplicationScreenName;
  topology?: 'sequential' | 'scheduled';
}

/** Determine Back behavior from the CURRENT route, including the run topology. */
export function decideApplicationBackTarget(
  route: ApplicationBackRoute,
  keyboardVisible: boolean,
): ApplicationBackTarget {
  if (decideApplicationBack(route.name, keyboardVisible) === 'system') return 'system';
  if (route.name === 'edit') return 'editor';
  if (route.name === 'run' && route.topology === 'scheduled') return 'schedule';
  return 'home';
}

export function decideApplicationBack(
  screen: ApplicationScreenName,
  keyboardVisible: boolean,
): ApplicationBackDecision {
  if (keyboardVisible || screen === 'home') return 'system';
  return 'exit-screen';
}
