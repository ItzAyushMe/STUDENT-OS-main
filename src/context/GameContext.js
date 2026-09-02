// ============================================================
// StudentOS — game engine context
// awardXP(code) -> xp_events row + profile update (xp, level,
// tier, streak) + floating XP toast + LEVEL UP celebration.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';
import { db } from '../lib/db';
import { awardXPToProfile, streakOnActivity, levelForXp, tierForXp } from '../lib/xpService';
import { playSfx } from '../lib/soundService';
import { todayStr, uuid, nowIso } from '../lib/utils';

const GameCtx = createContext(null);

export function GameProvider({ children }) {
  const { profile, updateProfile } = useAuth();
  // HIGH-1: always-fresh profile accessor for the award chain
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const settings = useSettings();
  const [toasts, setToasts] = useState([]);
  const [celebration, setCelebration] = useState(null);
  const [notices, setNotices] = useState([]); // small info toasts (freeze earned etc.)
  const timers = useRef([]);

  const pushToast = useCallback((toast, ttl = 1500) => {
    const id = uuid();
    setToasts((t) => [...t, { ...toast, id }]);
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    timers.current.push(timer);
  }, []);

  const pushNotice = useCallback(
    (text) => {
      const id = uuid();
      setNotices((n) => [...n, { id, text }]);
      setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 3200);
    },
    []
  );

  // ---- the single entry point for earning XP ----
  // HIGH-1 (audit): awards are SERIALIZED through a promise queue. Quiz/Arena/
  // Battle finishes fire two awards back-to-back; running them concurrently
  // made the second one read a stale profile and overwrite the first's XP.
  const awardQueueRef = useRef(Promise.resolve());
  const awardXP = useCallback(
    (code, opts = {}) => {
      const run = async () => {
      if (!profile?.id) return null;
      try {
        const result = await awardXPToProfile(
          {
            profile,
            updateProfile,
            insert: (row) => db.insert('xp_events', row),
            getProfile: () => profileRef.current,
          },
          code,
          opts
        );
        if (!result) return null;

        const { gained, total, level, tier, leveledUp, streak, freezeEarned, freezeUsed } = result;

        if (gained > 0) pushToast({ amount: gained, label: opts.label });
        if (freezeUsed) pushNotice('🧊 Streak freeze used — streak saved!');
        if (freezeEarned) pushNotice('🎁 Streak freeze earned! (max 3)');
        if (streak?.changed && !freezeUsed) {
          // silent streak bump — flame UI updates automatically
        }
        if (leveledUp) {
          setCelebration({ id: uuid(), level, tier });
          if (settings.soundEffects) playSfx('levelup');
        }
        return result;
      } catch (e) {
        console.warn('[GameContext] awardXP failed', e?.message);
        return null;
      }
      };
      const p = awardQueueRef.current.then(run, run);
      awardQueueRef.current = p.catch(() => {});
      return p;
    },
    [profile, updateProfile, pushToast, pushNotice, settings.soundEffects]
  );

  // LOW-5 (audit): clear pending toast timers on unmount
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const dismissCelebration = useCallback(() => setCelebration(null), []);

  const value = useMemo(
    () => ({
      awardXP,
      toasts,
      notices,
      celebration,
      dismissCelebration,
      pushNotice,
      // convenience stats
      totalXp: profile?.total_xp || 0,
      level: levelForXp(profile?.total_xp || 0),
      tier: tierForXp(profile?.total_xp || 0),
      streak: profile?.current_streak || 0,
      freezes: profile?.streak_freezes || 0,
    }),
    [awardXP, toasts, notices, celebration, dismissCelebration, pushNotice, profile]
  );

  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}

export function useGame() {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}
