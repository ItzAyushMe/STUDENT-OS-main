// Pure helpers for PLANB2 save stash — AsyncStorage key planb_save_stash
// No react-native, no supabase, no db — fully unit-testable pure JSON handling
// The actual AsyncStorage calls are in ScheduleScreen, but pure helpers here handle serialization

export const STASH_KEY = 'planb_save_stash';

export function stashSavePure(rows) {
  // pure: returns JSON string to stash
  if (!Array.isArray(rows)) return null;
  try {
    return JSON.stringify(rows);
  } catch {
    return null;
  }
}

export function readStashPure(jsonStr) {
  if (typeof jsonStr !== 'string' || !jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStashPure() {
  return null;
}

// Async wrappers for app usage (not pure, but convenience)
export async function stashSave(rows) {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const json = stashSavePure(rows);
    if (!json) return false;
    await AsyncStorage.setItem(STASH_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export async function clearStash() {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.removeItem(STASH_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function readStash() {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const raw = await AsyncStorage.getItem(STASH_KEY);
    return readStashPure(raw);
  } catch {
    return null;
  }
}

// For testing: roundtrip helpers
export function getStashCounts(stashedRows, storedRows) {
  const total = Array.isArray(stashedRows) ? stashedRows.length : 0;
  const stored = Array.isArray(storedRows) ? storedRows.length : 0;
  return { total, stored, missing: Math.max(0, total - stored) };
}
