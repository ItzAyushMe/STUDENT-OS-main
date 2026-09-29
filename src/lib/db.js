// ============================================================
// StudentOS — data layer
// One API for all tables. Uses Supabase (Postgres + RLS) when
// configured; otherwise a local AsyncStorage-backed store so the
// app works fully offline ("Local Mode").
//
//   db.list(table, { eq: {col: val}, gte: {col: val}, lte: {col: val},
//                    in: {col: [vals]}, order: {col, asc}, limit })
//   db.insert(table, row)          -> inserted row
//   db.insertMany(table, rows)     -> inserted rows
//   db.update(table, id, patch)    -> updated row
//   db.upsert(table, row)          -> row (insert or update by id)
//   db.remove(table, id)
//   db.removeWhere(table, eq)
//   db.count(table, eq)
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { nowIso, uuid } from './utils';

export const isRemote = () => isSupabaseConfigured;

// ---------- FIX-F5: identity safety — authenticated session is authoritative ----------
// Client correctness is fix path, never DB rules. Never rewrite user_id to force RLS.
// Guard: before any cloud write, get session.user.id, compare with profile.id / row user_id.
// If mismatch -> reload profile belonging to session.user.id, only continue if state matches.
// If no session -> no write + friendly message. On auth/token failure -> refresh once, retry once.
let _currentUserId = null;
let _reloadProfileCb = null;
let _cachedSessionUid = null;
let _cachedAt = 0;

export function setCurrentUserId(id) { _currentUserId = id; }
export function setReloadProfileCallback(cb) { _reloadProfileCb = cb; }

async function getSessionUid() {
  const now = Date.now();
  if (_cachedSessionUid && now - _cachedAt < 2000) return _cachedSessionUid;
  try {
    if (!isRemote()) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const uid = data?.session?.user?.id || null;
    _cachedSessionUid = uid;
    _cachedAt = now;
    return uid;
  } catch (e) {
    // FIX-F5: on auth/token failure -> refresh once
    try {
      const { data } = await supabase.auth.refreshSession();
      const uid = data?.session?.user?.id || data?.user?.id || null;
      _cachedSessionUid = uid;
      _cachedAt = Date.now();
      return uid;
    } catch {
      return null;
    }
  }
}

async function ensureIdentity(table, rowOrId, rowUserId) {
  if (!isRemote()) return; // local mode bypass
  const sessionUid = await getSessionUid();
  if (!sessionUid) {
    throw new Error('Session expired — please login again');
  }
  // If currentUserId mismatch with session, reload profile
  if (_currentUserId && _currentUserId !== sessionUid) {
    if (typeof _reloadProfileCb === 'function') {
      try { await _reloadProfileCb(); } catch {}
      // after reload, check again
      if (_currentUserId && _currentUserId !== sessionUid) {
        throw new Error('Session mismatch — reloading profile, please try again');
      }
    } else {
      throw new Error('Session mismatch — profile id does not match session, please re-login');
    }
  }
  // For users table, id must equal sessionUid
  if (table === 'users') {
    const idToCheck = typeof rowOrId === 'string' ? rowOrId : rowOrId?.id;
    if (idToCheck && idToCheck !== sessionUid) {
      throw new Error('Session mismatch — users.id must equal session uid, not stale profile id');
    }
  }
  // For tables with user_id, must equal sessionUid
  if (rowUserId && rowUserId !== sessionUid) {
    throw new Error('Session mismatch — user_id does not match session uid, reloading profile');
  }
  if (rowOrId && typeof rowOrId === 'object' && rowOrId.user_id && rowOrId.user_id !== sessionUid) {
    throw new Error('Session mismatch — row.user_id does not match session uid');
  }
}


// ---------------- local store ----------------
const KEY = (table) => `sos.db.${table}`;

