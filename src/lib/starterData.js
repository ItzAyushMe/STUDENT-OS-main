// ============================================================
// StudentOS — starter data seeding (first-run)
// Seeds preloaded habits + a starter syllabus based on the
// student's class/exam. Idempotent — never duplicates.
// ============================================================
import { db } from './db';
import { nowIso } from './utils';
import { HABIT_PRESETS, SYLLABUS_PRESETS } from '../config/constants';

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

export function pickSyllabusPreset({ class_level = '', competitive_exam = '' }) {
  const exam = String(competitive_exam || '').toLowerCase();
  const cls = String(class_level || '').toLowerCase();
  if (exam.includes('neet')) return SYLLABUS_PRESETS.neet_bio;
  if (exam.includes('jee')) return SYLLABUS_PRESETS.class12_pcm;
  if (cls.includes('class 6') || cls.includes('class 7') || cls.includes('class 8')) {
    return SYLLABUS_PRESETS.foundation;
  }
  if (cls.includes('class 9') || cls.includes('class 10')) return SYLLABUS_PRESETS.class10_cbse;
  if (cls.includes('class 11') || cls.includes('class 12')) {
    return exam ? SYLLABUS_PRESETS.class12_pcm : SYLLABUS_PRESETS.class10_cbse;
  }
  return null; // college / unsure — add manually or via AI later
}

export async function seedSyllabus(userId, opts) {
  const existing = await db.list('syllabus', { eq: { user_id: userId }, limit: 1 });
  if (existing && existing.length) return 0;
  const preset = pickSyllabusPreset(opts);
  if (!preset) return 0;
  const rows = preset.rows.map((r) => ({
    user_id: userId,
    subject: r.subject,
    chapter: r.chapter,
    topic: null,
    subtopic: null,
    weightage: r.weightage || 3,
    estimated_hours: r.estimated_hours || 6,
    status: 'locked',
    progress_percent: 0,
    deadline: null,
    completed_at: null,
    created_at: nowIso(),
  }));
  await db.insertMany('syllabus', rows);
  return rows.length;
}
