// ============================================================
// StudentOS — auth + profile context
// Owns the session (Supabase auth or local guest) and the
// user's profile row (the `users` table).
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authService } from '../lib/auth';
import { db, isRemote } from '../lib/db';
import { nowIso, uuid } from '../lib/utils';
import { STREAK_FREEZE_START } from '../config/constants';

const AuthCtx = createContext(null);

async function defaultProfile(session, extra = {}) {
  const base = {
    id: session.userId,
    username: extra.username || session.username || (session.email ? session.email.split('@')[0] : 'player'),
    email: session.email || '',
    display_name: extra.display_name || '',
    avatar_url: null,
    class_level: '',
    board: '',
    competitive_exam: '',
    exam_date: null,
    olympiad: '',
    daily_study_hours: 2,
    preferred_time: '',
    prep_level: '',
    days_off: [],
    commitments: '',
    total_xp: 0,
    current_streak: 0,
    longest_streak: 0,
    streak_freezes: STREAK_FREEZE_START,
    last_active_date: null,
    level: 1,
    tier: 'Bronze',
    privacy: 'friends',
    onboarded: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const existing = await db.list('users', { eq: { id: session.userId } });
  if (existing && existing.length) return existing[0];
  const created = await db.insert('users', base);
  return created;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const booted = useRef(false);

  const load = useCallback(async () => {
    try {
      const s = await authService.getSession();
      if (!s) {
        setSession(null);
        setProfile(null);
        return;
      }
      const p = await defaultProfile(s);
      setSession(s);
      setProfile(p);
    } catch (e) {
      setSession(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    load().finally(() => setLoading(false));
  }, [load]);

  const applyAuth = useCallback(
    async (result) => {
      const s = result.session || result;
      const p = await defaultProfile(s, result.username ? { username: result.username } : {});
      setSession(s);
      setProfile(p);
      return p;
    },
    []
  );

  const signUp = useCallback((creds) => authService.signUp(creds).then(applyAuth), [applyAuth]);
  const signIn = useCallback((creds) => authService.signIn(creds).then(applyAuth), [applyAuth]);
  const signInWithGoogle = useCallback(() => authService.signInWithGoogle().then(applyAuth), [applyAuth]);

  const continueAsGuest = useCallback(
    () => authService.continueAsGuest().then(applyAuth),
    [applyAuth]
  );

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
      if (profile?.id) {
        try {
          await db.update('users', profile.id, patch);
        } catch (e) {
          // keep optimistic state; local mode never throws here in practice
        }
      }
      // re-read authoritative row
      try {
        const rows = await db.list('users', { eq: { id: profile.id } });
        if (rows && rows[0]) setProfile(rows[0]);
      } catch {
        /* ignore */
      }
    },
    [profile?.id]
  );

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      cloudMode: isRemote(),
      signUp,
      signIn,
      signInWithGoogle,
      continueAsGuest,
      signOut,
      updateProfile,
      reloadProfile: load,
    }),
    [session, profile, loading, signUp, signIn, signInWithGoogle, continueAsGuest, signOut, updateProfile, load]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
