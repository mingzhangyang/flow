import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideApplicationBack,
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
