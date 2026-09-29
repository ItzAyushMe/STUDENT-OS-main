// ============================================================
// StudentOS — FIX-BYTE: PROFESSOR BYTE CONTEXT + DISPLAY SANITIZER (pure core)
//
// Everything that DECIDES lives here: which StudentOS context categories are
// relevant to a user message (keyword/intent table), how each category is
// summarized into a short text block, the hard caps (≤3 categories, ≤~600 chars
// each — never the whole DB), and the display-layer markdown sanitizer.
// No supabase, no AsyncStorage, no react-native — plain-Node importable so
// scripts/logic-test.mjs can prove PB-A…PB-E without a device or a network.
//
// The effectful half (db.list fetches) is INJECTED into resolveByteContext() by
// TutorScreen — every category fetch is individually try/caught: a failing
// category contributes '' and Byte proceeds with what loaded (PB11). Privacy:
// queries run through the existing db layer as the authenticated user (RLS +
// F5 identity guard unchanged); social context is friend COUNT only — never
// names or requests; nothing here is persisted into the chat log.
// ============================================================
import { activeSyllabusRows } from '../config/constants.js';

// plain-Node-safe helpers (no dayjs/gymSplit imports — this lib must stay
// importable in bare Node like contentLocker.js; behaviour mirrors
// utils.todayStr and normalizeGymSplitV2 for the fields we display)
const todayStrLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const normalizeSplit = (raw) => {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return { type: raw, restDays: [], mode: 'split' }; } }
  if (!obj || typeof obj !== 'object') return null;
  return {
    type: obj.type || 'ppl',
    restDays: Array.isArray(obj.restDays) ? obj.restDays : [],
    mode: obj.mode || 'split',
  };
};

// ---------- constants / caps ----------
export const CONTEXT_HEADER = 'StudentOS context (use only if relevant):';
export const MAX_CONTEXT_CATEGORIES = 3;   // hard cap per call (PO-confirmed)
export const MAX_BLOCK_CHARS = 600;        // per-category cap — keeps prompts small
export const MAX_CONTEXT_CHARS = 2400;     // overall safety cap at assembly

export const CATEGORY_LABELS = {
  profile: 'Profile',
  academic: 'Academics',
  schedule: 'Plan (today/tomorrow)',
  habits: 'Habits',
  fitness: 'Fitness',
  social: 'Friends',
};

// selection priority when scores tie / an explicit "use everything" ask arrives
export const CATEGORY_PRIORITY = ['academic', 'schedule', 'habits', 'fitness', 'social'];

// keyword/intent table (word-boundary matched, case-insensitive). Deliberately
// small and study-adjacent — a general-knowledge question matches NOTHING and
// Byte answers it with profile-only context (PB-A).
export const CATEGORY_KEYWORDS = {
  academic: [
    'exam', 'exams', 'revision', 'revise', 'syllabus', 'homework', 'study', 'studies',
    'chapter', 'subject', 'school', 'boards', 'deadline', 'deadlines', 'assignment',
    'notes', 'test', 'padhai',
  ],
  schedule: [
    'today', 'tomorrow', 'plan', 'planning', 'schedule', 'routine', 'organize',
    'organise', 'timetable', 'time table', 'week', 'aaj', 'kal',
  ],
  habits: ['habit', 'habits', 'discipline', 'consistency'],
  fitness: [
    'workout', 'workouts', 'gym', 'fit', 'fitness', 'exercise', 'exercises',
    'training', 'split', 'cardio', 'muscle', 'muscles', 'rest day', 'rest days',
  ],
  social: ['friend', 'friends', 'social'],
};

// explicit "give Byte the broad picture" requests (PB4) — still capped at 3 total
export const ALL_KEYWORDS = [
  'everything', 'my progress', 'all my', 'about me', 'studentos', 'full context',
  'all context', 'my data',
];

// ---------- selection (PB-A) ----------
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordHit = (lowerMsg, kw) => new RegExp(`\\b${escapeRe(kw.toLowerCase())}\\b`).test(lowerMsg);

