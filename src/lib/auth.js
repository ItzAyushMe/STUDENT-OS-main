// ============================================================
// StudentOS — auth service
// CLOUD MODE : Supabase email/password + Google OAuth
// LOCAL MODE: device-only accounts (guest / local email accounts)
// ============================================================
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { supabase, isSupabaseConfigured, SUPABASE_URL } from './supabase';
import { uuid } from './utils';

const SESSION_KEY = 'sos.session';
const LOCAL_USERS_KEY = 'sos.local.users';

// session shape: { userId, email, username, mode: 'local' | 'supabase' }

const readJson = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeJson = async (key, val) => AsyncStorage.setItem(key, JSON.stringify(val));

function parseQueryParams(url) {
  const out = {};
  try {
    const q = String(url).split('?')[1] || '';
    for (const part of q.split('&')) {
      const [k, v] = part.split('=');
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  } catch {
    /* ignore */
  }
  return out;
}

export const authService = {
  isRemote: () => isSupabaseConfigured,

  async getSession() {
    if (isSupabaseConfigured) {
      const { data } = await supabase.auth.getSession();
      const u = data?.session?.user;
      if (u) {
        return { userId: u.id, email: u.email || '', mode: 'supabase' };
      }
      // fall through to a possible local guest session if cloud session expired
    }
    const local = await readJson(SESSION_KEY);
    if (local) return local;
    return null;
  },

  // ---- email / password ----
  async signUp({ email, password, username }) {
    email = String(email || '').trim().toLowerCase();
    if (!email || !password) throw new Error('Email aur password dono chahiye.');
    if (password.length < 6) throw new Error('Password at least 6 characters ka hona chahiye.');

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      const user = data?.user;
      if (!user) throw new Error('Check your inbox and confirm your email, then sign in.');
      const session = { userId: user.id, email, mode: 'supabase' };
      await writeJson(SESSION_KEY, session);
      return { session, username };
    }

    const users = (await readJson(LOCAL_USERS_KEY)) || {};
    if (users[email]) throw new Error('Ye account already hai — sign in karo.');
    const id = uuid();
    users[email] = {
      id,
      email,
      username: username || email.split('@')[0],
      // Local mode only — obfuscated, never leaves the device.
      secret: btoa(unescape(encodeURIComponent(`sos::${password}::${email}`))),
    };
    await writeJson(LOCAL_USERS_KEY, users);
    const session = { userId: id, email, mode: 'local' };
    await writeJson(SESSION_KEY, session);
    return { session, username: users[email].username };
  },

  async signIn({ email, password }) {
    email = String(email || '').trim().toLowerCase();
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const session = { userId: data.user.id, email, mode: 'supabase' };
      await writeJson(SESSION_KEY, session);
      return session;
    }

    const users = (await readJson(LOCAL_USERS_KEY)) || {};
    const u = users[email];
    if (!u) throw new Error('No account found with this email. Sign up first!');
    const secret = btoa(unescape(encodeURIComponent(`sos::${password}::${email}`)));
    if (secret !== u.secret) throw new Error('Galat password. Try again!');
    const session = { userId: u.id, email, mode: 'local' };
    await writeJson(SESSION_KEY, session);
    return session;
  },

  // ---- Google OAuth (cloud mode) ----
  async signInWithGoogle() {
    if (!isSupabaseConfigured) {
      throw new Error('Google sign-in needs Supabase. Configure .env first (see README).');
    }
    // WEB: full-page redirect via the Supabase client — most reliable.
    // detectSessionInUrl:true in supabase.js picks the session up on return.
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(`Google sign-in nahi chala: ${error.message}`);
      return { redirecting: true }; // page navigates away
    }
    // NATIVE (Expo Go / app): auth session popup
    const redirectTo = 'studentos://auth-callback';
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);
    if (result.type !== 'success' || !result.url) {
      throw new Error('Google sign-in cancel ho gaya.');
    }
    const params = parseQueryParams(result.url);
    if (params.access_token && params.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) throw new Error(error.message);
      const { data } = await supabase.auth.getSession();
      const u = data?.session?.user;
      if (!u) throw new Error('Google sign-in failed. Try again.');
      const session = { userId: u.id, email: u.email || '', mode: 'supabase' };
      await writeJson(SESSION_KEY, session);
      return session;
    }
    throw new Error('Google sign-in failed. Check the redirect URLs in your Supabase config.');
  },

  // ---- guest / instant play (local mode) ----
  async continueAsGuest() {
    const existing = await readJson(SESSION_KEY);
    if (existing) return existing;
    const session = { userId: uuid(), email: '', username: 'player', mode: 'local' };
    await writeJson(SESSION_KEY, session);
    return session;
  },

  async signOut() {
    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
    }
    await AsyncStorage.removeItem(SESSION_KEY);
  },
};
