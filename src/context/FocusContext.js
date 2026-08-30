// ============================================================
// StudentOS — Focus engine (Pomodoro + Focus Shield)
// Absolute-time based phases (robust to backgrounding),
// soft distraction shield with 30s "are you sure?" delay,
// session logging + reflection prompts.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useGame } from './GameContext';
import { useSettings } from './SettingsContext';
import { db } from '../lib/db';
import { playSfx } from '../lib/soundService';
import { nowIso, uuid } from '../lib/utils';

const FocusCtx = createContext(null);

const SHIELD_SECONDS = 30;

export function FocusProvider({ children }) {
  const { profile } = useAuth();
  const { awardXP, pushNotice } = useGame();
  const settings = useSettings();
  const [session, setSession] = useState(null);
  const [shield, setShield] = useState(null); // { secondsLeft, reason }
  const [reflection, setReflection] = useState(null); // { rowId, minutes, mode, topic }
  const intervalRef = useRef(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const sfx = useCallback(
    (name) => {
      if (settings.soundEffects) playSfx(name);
    },
    [settings.soundEffects]
  );

  // ------- master tick -------
  useEffect(() => {
    if (!session) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(async () => {
      const s = sessionRef.current;
      if (!s || s.pausedAt) return;
      if (Date.now() >= new Date(s.endsAt).getTime()) {
        await completePhase(s.id);
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------- shield countdown -------
  useEffect(() => {
    if (!shield) return;
    if (shield.secondsLeft <= 0) return;
    const t = setTimeout(() => {
      setShield((sh) => (sh ? { ...sh, secondsLeft: sh.secondsLeft - 1 } : null));
    }, 1000);
    return () => clearTimeout(t);
  }, [shield]);

  // ------- background = distraction -------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        attemptDistraction('left the app');
      }
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(
    ({ mode = 'classic', focusMinutes = 25, breakMinutes = 5, topic = '', subject = '' }) => {
      const now = new Date();
      setSession({
        id: uuid(),
        mode,
        phase: 'focus',
        focusMinutes,
        breakMinutes,
        startedAt: now.toISOString(),
        phaseStartedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + focusMinutes * 60000).toISOString(),
        pausedAt: null,
        topic,
        subject,
        cycles: 0,
        distractions: 0,
      });
    },
    []
  );

  const pause = useCallback(() => {
    setSession((s) => (s && !s.pausedAt ? { ...s, pausedAt: nowIso() } : s));
  }, []);

  const resume = useCallback(() => {
    setSession((s) => {
      if (!s || !s.pausedAt) return s;
      const pausedMs = Date.now() - new Date(s.pausedAt).getTime();
      return {
        ...s,
        pausedAt: null,
        endsAt: new Date(new Date(s.endsAt).getTime() + pausedMs).toISOString(),
      };
    });
  }, []);

  const recordSession = useCallback(
    async (s, minutes, opts = {}) => {
      if (!profile?.id || minutes < 1) return null;
      const row = await db.insert('focus_sessions', {
        user_id: profile.id,
        start_time: opts.startAt || s.phaseStartedAt,
        end_time: nowIso(),
        duration_minutes: Math.round(minutes),
        mode: s.mode,
        topic: s.topic || null,
        focus_rating: null,
        reflection: null,
        xp_earned: 0,
        distractions: s.distractions || 0,
        created_at: nowIso(),
      });
      return row;
    },
    [profile?.id]
  );

  // complete the current phase (called by tick or manually)
  const completePhase = useCallback(
    async (sid) => {
      const s = sessionRef.current;
      if (!s || s.id !== sid) return;
      const now = new Date();

      if (s.phase === 'focus') {
        sfx('complete');
        const row = await recordSession(s, s.focusMinutes);
        setSession({
          ...s,
          phase: 'break',
          cycles: s.cycles + 1,
          phaseStartedAt: now.toISOString(),
          endsAt: new Date(now.getTime() + s.breakMinutes * 60000).toISOString(),
        });
        if (row) setReflection({ rowId: row.id, minutes: s.focusMinutes, mode: s.mode, topic: s.topic });
        pushNotice(`Shaabaash! ${s.focusMinutes} min done — break time ☕`);
      } else {
        setSession({
          ...s,
          phase: 'focus',
          phaseStartedAt: now.toISOString(),
          endsAt: new Date(now.getTime() + s.focusMinutes * 60000).toISOString(),
        });
        pushNotice('Break khatam — wapas grind! 💪');
      }
    },
    [recordSession, sfx, pushNotice]
  );

  const skipPhase = useCallback(
    async () => {
      const s = sessionRef.current;
      if (!s) return;
      const now = new Date();
      if (s.phase === 'break') {
        setSession({
          ...s,
          phase: 'focus',
          phaseStartedAt: now.toISOString(),
          endsAt: new Date(now.getTime() + s.focusMinutes * 60000).toISOString(),
        });
      } else {
        setSession({
          ...s,
          phase: 'break',
          phaseStartedAt: now.toISOString(),
          endsAt: new Date(now.getTime() + s.breakMinutes * 60000).toISOString(),
        });
      }
    },
    []
  );

  // stop early: partial credit, no reflection prompt
  const stopSession = useCallback(
    async (opts = {}) => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.phase === 'focus' && !s.pausedAt) {
        const focusedMin = Math.floor((Date.now() - new Date(s.phaseStartedAt).getTime()) / 60000);
        if (focusedMin >= 1) {
          const row = await recordSession(s, focusedMin);
          if (row) {
            await db.update('focus_sessions', row.id, { xp_earned: Math.round(focusedMin / 2) });
            await awardXP('FOCUS_SESSION', {
              amount: Math.round(focusedMin / 2),
              label: 'Partial session',
            });
          }
        }
      }
      setSession(null);
      setShield(null);
      if (!opts.silent) pushNotice('Session ended. Koi baat nahi — kal phir! 💪');
    },
    [recordSession, awardXP, pushNotice]
  );

  // ------- Focus Shield (soft block) -------
  const attemptDistraction = useCallback((reason) => {
    const s = sessionRef.current;
    if (!s || s.pausedAt || s.phase !== 'focus') return;
    setSession((cur) => (cur ? { ...cur, distractions: (cur.distractions || 0) + 1 } : cur));
    setShield({ secondsLeft: SHIELD_SECONDS, reason });
  }, []);

  const stayFocused = useCallback(() => setShield(null), []);

  const leaveAnyway = useCallback(async () => {
    setShield(null);
    await stopSession({ silent: false });
  }, [stopSession]);

  // ------- reflection -------
  const submitReflection = useCallback(
    async ({ rating, note }) => {
      const r = reflection;
      if (!r) return;
      setReflection(null);
      try {
        await db.update('focus_sessions', r.rowId, {
          focus_rating: rating || null,
          reflection: note || null,
        });
      } catch (e) {
        /* ignore */
      }
      await awardXP('FOCUS_SESSION', { minutes: r.minutes, label: 'Focus session' });
    },
    [reflection, awardXP]
  );

  const dismissReflection = useCallback(
    async (skipXP = false) => {
      const r = reflection;
      setReflection(null);
      if (!skipXP && r) {
        await awardXP('FOCUS_SESSION', { minutes: r.minutes, label: 'Focus session' });
      }
    },
    [reflection, awardXP]
  );

  const value = useMemo(
    () => ({
      session,
      shield,
      reflection,
      start,
      pause,
      resume,
      stopSession,
      skipPhase,
      attemptDistraction,
      stayFocused,
      leaveAnyway,
      submitReflection,
      dismissReflection,
    }),
    [session, shield, reflection, start, pause, resume, stopSession, skipPhase, attemptDistraction, stayFocused, leaveAnyway, submitReflection, dismissReflection]
  );

  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

export function useFocus() {
  const ctx = useContext(FocusCtx);
  if (!ctx) throw new Error('useFocus must be used inside FocusProvider');
  return ctx;
}
