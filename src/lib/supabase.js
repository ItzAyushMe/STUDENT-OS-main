// ============================================================
// StudentOS — Supabase client
// If EXPO_PUBLIC_SUPABASE_URL / ANON_KEY are set (via .env),
// the app runs in CLOUD MODE (Postgres + Auth + Storage + RLS).
// If not set, everything falls back to LOCAL MODE (offline,
// device-only storage) so the app is fully usable without setup.
// ============================================================
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const SUPABASE_URL = url;

export const isSupabaseConfigured = Boolean(
  url && anonKey && url.startsWith('http') && !url.includes('placeholder')
);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;