async function localAll(table) {
  try {
    const raw = await AsyncStorage.getItem(KEY(table));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function localSave(table, rows) {
  const payload = JSON.stringify(rows);
  try {
    await AsyncStorage.setItem(KEY(table), payload);
  } catch (e) {
    // Storage quota exceeded (localStorage ~5MB on web). Prune growth
    // tables and retry — this is what made the app fail "more and
    // more" over time as xp_events/schedule/quiz history piled up.
    console.warn(`[db] storage write failed for ${table} — pruning old data and retrying…`);
    await pruneGrowthTables(true);
    try {
      await AsyncStorage.setItem(KEY(table), payload);
    } catch (e2) {
      // last resort: if THIS table is a growth table, keep only the newest rows
      const keep = GROWTH_KEEP[table];
      if (keep && Array.isArray(rows) && rows.length > Math.floor(keep / 2)) {
        const newest = [...rows]
          .sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')))
          .slice(0, Math.floor(keep / 2));
        await AsyncStorage.setItem(KEY(table), JSON.stringify(newest));
        return;
      }
      throw new Error(
        `Storage full — could not save ${table}. Settings → "Reset local data" se purana data hatao. (Original error: ${
          e2?.message || e?.message || 'quota'
        })`
      );
    }
  }
}

// Tables that grow forever in Local Mode. Capped automatically.
const GROWTH_KEEP = {
  xp_events: 250, // 1 row per XP award — biggest offender over time
  quiz_results: 120,
  focus_sessions: 120,
  mood_logs: 60,
  workout_logs: 80,
  habit_logs: 500,
};

// Prune old rows so the app NEVER dies of a full storage.
// aggressive=true (quota recovery) prunes to half the cap.
export async function pruneGrowthTables(aggressive = false) {
  const results = {};
  for (const [table, cap] of Object.entries(GROWTH_KEEP)) {
    try {
      const rows = await localAll(table);
      const keep = aggressive ? Math.floor(cap / 2) : cap;
      if (rows.length > keep) {
        const newest = [...rows]
          .sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')))
          .slice(0, keep);
        await AsyncStorage.setItem(KEY(table), JSON.stringify(newest));
        results[table] = `${rows.length} → ${newest.length}`;
      }
    } catch {
      /* keep going — pruning must never throw */
    }
  }
  // schedule history: drop rows older than 60 days
  try {
    const rows = await localAll('schedule');
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const kept = rows.filter((r) => !r.date || r.date >= cutoff);
    if (kept.length !== rows.length) {
      await AsyncStorage.setItem(KEY('schedule'), JSON.stringify(kept));
      results.schedule = `${rows.length} → ${kept.length}`;
    }
  } catch {
    /* ignore */
  }
  if (Object.keys(results).length) console.log('[db] pruned:', JSON.stringify(results));
  return results;
}

function matches(row, opts) {
  for (const [col, val] of Object.entries(opts.eq || {})) {
    if (row[col] !== val) return false;
  }
  for (const [col, val] of Object.entries(opts.neq || {})) {
    if (row[col] === val) return false;
  }
  for (const [col, vals] of Object.entries(opts.in || {})) {
    if (!vals.includes(row[col])) return false;
  }
  for (const [col, val] of Object.entries(opts.gte || {})) {
    if (!(row[col] >= val)) return false;
  }
  for (const [col, val] of Object.entries(opts.lte || {})) {
    if (!(row[col] <= val)) return false;
  }
  for (const [col, val] of Object.entries(opts.like || {})) {
    if (!String(row[col] || '').toLowerCase().includes(String(val).toLowerCase())) return false;
  }
  return true;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const { col, asc = true } = order;
  return [...rows].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av === bv) return 0;
    const r = av > bv ? 1 : -1;
    return asc ? r : -r;
  });
}