/**
 * Which categories a message deserves: always ['profile', ...matched] truncated
 * to MAX_CONTEXT_CATEGORIES. No match (general-knowledge question) -> profile
 * only. 'schedule' pulls 'habits' along (organizing a day is habit territory —
 * PB-A "organize tomorrow" -> schedule+habits). Explicit "everything" asks map
 * to the broader top-priority set — still never more than the cap.
 */
export function selectCategories(message) {
  const m = String(message == null ? '' : message).toLowerCase();
  const wantsAll = ALL_KEYWORDS.some((k) => m.includes(k));
  const scores = {};
  for (const cat of Object.keys(CATEGORY_KEYWORDS)) {
    let s = 0;
    for (const kw of CATEGORY_KEYWORDS[cat]) if (wordHit(m, kw)) s += 1;
    if (s > 0) scores[cat] = s;
  }
  if (scores.schedule && !scores.habits) scores.habits = 0.5; // day-planning pulls habits
  const matched = Object.keys(scores).sort(
    (a, b) => (scores[b] - scores[a]) || (CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b))
  );
  const picked = (wantsAll ? CATEGORY_PRIORITY.slice(0, MAX_CONTEXT_CATEGORIES - 1) : matched.slice(0, MAX_CONTEXT_CATEGORIES - 1))
    .filter((c) => c !== 'profile');
  return ['profile', ...picked].slice(0, MAX_CONTEXT_CATEGORIES);
}

// ---------- category formatters — TOTAL functions: junk in, '' out (PB-B) ----------
const clip = (s) => String(s == null ? '' : s).trim().slice(0, MAX_BLOCK_CHARS);
const asArray = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r === 'object') : []);
const shiftDate = (dateStr, days) => {
  const t = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return String(dateStr).slice(0, 10);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
};

/** The upgraded 4-liner: name + class/board/exam/olympiad/level + streak. */
export function profileCtx(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const bits = [];
  if (profile.display_name) bits.push(String(profile.display_name));
  if (profile.class_level) bits.push(String(profile.class_level));
  if (profile.board) bits.push(String(profile.board));
  if (profile.competitive_exam && profile.competitive_exam !== 'None') {
    bits.push(`preparing for ${profile.competitive_exam}${profile.exam_date ? ` on ${profile.exam_date}` : ''}`);
  }
  if (profile.olympiad && profile.olympiad !== 'None') {
    bits.push(`olympiad: ${profile.olympiad}${profile.olympiad_date ? ` on ${profile.olympiad_date}` : ''}`);
  }
  if (profile.prep_level) bits.push(`level: ${profile.prep_level}`);
  const streak = Number(profile.current_streak);
  if (Number.isFinite(streak) && streak > 0) bits.push(`${streak}-day streak`);
  return clip(bits.join(' · '));
}

/** Active syllabus per-subject progress + nearest deadlines + exam dates. Archived rows never appear (S5). */
export function academicCtx(arg) {
  const { syllabus, deadlines, profile, today } = (arg && typeof arg === 'object') ? arg : {};
  const rows = activeSyllabusRows(asArray(syllabus));
  const t = String(today || todayStrLocal()).slice(0, 10);
  const parts = [];
  if (rows.length) {
    const bySubject = {};
    for (const r of rows) {
      const s = String(r.subject || '').trim() || 'Other';
      if (!bySubject[s]) bySubject[s] = { total: 0, done: 0 };
      bySubject[s].total += 1;
      if (String(r.status) === 'completed') bySubject[s].done += 1;
    }
    parts.push(Object.entries(bySubject).map(([s, v]) => `${s} ${v.done}/${v.total} done`).join('; '));
    const upcoming = rows
      .filter((r) => r.deadline && String(r.deadline).slice(0, 10) >= t)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
      .slice(0, 3)
      .map((r) => `${r.subject}: ${r.chapter || r.topic || ''} due ${String(r.deadline).slice(0, 10)}`);
    if (upcoming.length) parts.push(`Upcoming: ${upcoming.join(' | ')}`);
  }
  const dls = asArray(deadlines)
    .filter((d) => String(d.status) !== 'completed' && String(d.status) !== 'missed' && d.deadline_date && String(d.deadline_date).slice(0, 10) >= t)
    .sort((a, b) => String(a.deadline_date).localeCompare(String(b.deadline_date)))
    .slice(0, 3)
    .map((d) => `${d.topic || d.exam_type || 'item'} due ${String(d.deadline_date).slice(0, 10)}`);
  if (dls.length) parts.push(`Deadlines: ${dls.join(' | ')}`);
  if (profile && profile.exam_date) parts.push(`Exam date: ${profile.exam_date}`);
  if (profile && profile.olympiad_date) parts.push(`Olympiad date: ${profile.olympiad_date}`);
  return clip(parts.join('\n'));
}

