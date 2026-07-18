// Native delivery policy contract. The Expo adapter itself is typechecked by
// the app build; these pure assertions keep foreground visibility, sound, and
// the stable Android channel from regressing in headless CI (C5/C10).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOREGROUND_REMINDER_BEHAVIOR,
  REMINDER_CHANNEL_ID,
  reminderContent,
} from './nativePolicy';

test('foreground reminders are visible and audible', () => {
  assert.deepEqual(FOREGROUND_REMINDER_BEHAVIOR, {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
});

test('scheduled reminder content explicitly requests the default sound', () => {
  assert.deepEqual(
    reminderContent({ id: 'r', at: 1, title: 'Flow', body: 'Next step' }),
    { title: 'Flow', body: 'Next step', sound: 'default' },
  );
  assert.equal(REMINDER_CHANNEL_ID, 'reminders');
});