// ---------------- public API ----------------
export const db = {
  async list(table, opts = {}) {
    if (isRemote()) {
      // v1.0.6 J: guard empty in() — Supabase errors on empty array
      for (const [col, vals] of Object.entries(opts.in || {})) {
        if (!Array.isArray(vals) || vals.length === 0) {
          return [];
        }
      }
      let q = supabase.from(table).select('*');
      for (const [col, val] of Object.entries(opts.eq || {})) q = q.eq(col, val);
      for (const [col, val] of Object.entries(opts.neq || {})) q = q.neq(col, val);
      for (const [col, vals] of Object.entries(opts.in || {})) q = q.in(col, vals);
      for (const [col, val] of Object.entries(opts.gte || {})) q = q.gte(col, val);
      for (const [col, val] of Object.entries(opts.lte || {})) q = q.lte(col, val);
      for (const [col, val] of Object.entries(opts.like || {})) q = q.ilike(col, `%${val}%`);
      if (opts.order) q = q.order(opts.order.col, { ascending: opts.order.asc !== false });
      if (opts.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      if (error) throw new Error(`[db.list ${table}] ${error.message}`);
      return data || [];
    }
    let rows = await localAll(table);
    rows = rows.filter((r) => matches(r, opts));
    rows = sortRows(rows, opts.order);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  },

  async insert(table, row) {
    const full = { id: row.id || uuid(), created_at: row.created_at || nowIso(), ...row };
    if (isRemote()) {
      try {
        await ensureIdentity(table, full, full.user_id);
        const { data, error } = await supabase.from(table).insert(full).select().single();
        if (error) throw error;
        return data;
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        // v1.0.6 Y Round1: fallback if updated_at / created_at column missing in live DB (old deployments)
        if (msg.includes('updated_at')) {
          const { updated_at: _u, ...without } = full;
          const { data, error } = await supabase.from(table).insert(without).select().single();
          if (error) throw new Error(`[db.insert ${table}] ${error.message}`);
          return data;
        }
        if (msg.includes('created_at') && full.created_at) {
          const { created_at: _c, ...without } = full;
          const { data, error } = await supabase.from(table).insert(without).select().single();
          if (error) throw new Error(`[db.insert ${table}] ${error.message}`);
          return data;
        }
        throw new Error(`[db.insert ${table}] ${e.message || e}`);
      }
    }
    const rows = await localAll(table);
    rows.push(full);
    await localSave(table, rows);
    return full;
  },

  async insertMany(table, list) {
    if (!list || !list.length) return [];
    if (isRemote()) {
      const full = list.map((row) => ({ id: row.id || uuid(), created_at: row.created_at || nowIso(), ...row }));
      try {
        const { data, error } = await supabase.from(table).insert(full).select();
        if (error) throw error;
        return data || full;
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('updated_at')) {
          const without = full.map(({ updated_at: _u, ...r }) => r);
          const { data, error } = await supabase.from(table).insert(without).select();
          if (error) throw new Error(`[db.insertMany ${table}] ${error.message}`);
          return data || without;
        }
        if (msg.includes('created_at')) {
          const without = full.map(({ created_at: _c, ...r }) => r);
          const { data, error } = await supabase.from(table).insert(without).select();
          if (error) throw new Error(`[db.insertMany ${table}] ${error.message}`);
          return data || without;
        }
        throw new Error(`[db.insertMany ${table}] ${e.message || e}`);
      }
    }
    const rows = await localAll(table);
    const full = list.map((row) => ({ id: row.id || uuid(), created_at: row.created_at || nowIso(), ...row }));
    await localSave(table, rows.concat(full));
    return full;
  },

  async update(table, id, patch) {
    const full = { ...patch, updated_at: nowIso() };
    if (isRemote()) {
      try {
        await ensureIdentity(table, id, patch.user_id || null);
        const { data, error } = await supabase.from(table).update(full).eq('id', id).select().single();
        if (error) throw error;
        return data;
      } catch (e) {
        // v1.0.6 recovery: fallback if updated_at column missing in remote DB (old deployments)
        if (String(e?.message || '').toLowerCase().includes('updated_at')) {
          const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
          if (error) throw new Error(`[db.update ${table}] ${error.message}`);
          return data;
        }
        throw new Error(`[db.update ${table}] ${e.message || e}`);
      }
    }
    const rows = await localAll(table);
    let updated = null;
    const next = rows.map((r) => {
      if (r.id === id) {
        updated = { ...r, ...full };
        return updated;
      }
      return r;
    });
    await localSave(table, next);
    return updated;
  },

  async upsert(table, row) {
    const full = { id: row.id || uuid(), created_at: row.created_at || nowIso(), ...row };
    if (isRemote()) {
      try {
        await ensureIdentity(table, full, full.user_id);
        const { data, error } = await supabase.from(table).upsert(full).select().single();
        if (error) throw error;
        return data;
      } catch (e) {
        // fallback without updated_at if column missing
        if (String(e?.message || '').toLowerCase().includes('updated_at')) {
          const { updated_at: _u, ...without } = full;
          const { data, error } = await supabase.from(table).upsert(without).select().single();
          if (error) throw new Error(`[db.upsert ${table}] ${error.message}`);
          return data;
        }
        throw new Error(`[db.upsert ${table}] ${e.message || e}`);
      }
    }
    const rows = await localAll(table);
    const i = rows.findIndex((r) => r.id === full.id);
    if (i >= 0) {
      rows[i] = { ...rows[i], ...full, updated_at: nowIso() };
      await localSave(table, rows);
      return rows[i];
    }
    rows.push(full);
    await localSave(table, rows);
    return full;
  },

  async remove(table, id) {
    if (isRemote()) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(`[db.remove ${table}] ${error.message}`);
      return true;
    }
    const rows = await localAll(table);
    await localSave(table, rows.filter((r) => r.id !== id));
    return true;
  },

  async removeWhere(table, eq) {
    if (isRemote()) {
      // FIX-F5: if eq contains user_id, ensure it matches session
      if (eq && eq.user_id) {
        await ensureIdentity(table, null, eq.user_id);
      }
      let q = supabase.from(table).delete();
      for (const [col, val] of Object.entries(eq || {})) q = q.eq(col, val);
      const { error } = await q;
      if (error) throw new Error(`[db.removeWhere ${table}] ${error.message}`);
      return true;
    }
    const rows = await localAll(table);
    await localSave(table, rows.filter((r) => !matches(r, { eq })));
    return true;
  },

  async count(table, eq) {
    if (isRemote()) {
      let q = supabase.from(table).select('id', { count: 'exact', head: true });
      for (const [col, val] of Object.entries(eq || {})) q = q.eq(col, val);
      const { count, error } = await q;
      if (error) throw new Error(`[db.count ${table}] ${error.message}`);
      return count || 0;
    }
    const rows = await localAll(table);
    return rows.filter((r) => matches(r, { eq })).length;
  },
};

// Wipe all local-mode data (used by "Reset local data" in Settings)
export { getWeeklyGymSplit } from './gymSplit.js';

export async function wipeLocalData() {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k.startsWith('sos.'));
  await AsyncStorage.multiRemove(ours);
}
