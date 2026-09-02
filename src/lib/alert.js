// Cross-platform alerts (React Native Alert doesn't work on web).
import { Alert, Platform } from 'react-native';

export function infoAlert(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message || ''}`);
    return;
  }
  Alert.alert(title, message);
}

export function confirmAlert(title, message, onConfirm, confirmText = 'Confirm', destructive = false) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message || ''}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, onPress: onConfirm, style: destructive ? 'destructive' : 'default' },
  ]);
}