/** Today + tomorrow schedule sessions (times, subject, status). */
export function scheduleCtx(arg) {
  const { sessions, today } = (arg && typeof arg === 'object') ? arg : {};
  const rows = asArray(sessions);
  const t = String(today || todayStrLocal()).slice(0, 10);
  const tm = shiftDate(t, 1);
  const lines = [];
  for (const day of [t, tm]) {
    const dayRows = rows.filter((r) => String(r.date || '').slice(0, 10) === day).slice(0, 6);
    if (!dayRows.length) continue;
    lines.push(day === t ? 'Today:' : 'Tomorrow:');
    for (const r of dayRows) {
      lines.push(`• ${r.start_time || '?'} ${r.subject || ''}${r.topic ? ` — ${r.topic}` : ''} (${r.session_type || 'study'}, ${r.status || 'pending'})`);
    }
  }
  return clip(lines.join('\n'));
}

/** Habit names + today's done/pending. */
export function habitsCtx(arg) {
  const { habits, logsToday } = (arg && typeof arg === 'object') ? arg : {};
  const hs = asArray(habits);
  if (!hs.length) return '';
  const doneIds = new Set(asArray(logsToday).filter((l) => l.completed).map((l) => String(l.habit_id)));
  const lines = hs.slice(0, 8).map((h) => `• ${h.icon || ''} ${h.name || 'habit'} — ${doneIds.has(String(h.id)) ? 'done' : 'pending'}`);
  const done = hs.filter((h) => doneIds.has(String(h.id))).length;
  return clip(`${done}/${hs.length} habits done today\n${lines.join('\n')}`);
}

/** Gym split (type/rest days) + last workout log summary. COUNTS and names of plans only — no exercise tables. */
export function fitnessCtx(arg) {
  const { gymSplit, lastLog } = (arg && typeof arg === 'object') ? arg : {};
  const parts = [];
  const split = normalizeSplit(gymSplit);
  if (split) {
    parts.push(`Gym: ${split.type} (${split.mode})${split.restDays?.length ? `, rest days: ${split.restDays.join(', ')}` : ''}`);
  }
  if (lastLog && typeof lastLog === 'object') {
    const ex = Array.isArray(lastLog.exercises) ? lastLog.exercises.length : 0;
    parts.push(`Last workout: ${String(lastLog.date || '').slice(0, 10)}${lastLog.plan_name ? ` — ${lastLog.plan_name}` : ''}${ex ? ` (${ex} exercises)` : ''}`);
  }
  return clip(parts.join('\n'));
}

/** Friend COUNT only — never names, never pending requests (PO-confirmed). */
export function socialCtx(arg) {
  const { friendCount } = (arg && typeof arg === 'object') ? arg : {};
  const n = Number(friendCount);
  if (!Number.isFinite(n) || n <= 0) return '';
  return clip(`${n} friend${n === 1 ? '' : 's'} on StudentOS`);
}

/** Unique accepted-friend count from both directions of the friends table. */
export function countFriends(rowsAsRequester, rowsAsInvitee, myId) {
  const peers = new Set();
  for (const r of asArray(rowsAsRequester)) if (String(r.status) === 'accepted' && r.friend_id) peers.add(String(r.friend_id));
  for (const r of asArray(rowsAsInvitee)) if (String(r.status) === 'accepted' && r.user_id) peers.add(String(r.user_id));
  peers.delete(String(myId == null ? '' : myId));
  return peers.size;
}

// ---------- assembly (PB-E) ----------
/**
 * blocks = { profile: '...', academic: '...', ... } (already-fetched summaries).
 * Returns the ready-to-inject prompt block, or '' when nothing relevant — the
 * prompt then carries NO context section at all.
 */
