// ============================================================
// StudentOS — starter data seeding (first-run)
// Seeds preloaded habits + a TRACK-SCOPED syllabus:
//   1. Class/board syllabus   (primary — highest priority)
//   2. Olympiad track         (secondary)
//   3. Competitive exam track (last — optional layer)
// Idempotent — never duplicates. A Class 10 + JEE student gets
// the CLASS 10 syllabus first; JEE is a separate track.
// ============================================================
import { db } from './db';
import { nowIso } from './utils';
import { HABIT_PRESETS } from '../config/constants';
import { pickSyllabusSet } from '../data/syllabusData';
// FIX-S S5: the row mapping + the ONE dedupe rule live in a db-free module so
// they are unit-testable; this file keeps only the effectful half (db writes).
import { buildPresetRows, selectFreshPresetRows } from './presetRows';

export async function seedHabits(userId) {
  // v1.0.6 Y Round3: make idempotent by name — prevents duplicates if onboarding re-enters or setTimeout fires twice
  const existing = await db.list('habits', { eq: { user_id: userId } });
  const existingNames = new Set(existing.map((r) => (r.name || '').trim().toLowerCase()));
  const rows = HABIT_PRESETS.filter((h) => !existingNames.has((h.name || '').trim().toLowerCase())).map((h) => ({
    user_id: userId,
    name: h.name,
    category: h.category,
    icon: h.icon,
    target_time: h.target_time || null,
    part: h.part,
    is_active: true,
    created_at: nowIso(),
  }));
  if (!rows.length) return 0;
  await db.insertMany('habits', rows);
  return rows.length;
}

// Kept for every existing caller; the mapping itself now lives in presetRows.js.
export function presetToRows(userId, preset, track) {
  return buildPresetRows(userId, preset, track);
}

// Legacy single-preset picker kept for compatibility — class FIRST now.
export function pickSyllabusPreset(profile = {}) {
  return pickSyllabusSet(profile).class;
}

// Full set: { class, exam, olympiad } presets for a profile.
export { pickSyllabusSet };

export async function seedSyllabus(userId, opts = {}) {
  const existing = await db.list('syllabus', { eq: { user_id: userId }, limit: 1 });
  if (existing && existing.length) return 0;

  const set = pickSyllabusSet(opts);
  // priority order: class -> olympiad -> exam
  const rows = [
    ...presetToRows(userId, set.class, 'class'),
    ...presetToRows(userId, set.olympiad, 'olympiad'),
    ...presetToRows(userId, set.exam, 'exam'),
  ];
  if (!rows.length) return 0;
  await db.insertMany('syllabus', rows);
  return rows.length;
}

// Import a SINGLE track (used by the Syllabus screen's per-track import).
// track: 'class' | 'olympiad' | 'exam'
// v1.0.6 recovery H: no early exit, merge only missing chapters, no dupes, preserve completed
export async function seedSyllabusTrack(userId, profile, track) {
  const set = pickSyllabusSet(profile);
  const preset = set[track];
  if (!preset?.rows?.length) return 0;

  const existingRows = await db.list('syllabus', { eq: { user_id: userId, track } });
  // Only insert chapters that don't already exist for this track. FIX-S S5: an
  // ARCHIVED row is superseded history and never blocks a fresh chapter of the
  // same name (selectFreshPresetRows holds that rule for every caller).
  const { fresh } = selectFreshPresetRows(userId, preset, track, existingRows);

  if (!fresh.length) return 0;
  await db.insertMany('syllabus', fresh);
  return fresh.length;
}

// ============================================================
// FIX-S S5: the ONE dedupe-safe preset import.
// Extracted from SyllabusScreen's screen-local importPreset so the promotion
// accept path and the syllabus screen share identical behaviour (NEW Y note).
//
// ARCHIVED rows are superseded history (e.g. Class 10 rows kept after promotion
// to Class 11): they never block a fresh import of the same subject::chapter and
// they are never reported as "already imported". Without this, an archived
// Class 10 "Science::Life Processes" row would silently swallow the Class 11
// chapter of the same name.
//
// @param {string} userId
// @param {{label?:string, rows:Array}} preset  e.g. CLASS_SYLLABI['Class 11']
// @param {string} track                       'class' | 'olympiad' | 'exam'
// @param {object} opts  { existing?: Array }  pre-fetched rows for this track
//                       (tests inject these; the app lets it read the db)
// @returns {Promise<{inserted:number, skipped:number, rows:Array}>}
// ============================================================
export async function importPresetRows(userId, preset, track, opts = {}) {
  const presetRows = preset && Array.isArray(preset.rows) ? preset.rows : [];
  if (!userId || !presetRows.length) return { inserted: 0, skipped: 0, rows: [] };

  const existingRows = Array.isArray(opts.existing)
    ? opts.existing
    : await db.list('syllabus', { eq: { user_id: userId, track } });

  // pure decision (unit-tested in presetRows.js), then the only write
  const { all, fresh } = selectFreshPresetRows(userId, preset, track, existingRows, { stamp: opts.stamp });
  if (!fresh.length) return { inserted: 0, skipped: all.length, rows: [] };

  const inserted = await db.insertMany('syllabus', fresh);
  return {
    inserted: fresh.length,
    skipped: all.length - fresh.length,
    rows: Array.isArray(inserted) && inserted.length ? inserted : fresh,
  };
}
