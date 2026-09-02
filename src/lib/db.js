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
      let q = supabase.from(table).select('*');
      for (const [col, val] of Object.entries(opts.eq || {})) q = q.eq(col, val);
      for (const [col, val] of Object.entries(opts.neq || {})) q = q.neq(col, val); // L-8 (audit): was silently ignored in cloud mode
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
      const { data, error } = await supabase.from(table).insert(full).select().single();
      if (error) throw new Error(`[db.insert ${table}] ${error.message}`);
      return data;
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
      const { data, error } = await supabase.from(table).insert(full).select();
      if (error) throw new Error(`[db.insertMany ${table}] ${error.message}`);
      return data || full;
    }
    const rows = await localAll(table);
    const full = list.map((row) => ({ id: row.id || uuid(), created_at: row.created_at || nowIso(), ...row }));
    await localSave(table, rows.concat(full));
    return full;
  },

  async update(table, id, patch) {
    const full = { ...patch, updated_at: nowIso() };
    if (isRemote()) {
      const { data, error } = await supabase.from(table).update(full).eq('id', id).select().single();
      if (error) throw new Error(`[db.update ${table}] ${error.message}`);
      return data;
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
      const { data, error } = await supabase.from(table).upsert(full).select().single();
      if (error) throw new Error(`[db.upsert ${table}] ${error.message}`);
      return data;
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
export async function wipeLocalData() {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k.startsWith('sos.'));
  await AsyncStorage.multiRemove(ours);
}
