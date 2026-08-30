// ============================================================
// StudentOS — settings context
// AI provider + keys (runtime override), sound effects toggle,
// ambient sound default volume, daily reminder.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setRuntimeConfig, initRuntimeConfig, aiStatus } from '../lib/aiService';
import { AI_PROVIDER } from '../config/constants';

const KEY = 'sos.settings';

const DEFAULTS = {
  aiProvider: null, // null -> follow AI_PROVIDER constant
  geminiKey: '',
  groqKey: '',
  soundEffects: true,
  ambientVolume: 0.6,
  dailyReminder: null, // 'HH:MM' or null
};

const SettingsCtx = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    (async () => {
      try {
        await initRuntimeConfig();
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const stored = JSON.parse(raw);
          setSettings((s) => ({ ...s, ...stored }));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const update = useCallback(async (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      // push AI config into the service layer
      if ('aiProvider' in patch || 'geminiKey' in patch || 'groqKey' in patch) {
        setRuntimeConfig({
          provider: next.aiProvider || null,
          geminiKey: next.geminiKey || null,
          groqKey: next.groqKey || null,
        });
      }
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const effectiveProvider = settings.aiProvider || AI_PROVIDER;
    return {
      ...settings,
      effectiveProvider,
      aiStatus: aiStatus(),
      update,
    };
  }, [settings, update]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
