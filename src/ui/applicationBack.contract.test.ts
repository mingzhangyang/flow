import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideApplicationBack,
  decideApplicationBackTarget,
  type ApplicationBackRoute,
  type ApplicationScreenName,
} from './applicationBack';

test('Home leaves Android back to the system', () => {
  assert.equal(decideApplicationBack('home', false), 'system');
});

test('visible keyboard keeps the first Android back native on every screen', () => {
  const screens: ApplicationScreenName[] = [
    'home',
    'edit',
    'run',
    'export',
    'insight',
    'import',
    'generate',
  ];
  for (const screen of screens) {
    assert.equal(decideApplicationBack(screen, true), 'system', screen);
  }
});

test('Android Back decision reads the latest run topology, including a same-name notification navigation', () => {
  // A single listener remains installed while the active route changes run -> run.
  // Its handler must dereference the live route rather than a captured render.
  let activeRoute: ApplicationBackRoute = { name: 'run', topology: 'sequential' };
  const pressBack = () => decideApplicationBackTarget(activeRoute, false);
  assert.equal(pressBack(), 'runner'); // Sequential Run exits through its save-aware guard.
  activeRoute = { name: 'run', topology: 'scheduled' };
  assert.equal(pressBack(), 'schedule');
  activeRoute = { name: 'edit' };
  assert.equal(pressBack(), 'editor');
  assert.equal(decideApplicationBackTarget(activeRoute, true), 'system');
});

test('non-Home screens use their application exit path when the keyboard is closed', () => {
  const screens: ApplicationScreenName[] = [
    'edit',
    'run',
    'export',
    'insight',
    'import',
    'generate',
  ];
  for (const screen of screens) {
    assert.equal(decideApplicationBack(screen, false), 'exit-screen', screen);
  }
});
