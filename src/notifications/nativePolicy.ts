// Native reminder presentation policy, kept platform-neutral so the delivery
// contract is testable without loading React Native native modules (C10).

import { type Reminder } from './plan';

export const REMINDER_CHANNEL_ID = 'reminders';
export const REMINDER_CHANNEL_NAME = 'Zhunshi reminders';

/** Foreground reminders must remain visible and audible, just like background reminders. */
export const FOREGROUND_REMINDER_BEHAVIOR = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
} as const;

/** Sound is explicit: omitting it produces a silent notification on iOS. */
export function reminderContent(reminder: Reminder) {
  return {
    title: reminder.title,
    body: reminder.body,
    sound: 'default' as const,
  };
}
