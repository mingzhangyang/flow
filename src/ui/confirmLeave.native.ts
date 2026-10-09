// Leave confirmation, native build: the system Alert. Same contract as confirmLeave.ts.
import { Alert } from 'react-native';
import { type LeaveConfirmation } from './confirmLeave';
export type { LeaveConfirmation } from './confirmLeave';

export function promptLeaveConfirmation(
  dialog: LeaveConfirmation,
  done: (approved: boolean) => void,
): void {
  Alert.alert(dialog.title, dialog.message, [
    { text: dialog.stayLabel, style: 'cancel', onPress: () => done(false) },
    { text: dialog.leaveLabel, style: 'destructive', onPress: () => done(true) },
  ], { cancelable: true, onDismiss: () => done(false) });
}
