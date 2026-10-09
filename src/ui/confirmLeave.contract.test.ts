import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerWithBrowserConfirm } from './confirmLeave';

const dialog = { title: 'Unsaved', message: 'Leaving loses it', stayLabel: 'Stay', leaveLabel: 'Leave' };

test('web confirmation answers with the browser dialog, showing title and message', () => {
  let shown = '';
  assert.equal(answerWithBrowserConfirm((text) => { shown = text; return true; }, dialog), true);
  assert.match(shown, /Unsaved[\s\S]*Leaving loses it/);
  assert.equal(answerWithBrowserConfirm(() => false, dialog), false);
});

test('missing or failing browser dialog means stay, never a silent bypass or a hang', () => {
  assert.equal(answerWithBrowserConfirm(undefined, dialog), false);
  assert.equal(answerWithBrowserConfirm(() => { throw new Error('blocked'); }, dialog), false);
});