export function selectContext(blocks, message) {
  const cats = selectCategories(message);
  const lines = [];
  for (const c of cats) {
    const text = String((blocks && blocks[c]) == null ? '' : blocks[c]).trim();
    if (!text) continue;
    lines.push(`${CATEGORY_LABELS[c] || c}: ${text.slice(0, MAX_BLOCK_CHARS)}`);
  }
  if (!lines.length) return '';
  return `${CONTEXT_HEADER}\n${lines.join('\n')}`.slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Orchestrator with the db.list function INJECTED (pure lib, effectful caller).
 * Every category fetch is individually try/caught — a failing category is a
 * silent skip (''), never a chat failure (PB11). Fetches only the categories
 * selectCategories() actually picked — never the whole DB.
 */
export async function resolveByteContext(arg) {
  const { list, profile, message, today } = (arg && typeof arg === 'object') ? arg : {};
  try {
    const t = String(today || todayStrLocal()).slice(0, 10);
    const uid = profile && profile.id ? String(profile.id) : null;
    const cats = selectCategories(message);
    const need = (c) => cats.includes(c);
    const blocks = { profile: profileCtx(profile) };
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };
    if (uid && typeof list === 'function') {
      if (need('academic')) {
        const [syl, dls] = await Promise.all([
          safe(() => list('syllabus', { eq: { user_id: uid } })),
          safe(() => list('deadlines', { eq: { user_id: uid } })),
        ]);
        blocks.academic = academicCtx({ syllabus: syl, deadlines: dls, profile, today: t });
      }
      if (need('schedule')) {
        const rows = await safe(() => list('schedule', {
          eq: { user_id: uid }, gte: { date: t }, lte: { date: shiftDate(t, 1) }, order: { col: 'date', asc: true },
        }));
        blocks.schedule = scheduleCtx({ sessions: rows, today: t });
      }
      if (need('habits')) {
        const [h, l] = await Promise.all([
          safe(() => list('habits', { eq: { user_id: uid, is_active: true } })),
          safe(() => list('habit_logs', { eq: { user_id: uid, date: t } })),
        ]);
        blocks.habits = habitsCtx({ habits: h, logsToday: l });
      }
      if (need('fitness')) {
        const w = await safe(() => list('workout_logs', { eq: { user_id: uid }, order: { col: 'date', asc: false }, limit: 1 }));
        blocks.fitness = fitnessCtx({ gymSplit: profile && profile.gym_split, lastLog: Array.isArray(w) ? w[0] : null });
      }
      if (need('social')) {
        const [a, b] = await Promise.all([
          safe(() => list('friends', { eq: { user_id: uid, status: 'accepted' } })),
          safe(() => list('friends', { eq: { friend_id: uid, status: 'accepted' } })),
        ]);
        blocks.social = socialCtx({ friendCount: countFriends(a, b, uid) });
      }
    }
    return selectContext(blocks, message);
  } catch {
    return ''; // context is best-effort: Byte always answers, with or without it
  }
}

// ---------- display sanitizer (PB-D) ----------
/**
 * Strips stray markdown from any reply before display: **bold** -> bold,
 * leading -/* bullets -> •, ``` fences and # headings removed. Math/LaTeX-ish
 * plain text (what MathText renders) is untouched — no $, \ or symbol handling.
 * Idempotent; aiService.askAI already strips markdown, this is the display-layer
 * belt for the cases the handoff calls out (models ignoring instructions).
 */
export function sanitizeMarkdownStray(text) {
  if (typeof text !== 'string') return text;
  let t = text;
  t = t.replace(/```[a-z]*\n?/gi, '');                                  // code fences
  t = t.replace(/^#{1,6}\s+/gm, '');                                    // headings
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '$1');                           // **bold** -> bold
  t = t.replace(/(^|\s)\*([^*\n]+?)\*(?=\s|$|[.,!?])/g, '$1$2');        // *italic* -> italic
  t = t.replace(/^[ \t]*[-*][ \t]+/gm, '• ');                           // leading -/* bullets -> •
  return t;
}
