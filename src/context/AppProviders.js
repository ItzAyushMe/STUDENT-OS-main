// Compose all top-level providers.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ThemeProvider } from './ThemeContext';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';
import { GameProvider } from './GameContext';
import { FocusProvider } from './FocusContext';
import { pruneGrowthTables, isRemote } from '../lib/db';

export function AppProviders({ children }) {
  useEffect(() => {
    // Local Mode prune
    if (!isRemote()) {
      pruneGrowthTables(false).catch(() => {});
    }
    // FIX-NOTIF: re-register daily reminder on app start (OEM kills alarms)
    (async () => {
      try {
        if (Platform.OS === 'web') return;
        const raw = await AsyncStorage.getItem('sos.settings');
        if (!raw) return;
        const stored = JSON.parse(raw);
        const hhmm = stored?.dailyReminder;
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return;
        // ensure channel
        if (Platform.OS === 'android') {
          try {
            await Notifications.setNotificationChannelAsync('daily', {
              name: 'Daily reminder',
              importance: Notifications.AndroidImportance.HIGH,
              vibrationPattern: [0, 250, 250, 250],
              lightColor: '#6D28D9',
            });
          } catch {}
        }
        const [h, m] = hhmm.split(':').map(Number);
        await Notifications.cancelAllScheduledNotificationsAsync();
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'StudentOS 🎮',
            body: 'Aaj ke quests complete kiye? 15 min padh lo — shaabaash! 💪',
          },
          trigger: {
            hour: h || 20,
            minute: m || 0,
            repeats: true,
            type: 'daily',
            channelId: Platform.OS === 'android' ? 'daily' : undefined,
          },
        });
      } catch {}
    })();
  }, []);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>
          <GameProvider>
            <FocusProvider>{children}</FocusProvider>
          </GameProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
