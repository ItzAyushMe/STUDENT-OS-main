// NEW X R3: hasEarnedToday helper — once-per-day guard for Arena, Decks etc
// Cloud: xp_events, Local: AsyncStorage marker sos.xpOnce.{key}.{date}
// Cached per session to avoid repeat queries

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, isRemote } from './db';
import { todayStr, localDateOf } from './utils';

const cache = new Map(); // key: `${userId}::${xpKey}::${date}` -> boolean

function cacheKey(userId, xpKey, date) {
  return `${userId}::${xpKey}::${date}`;
}

export async function hasEarnedToday(userId, xpKey) {
  if (!userId || !xpKey) return false;
  const date = todayStr();
  const ck = cacheKey(userId, xpKey, date);
  if (cache.has(ck)) return cache.get(ck);

  let earned = false;
  try {
    if (isRemote()) {
      // Cloud: check xp_events for today
      const rows = await db.list('xp_events', {
        eq: { user_id: userId },
        order: { col: 'created_at', asc: false },
        limit: 50,
      });
      earned = rows.some((r) => {
        // key mapping: arena -> ARENA_COMPLETE, deck:subject:topic -> FLASHCARD_REVIEW with meta
        if (xpKey === 'arena') {
          return r.code === 'ARENA_COMPLETE' && localDateOf(r.created_at) === date;
        }
        if (xpKey.startsWith('deck:')) {
          // deck key includes subject+topic, check code and meta or label contains key
          if (r.code !== 'FLASHCARD_REVIEW') return false;
          if (localDateOf(r.created_at) !== date) return false;
          // meta may contain deckKey
          try {
            const meta = r.meta ? (typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta) : {};
            if (meta.deckKey && meta.deckKey === xpKey) return true;
            // fallback: label contains deck info or we treat any FLASHCARD_REVIEW today as earned for this deck if meta missing? Safer to check label includes subject
            // For simplicity, if no meta, we consider it earned only if we have exact marker in AsyncStorage as well
          } catch {}
          return false;
        }
        // generic: code matches uppercased key or contains key
        return r.code === xpKey && localDateOf(r.created_at) === date;
      });
      // Also check AsyncStorage marker as secondary (in case cloud lag)
      if (!earned) {
        const marker = await AsyncStorage.getItem(`sos.xpOnce.${xpKey}.${date}.${userId}`);
        earned = !!marker;
      }
    } else {
      const marker = await AsyncStorage.getItem(`sos.xpOnce.${xpKey}.${date}.${userId}`);
      earned = !!marker;
    }
  } catch {
    // on error, assume not earned to avoid blocking
    earned = false;
  }

  cache.set(ck, earned);
  return earned;
}

export async function markEarnedToday(userId, xpKey, extraMeta = null) {
  if (!userId || !xpKey) return;
  const date = todayStr();
  const ck = cacheKey(userId, xpKey, date);
  cache.set(ck, true);
  try {
    await AsyncStorage.setItem(`sos.xpOnce.${xpKey}.${date}.${userId}`, JSON.stringify({ at: new Date().toISOString(), meta: extraMeta }));
  } catch {}
}

export function clearXpOnceCache() {
  cache.clear();
}
