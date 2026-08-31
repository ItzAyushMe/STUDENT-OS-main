// ============================================================
// StudentOS — settings context
// AI provider + keys (runtime override), sound effects toggle,
// ambient sound default volume, daily reminder.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setRuntimeConfig, initRuntimeConfig, aiStatus, selfTestAI } from '../lib/aiService';
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
  // AI health from the startup self-test: {ok, provider?, reason?} | null
  const [aiHealth, setAiHealth] = useState(null);
  // always-current mirror of settings (side effects read from this,
  // never from the React state updater — keeps updates race-free)
  const ref = useRef(DEFAULTS);

  useEffect(() => {
    (async () => {
      try {
        await initRuntimeConfig();
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const stored = JSON.parse(raw);
          const next = { ...DEFAULTS, ...stored };
          ref.current = next;
          setSettings(next);
          // make sure the AI service sees stored keys immediately
          if (next.geminiKey || next.groqKey || next.aiProvider) {
            await setRuntimeConfig({
              provider: next.aiProvider || null,
              geminiKey: next.geminiKey || null,
              groqKey: next.groqKey || null,
            });
          }
        }
        // startup self-test — powers the "AI not connected" banner
        try {
          const health = await selfTestAI();
          setAiHealth(health);
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const update = useCallback(async (patch) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    // pure state update
    setSettings(next);
    // side effects (fire-and-forget storage + AI runtime config)
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    if ('aiProvider' in patch || 'geminiKey' in patch || 'groqKey' in patch) {
      await setRuntimeConfig({
        provider: next.aiProvider || null,
        geminiKey: next.geminiKey || null,
        groqKey: next.groqKey || null,
      });
    }
  }, []);

  const value = useMemo(() => {
    const effectiveProvider = settings.aiProvider || AI_PROVIDER;
    return {
      ...settings,
      effectiveProvider,
      aiStatus: aiStatus(),
      aiHealth,
      update,
      refreshAIHealth: async () => {
        try {
          setAiHealth(await selfTestAI());
        } catch {
          /* ignore */
        }
      },
    };
  }, [settings, update, aiHealth]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
