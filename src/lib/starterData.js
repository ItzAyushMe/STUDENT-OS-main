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

export async function seedHabits(userId) {
  const existing = await db.list('habits', { eq: { user_id: userId }, limit: 1 });
  if (existing && existing.length) return 0;
  const rows = HABIT_PRESETS.map((h) => ({
    user_id: userId,
    name: h.name,
    category: h.category,
    icon: h.icon,
    target_time: h.target_time || null,
    part: h.part,
    is_active: true,
    created_at: nowIso(),
  }));
  await db.insertMany('habits', rows);
  return rows.length;
}

function presetToRows(userId, preset, track) {
  if (!preset) return [];
  return preset.rows.map((r) => ({
    user_id: userId,
    subject: r.subject,
    chapter: r.chapter,
    topic: null,
    subtopic: null,
    track, // 'class' | 'olympiad' | 'exam'
    weightage: r.weightage || 3,
    estimated_hours: r.estimated_hours || 6,
    status: 'locked',
    progress_percent: 0,
    deadline: null,
    completed_at: null,
    created_at: nowIso(),
  }));
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
export async function seedSyllabusTrack(userId, profile, track) {
  const existing = await db.list('syllabus', { eq: { user_id: userId, track }, limit: 1 });
  if (existing && existing.length) return 0;
  const set = pickSyllabusSet(profile);
  const preset = set[track];
  const rows = presetToRows(userId, preset, track);
  if (!rows.length) return 0;
  await db.insertMany('syllabus', rows);
  return rows.length;
}
