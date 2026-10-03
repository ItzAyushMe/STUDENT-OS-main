// taughtTill.js — SCHED4 D2: done/new via taught-till slider per subject + individual toggles
// Uses existing fields only: status, progress_percent, completed_at. No DDL.
// Last-action-wins: slider sets contiguous prefix, individual toggle flips single row,
// next slider move overrides all.
//
// Pure, no side effects, no DB, no clock (nowIso injected).

/**
 * Returns leading contiguous completed count.
 * Example: [completed, completed, locked, completed] -> 2 (not 3)
 * because after first locked, contiguity breaks.
 * If all completed, returns length.
 */
export function computeTaughtTill(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let count = 0;
  for (const r of rows) {
    if (!r) break;
    const s = String(r.status || '').toLowerCase();
    if (s === 'completed') count += 1;
    else break;
  }
  return count;
}

/**
 * Total completed count (non-contiguous) — useful for display.
 */
export function countCompleted(rows = []) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => String(r?.status || '').toLowerCase() === 'completed').length;
}

/**
 * Build updateMany patches for taught-till slider.
 * @param {Array} rows sorted rows for one subject
 * @param {number} tillIndex 0..rows.length, how many leading chapters are taught
 * @param {string} now ISO timestamp for completed_at
 * @returns {Array<{id:string, patch:Object}>}
 */
export function buildTaughtTillUpdates(rows = [], tillIndex = 0, now) {
  const list = Array.isArray(rows) ? rows : [];
  const till = Math.max(0, Math.min(list.length, Math.floor(Number(tillIndex) || 0)));
  const stamp = now || new Date().toISOString();
  const updates = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || !r.id) continue;
    if (i < till) {
      // mark completed if not already
      if (String(r.status).toLowerCase() !== 'completed' || Number(r.progress_percent) !== 100) {
        updates.push({
          id: r.id,
          patch: { status: 'completed', progress_percent: 100, completed_at: stamp },
        });
      }
    } else {
      // mark locked/new
      if (String(r.status).toLowerCase() !== 'locked' || Number(r.progress_percent) !== 0) {
        updates.push({
          id: r.id,
          patch: { status: 'locked', progress_percent: 0, completed_at: null },
        });
      }
    }
  }
  return updates;
}

/**
 * Toggle single row: completed -> locked, else -> completed.
 * Returns patch.
 */
export function toggleRowPatch(row, now) {
  const stamp = now || new Date().toISOString();
  const isCompleted = String(row?.status || '').toLowerCase() === 'completed';
  if (isCompleted) {
    return { status: 'locked', progress_percent: 0, completed_at: null };
  }
  return { status: 'completed', progress_percent: 100, completed_at: stamp };
}

/**
 * Apply taught-till logic to in-memory rows (for tests / optimistic UI).
 * Returns new rows array (shallow cloned).
 */
export function applyTaughtTillInMemory(rows = [], tillIndex = 0, now) {
  const list = Array.isArray(rows) ? rows : [];
  const till = Math.max(0, Math.min(list.length, Math.floor(Number(tillIndex) || 0)));
  const stamp = now || new Date().toISOString();
  return list.map((r, i) => {
    if (!r) return r;
    if (i < till) {
      return { ...r, status: 'completed', progress_percent: 100, completed_at: stamp };
    }
    return { ...r, status: 'locked', progress_percent: 0, completed_at: null };
  });
}
