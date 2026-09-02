// ============================================================
// StudentOS — auth + profile context
// Owns the session (Supabase auth or local guest) and the
// user's profile row (the `users` table).
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authService } from '../lib/auth';
import { db, isRemote } from '../lib/db';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
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
  // HIGH-4 (audit): users.username is UNIQUE. Two people whose emails start
  // with the same prefix would otherwise fail profile creation forever
  // (unique violation -> load() -> signed out on every reload). Retry with
  // a random suffix on collision.
  try {
    return await db.insert('users', base);
  } catch (e) {
    if (/duplicate key|unique/i.test(String(e?.message || ''))) {
      return await db.insert('users', {
        ...base,
        username: `${base.username}-${Math.floor(Math.random() * 900 + 100)}`,
      });
    }
    throw e;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const booted = useRef(false);
  // HIGH-1 (audit): back-to-back updateProfile/awardXP calls used to read a
  // STALE profile from a React closure, so the second XP award overwrote the
  // first (users.total_xp kept only the last delta). This ref is always the
  // freshest profile — synchronously updated — so awards can never interleave
  // on top of stale data.
  const profileRef = useRef(null);
  const setProfileSafe = useCallback((p) => {
    profileRef.current = p;
    setProfile(p);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await authService.getSession();
      if (!s) {
        setSession(null);
        setProfileSafe(null);
        return;
      }
      const p = await defaultProfile(s);
      setSession(s);
      setProfileSafe(p);
    } catch (e) {
      // HIGH-4 (audit): a failed profile load used to sign the user out
      // forever (e.g. username collision on first login). Keep the session —
      // the auth is valid; the profile can be retried.
      console.warn('[auth] profile load failed:', e?.message);
      setSession((cur) => cur);
    }
  }, [setProfileSafe]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    load().finally(() => setLoading(false));
  }, [load]);

  // MEDIUM-6 (audit): after the Google OAuth redirect returns, the tokens in
  // the URL can still be resolving when the initial load() ran — the app
  // would show the Auth screen even though login succeeded. Re-evaluate
  // whenever a session appears.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess?.user && !profileRef.current) load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const applyAuth = useCallback(
    async (result) => {
      const s = result.session || result;
      const p = await defaultProfile(s, result.username ? { username: result.username } : {});
      setSession(s);
      setProfileSafe(p);
      return p;
    },
    [setProfileSafe]
  );

  const signUp = useCallback((creds) => authService.signUp(creds).then(applyAuth), [applyAuth]);
  const signIn = useCallback((creds) => authService.signIn(creds).then(applyAuth), [applyAuth]);

  // MEDIUM-6 (audit): on web, Google sign-in redirects the whole page — the
  // service resolves { redirecting: true } with no session. Do NOT call
  // applyAuth for redirects (it would create a ghost profile with an
  // undefined user id before the page unloads).
  const signInWithGoogle = useCallback(
    () =>
      authService.signInWithGoogle().then((r) =>
        r && r.redirecting ? r : applyAuth(r)
      ),
    [applyAuth]
  );

  const continueAsGuest = useCallback(
    () => authService.continueAsGuest().then(applyAuth),
    [applyAuth]
  );

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    setProfileSafe(null);
  }, [setProfileSafe]);

  // HIGH-1 (audit): patches are applied on profileRef (always freshest) —
  // never on a stale closure snapshot. The optimistic state is set
  // synchronously BEFORE any await, so the next awardXP in the same tick
  // sees the updated totals. The old "re-read authoritative row" block is
  // GONE on purpose: it re-introduced the stale-overwrite race (a re-read
  // landing between two awards would clobber the first one). Authoritative
  // re-syncs happen in load()/reloadProfile only.
  const updateProfile = useCallback(
    async (patch) => {
      const base = profileRef.current;
      if (!base?.id) return;
      const next = { ...base, ...patch };
      profileRef.current = next; // synchronous — the next award sees this
      setProfile(next);
      try {
        await db.update('users', base.id, patch);
      } catch (e) {
        // keep optimistic state; local mode never throws here in practice
      }
    },
    []
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
