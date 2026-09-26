// ============================================================
// StudentOS — Smart Schedule engine (deterministic, offline-first)
//
// FIX-H — FULL SCHEDULER REDESIGN (single planner; the old day-loop is gone.
// There is no parallel scheduler and nothing legacy running underneath):
//   * plans from the user's REAL data: syllabus rows (status + progress_percent),
//     priorities, school exams, olympiad date, deadlines, available hours,
//     already-completed work and the schedule rows that ALREADY exist
//   * urgency is deadline-driven: risk = remaining minutes / days left, so
//     overdue and near-deadline work goes first; weightage only breaks ties
//   * completed chapters are never re-scheduled; partial progress and minutes
//     from already-completed sessions shrink the remaining workload
//   * existing entries are respected: never re-emitted (dedupe key) and their
//     minutes are subtracted from that day's capacity
//   * deterministic: `today` and `createdAt` are injectable, every sort has a
//     total order (id tie-break), the planner never reads the wall clock
//   * honest capacity: no invented minutes (a 0h day plans nothing), overload is
//     reported with the exact chapters that did not fit
//   * one date system: resolvePlanDate() falls back to todayStr(), i.e. the FIX-F
//     dev-date offset — no second calendar is introduced
//
// FIX-S — on top of the FIX-H planner (same single planner, no parallel path):
//   S1 buildSubjectRotation(): a class day is a PAIR of subjects dealt round-robin
//      over subjects ordered by nearest deadline, keyed by calendar date — so no
//      subject repeats on back-to-back days and a day off does not shift the week
//   S2 exam-aware run-up: inside the 14 days before a school exam, subjects holding
//      chapters due before that exam lead the day's pair and lead the revision wave
//      (the wave's shape — revision + timed practice, no new study — is unchanged)
//   S3 conquered chapter -> ONE chapter test at +2d and spaced revisions at
//      +3/+7/+14d, identity-keyed so regeneration never duplicates the ladder
//   S4 CLASS_SESSION_END cutoff: no new class-track content after 25 Feb of the
//      session; olympiad/competitive tracks and exam-related class days continue;
//      whatever no longer fits is reported, never dropped or scheduled late
//
// PRIORITY (the core rule):
//   1. CLASS/school syllabus — always first (real school exams!)
//   2. OLYMPIAD — second
//   3. COMPETITIVE EXAM — last, fills leftover time only
//
// The planner is also exam-calendar aware:
//   - class syllabus finishes ~2 weeks BEFORE each school exam
//   - revision waves + mock tests + timed practice + buffer days
//   - catch-up (autoRescheduleMissed) when the student falls behind
// ============================================================
import dayjs from 'dayjs';
import { SESSION_TYPES, TRACK_PRIORITY, CLASS_SESSION_END } from '../config/constants';
import { minutesToTime, todayStr, dateStr, nowIso } from './utils';

const PREFERRED_START = {
  early: 5 * 60,
  morning: 8 * 60,
  afternoon: 13 * 60,
  evening: 16 * 60,
  night: 19 * 60,
  late: 22 * 60,
};

const SCHOOL_EXAM_BUFFER_DAYS = 14; // class syllabus done ~2 weeks before school exams

function startMinutesFor(preferredTime = '') {
  const p = preferredTime.toLowerCase();
  if (p.includes('early')) return PREFERRED_START.early;
  if (p.includes('late')) return PREFERRED_START.late;
  if (p.includes('morning')) return PREFERRED_START.morning;
  if (p.includes('afternoon')) return PREFERRED_START.afternoon;
  if (p.includes('evening')) return PREFERRED_START.evening;
  return PREFERRED_START.night;
}

function difficultyFactor(prepLevel = '') {
  const p = prepLevel.toLowerCase();
  if (p.includes('final')) return 0.8;
  if (p.includes('advanced')) return 0.9;
  if (p.includes('just')) return 1.25;
  if (p.includes('basic')) return 1.15;
  return 1;
}

const rowTrack = (r) => (r.track === 'olympiad' || r.track === 'exam' ? r.track : 'class');

// Normalize a school exam entry. Supports BOTH:
//   exact:  { label, date }                        (old shape = exact)
//   range:  { label, start_date, end_date }        (new shape)
//   mixed:  { label, start_date, end_date, exact, date }
// -> { label, start, end, exact }
function normalizeSchoolExam(e) {
  if (!e) return null;
  const label = e.label || e.name || 'School exam';
  // idempotent: accepts raw entries {date|start_date|end_date|exact}
  // AND already-normalized entries {start, end, exact}
  const d = typeof e.date === 'string' ? e.date : e.date ? dateStr(dayjs(e.date)) : null;
  const startRaw =
    (typeof e.start_date === 'string' ? e.start_date : null) ||
    (typeof e.start === 'string' ? e.start : null) ||
    (e.start_date ? dateStr(dayjs(e.start_date)) : null);
  const endRaw =
    (typeof e.end_date === 'string' ? e.end_date : null) ||
    (typeof e.end === 'string' ? e.end : null) ||
    (e.end_date ? dateStr(dayjs(e.end_date)) : null);
  if (e.exact && d) return { label, start: d, end: d, exact: true };
  if (startRaw || endRaw || d) {
    const start = startRaw || d || endRaw;
    const end = endRaw || start;
    return { label, start, end: end < start ? start : end, exact: false };
  }
  return null;
}

// Nearest upcoming school exam (by range START) on/after a date
function nextSchoolExamOnOrAfter(schoolExams = [], date) {
  const valid = allSchoolExams(schoolExams).filter((e) => !dayjs(e.start).isBefore(dayjs(date), 'day'));
  if (!valid.length) return null;
  return valid[0];
}

function allSchoolExams(schoolExams = []) {
  return (schoolExams || [])
    .map(normalizeSchoolExam)
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Student-configurable priorities (FIX B).
// Shape on users.priorities:
//   { order: ['class','exam','olympiad', 'custom:xyz'], enabled: {class:true,...},
//     timeSplit: { class: 60, exam: 30, olympiad: 10, 'custom:xyz': 0 },
//     custom: { 'custom:xyz': { name: 'Physics Boost', subjects: ['Physics'] } } }
const CORE_TRACKS = ['class', 'exam', 'olympiad'];
const DEFAULT_PRIORITIES = {
  order: ['class', 'exam', 'olympiad'],
  enabled: { class: true, exam: true, olympiad: true },
  timeSplit: { class: 60, exam: 30, olympiad: 10 },
};

export function normalizePriorities(p) {
  const customs = p?.custom && typeof p.custom === 'object' ? p.custom : {};
  const customIds = Object.keys(customs).filter((id) => id && id.startsWith('custom:'));

  // base order: the three core tracks (always present, in the user's order)…
  let order;
  if (Array.isArray(p?.order) && CORE_TRACKS.every((t) => p.order.includes(t))) {
    order = [...p.order];
  } else {
    order = [...DEFAULT_PRIORITIES.order];
  }
  // …plus any custom tracks the user added
  for (const id of customIds) if (!order.includes(id)) order.push(id);

  const next = {
    order,
    enabled: { ...DEFAULT_PRIORITIES.enabled, ...(p?.enabled || {}) },
    timeSplit: { ...DEFAULT_PRIORITIES.timeSplit, ...(p?.timeSplit || {}) },
    custom: customs,
  };
  // only keep enabled tracks in the scheduling order
  next.order = next.order.filter((t) => next.enabled[t] !== false);
  // normalize time split of ENABLED tracks to 100
  const active = next.order;
  const sum = active.reduce((a, t) => a + (Number(next.timeSplit[t]) || 0), 0);
  if (sum > 0) {
    let running = 0;
    active.forEach((t, i) => {
      if (i === active.length - 1) {
        next.timeSplit[t] = Math.max(0, Math.round(100 - running));
      } else {
        next.timeSplit[t] = Math.round(((Number(next.timeSplit[t]) || 0) / sum) * 100);
        running += next.timeSplit[t];
      }
    });
  } else {
    const even = Math.floor(100 / Math.max(1, active.length));
    active.forEach((t, i) => {
      next.timeSplit[t] = i === active.length - 1 ? 100 - even * (active.length - 1) : even;
    });
  }
  return next;
}

// Track a syllabus row belongs to. Custom tracks can claim subjects:
// a row whose subject is listed in a custom track goes there first.
export function trackOfRow(row, prio) {
  const customs = prio?.custom || {};
  for (const [id, meta] of Object.entries(customs)) {
    if (Array.isArray(meta?.subjects) && meta.subjects.includes(row?.subject)) return id;
  }
  return rowTrack(row);
}

// ---------- deadlines: track-aware, school-exam aware ----------
// class rows -> 14 days before nearest school exam RANGE START (else exam date)
// olympiad rows -> olympiad date (else exam date)
// exam rows -> exam date
export function autoSetDeadlines(syllabusRows, examDate, dailyHours = 3, schoolExams = []) {
  if (!syllabusRows?.length) return {};
  const today = todayStr();
  const exams = allSchoolExams(schoolExams);
  const nextSchool = nextSchoolExamOnOrAfter(exams, today);

  // distribute within the target window per track
  const byTrack = { class: [], olympiad: [], exam: [] };
  for (const row of syllabusRows) {
    if (row.status === 'completed') continue;
    byTrack[rowTrack(row)].push(row);
  }
  const deadlines = {};
  for (const [track, rows] of Object.entries(byTrack)) {
    if (!rows.length) continue;
    const target = track === 'class' && nextSchool
      ? dateStr(dayjs(nextSchool.start).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day'))
      : examDate;
    if (!target) continue;
    const totalDays = Math.max(1, dayjs(target).diff(dayjs(today), 'day'));
    const capacityHours = totalDays * Math.max(0.5, dailyHours) * 0.85;
    const totalHours = rows.reduce((a, r) => a + (r.estimated_hours || 4), 0) || 1;
    const sorted = [...rows].sort((a, b) => {
      const wa = (b.weightage || 3) - (a.weightage || 3);
      if (wa !== 0) return wa;
      return (a.estimated_hours || 4) - (b.estimated_hours || 4);
    });
    let consumed = 0;
    for (const row of sorted) {
      consumed += (row.estimated_hours || 4) / totalHours;
      const dayOffset = Math.min(
        totalDays - 1,
        Math.max(0, Math.round((consumed * capacityHours) / Math.max(0.5, dailyHours)))
      );
      deadlines[row.id] = dateStr(dayjs(today).add(dayOffset, 'day'));
    }
  }
  return deadlines;
}


// ---------- FIX-H: planner constants ----------
const MIN_BLOCK_MIN = 15;        // never emit a block shorter than this
const MAX_BLOCK_MIN = 50;        // one focused block
const BREATH_MIN = 5;            // short breather between blocks
const DAY_OFF_CAP_MIN = 60;      // a declared day off stays light
const EXAM_DAY_REVISION_MIN = 45;
const MOCK_MIN = 120;
const MOCK_ANALYSIS_MIN = 60;
const URGENT_LEAD_DAYS = 14;     // a deadline this close starts demanding capacity
const LEFTOVER_CAP_MIN = 90;     // unspent split budget may bank up to this
const REVISION_CYCLE_DAYS = 3;
const REV_WAVE_PICKS = 6;
const HORIZON_CAP_DAYS = 365;
const MAX_BLOCKS_PER_DAY = 40;   // hard stop — an allocation loop can never spin

// ---------- FIX-S: planner constants ----------
// S1 — a class day is a PAIR of subjects, never one subject for the whole day
const PAIR_SECONDARY_SHARE = 0.35; // the second subject's share of a calm class day
const PAIR_URGENT_SECONDARY_MIN = 2 * 15; // …shrinks to this floor when the lead subject is due
// S3 — a conquered chapter is tested once, then revisited on a spaced ladder
const CHAPTER_TEST_OFFSET_DAYS = 2;
const SPACED_REVISION_OFFSETS = [3, 7, 14];
const CHAPTER_TEST_MIN = 60;     // one full-chapter test (uses the existing 'mock' session type)
const SPACED_REVISION_MIN = 25;  // 20–30 min per spaced revision

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v, lo)));
const isDateStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const round1 = (v) => Math.round(num(v, 0) * 10) / 10;

/**
 * ONE date system. An explicit plan date wins (tests, previews); otherwise
 * todayStr() — which already applies the FIX-F dev-date offset. The planner
 * never reads the wall clock itself, so the same input gives the same plan.
 */
export function resolvePlanDate(explicit) {
  return isDateStr(explicit) ? explicit : todayStr();
}

/** Identity of a planned slot — an entry with this key is never re-emitted. */
export function dedupeKey(row) {
  if (!row) return '';
  return [
    String(row.date || ''),
    String(row.start_time || ''),
    String(row.subject || ''),
    String(row.topic || ''),
    String(row.session_type || 'study'),
  ].join('|');
}

/** Honest capacity: no invented floor. 0 hrs/day means 0 min/day. */
export function planCapacityMinutes(dailyHours) {
  const h = num(dailyHours, 0);
  return h > 0 ? Math.max(0, Math.round(h * 60)) : 0;
}

/** Days left before an item is due (>= 1). No deadline => the plan horizon. */
export function daysUntilDeadline(item, today, fallbackDays) {
  if (!item || !isDateStr(item.deadline)) return Math.max(1, num(fallbackDays, HORIZON_CAP_DAYS));
  return Math.max(1, dayjs(item.deadline).diff(dayjs(today), 'day'));
}

/**
 * Total order for "what is most urgent" — used for every queue and for choosing
 * which track gets unclaimed minutes. Order:
 *   1. overdue work first (its deadline already passed)
 *   2. nearest deadline first (no deadline => the end of the plan horizon)
 *   3. the student's own track order (priorities)
 *   4. higher weightage first
 *   5. smaller remaining workload first — this also keeps draining the chapter
 *      already started instead of sprinkling minutes over everything, so when
 *      the workload cannot fit, whole chapters are preserved and the rest is
 *      reported as unscheduled rather than silently half-planned
 *   6. id — a stable, deterministic final tie-break
 */
export function compareUrgency(a, b, ctx) {
  const c = ctx || {};
  const da = daysUntilDeadline(a, c.today, c.horizonDays);
  const db = daysUntilDeadline(b, c.today, c.horizonDays);
  if (!!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
  if (da !== db) return da - db;
  const ta = c.trackIndex && c.trackIndex[a.track] != null ? c.trackIndex[a.track] : 99;
  const tb = c.trackIndex && c.trackIndex[b.track] != null ? c.trackIndex[b.track] : 99;
  if (ta !== tb) return ta - tb;
  if (num(b.weightage, 0) !== num(a.weightage, 0)) return num(b.weightage, 0) - num(a.weightage, 0);
  if (num(a.remainingMinutes, 0) !== num(b.remainingMinutes, 0)) return num(a.remainingMinutes, 0) - num(b.remainingMinutes, 0);
  return String(a.id).localeCompare(String(b.id));
}

// ---------- FIX-S S1: weekly subject-pair interleave ----------
/**
 * Builds the class-track subject rotation for a plan window. PURE: same input,
 * same output — no clock, no randomness, no mutation of the caller's rows.
 *
 * A school week is not "one subject per day until it is finished": every day is
 * a PAIR of subjects, and the pairs are dealt round-robin over the subjects
 * ordered by nearest deadline (then heaviest backlog, then name — a total order).
 * Because day i takes slots (2i, 2i+1) of that order, consecutive days carry
 * DISJOINT pairs whenever the subject count is even, so no subject repeats on two
 * back-to-back days. Pairs are keyed by CALENDAR date, so a declared day off
 * simply leaves its slot unused — the rest of the week does not shift.
 *
 * Deadline urgency changes the ORDER (and, in the day loop, the split of the
 * day's minutes), never the existence of the second subject: the only day with a
 * single subject is a day where the student genuinely has one subject left.
 *
 * @param {Array} pendingRows rows (or work items) still needing time:
 *        { subject, deadline?, remainingMinutes? | estimated_hours? }
 * @param {string} startDate 'YYYY-MM-DD' — the plan's day 0
 * @param {number} numDays   how many calendar days to lay pairs over
 * @returns {{ order: string[], byDate: Object<string, string[]>, subjects: Array }}
 */
export function buildSubjectRotation(pendingRows, startDate, numDays) {
  const rows = Array.isArray(pendingRows) ? pendingRows.filter(Boolean) : [];
  const start = isDateStr(startDate) ? startDate : todayStr();
  const days = Math.max(0, Math.floor(num(numDays, 0)));

  const groups = new Map();
  for (const r of rows) {
    const subject = String(r.subject || 'Subject');
    const explicit = num(r.remainingMinutes, null);
    const minutes = explicit != null
      ? Math.max(0, Math.floor(explicit))
      : Math.max(0, Math.round(num(r.estimated_hours, 0) * 60));
    if (minutes <= 0) continue; // nothing left to study -> not part of the rotation
    const raw = r.deadline;
    const deadline = isDateStr(String(raw || '')) ? String(raw) : (raw ? dateStr(dayjs(raw)) : null);
    const g = groups.get(subject) || { subject, minutes: 0, deadline: null, chapters: 0 };
    g.minutes += minutes;
    g.chapters += 1;
    if (deadline && (!g.deadline || deadline < g.deadline)) g.deadline = deadline;
    groups.set(subject, g);
  }

  // nearest deadline first; no deadline -> the back of the queue
  const order = [...groups.values()]
    .sort((a, b) => {
      const da = a.deadline || '9999-12-31';
      const db = b.deadline || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      if (b.minutes !== a.minutes) return b.minutes - a.minutes;
      return a.subject.localeCompare(b.subject);
    })
    .map((g) => g.subject);

  const byDate = {};
  const n = order.length;
  for (let i = 0; i < days; i++) {
    const date = dateStr(dayjs(start).add(i, 'day'));
    if (n === 0) { byDate[date] = []; continue; }
    if (n === 1) { byDate[date] = [order[0]]; continue; }
    const first = order[(2 * i) % n];
    const second = order[(2 * i + 1) % n];
    // an odd subject count can wrap onto itself — never invent a fake second subject
    byDate[date] = first === second ? [first] : [first, second];
  }

  return {
    order,
    byDate,
    subjects: [...groups.values()].sort((a, b) => order.indexOf(a.subject) - order.indexOf(b.subject)),
  };
}

// ---------- FIX-S S4: the class session's hard cutoff ----------
/**
 * The date after which NO new class-track content may be scheduled for the
 * academic session that contains `today` (April → March, cutoff = CLASS_SESSION_END
 * of the ending year). Pure + injectable date: it reads nothing but its argument,
 * so the FIX-F dev-date offset exercises exactly the same path as production.
 *
 *   classSessionCutoff('2026-09-26') -> '2027-02-25'   (session 2026-27)
 *   classSessionCutoff('2027-02-26') -> '2027-02-25'   (cutoff already passed)
 *   classSessionCutoff('2027-04-01') -> '2028-02-25'   (new session started)
 *   classSessionCutoff('2028-02-29') -> '2028-02-25'   (leap-safe: MM-DD compare)
 */
export function classSessionCutoff(today) {
  const base = isDateStr(today) ? dayjs(today) : dayjs(todayStr());
  const [mm, dd] = String(CLASS_SESSION_END || '02-25').split('-');
  const month = clampNum(mm, 1, 12);
  const day = clampNum(dd, 1, 31);
  // April..December belong to the session that ENDS next year; January..March to
  // the session that ends THIS year.
  const sessionStartYear = base.isValid() ? (base.month() + 1 >= 4 ? base.year() : base.year() - 1) : Number(String(todayStr()).slice(0, 4));
  const endYear = sessionStartYear + 1;
  const iso = `${endYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const cutoff = dayjs(iso);
  return cutoff.isValid() ? dateStr(cutoff) : iso;
}

/**
 * Turns REAL syllabus rows into work items with an honest remaining workload.
 * Excluded (never scheduled again): rows already completed, rows at 100%,
 * rows whose track is disabled or split to 0%, and rows fully covered by
 * sessions the student already completed.
 */
export function buildWorkItems(input) {
  const {
    syllabus = [], existing = [], deadlines = null, prio, factor = 1,
    today, examDate = null, olympiadDate = null, schoolExams = [], allocatable = [],
  } = input || {};

  const exams = Array.isArray(schoolExams) ? schoolExams : allSchoolExams(schoolExams);
  const nextSchool = nextSchoolExamOnOrAfter(exams, today);
  const classTarget = nextSchool
    ? dateStr(dayjs(nextSchool.start).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day'))
    : (examDate ? dateStr(dayjs(examDate)) : null);
  const olyTarget = olympiadDate ? dateStr(dayjs(olympiadDate).subtract(1, 'day')) : null;
  const examTarget = examDate ? dateStr(dayjs(examDate).subtract(1, 'day')) : null;

  // minutes already spent on a chapter, taken from EXISTING completed sessions
  const credit = new Map();
  for (const r of Array.isArray(existing) ? existing : []) {
    if (!r || String(r.status || '') !== 'completed') continue;
    const type = String(r.session_type || 'study');
    if (type !== 'study' && type !== 'practice') continue; // revision/quiz don't cover new syllabus
    const k = `${String(r.subject || '').toLowerCase()}|${String(r.topic || '').toLowerCase()}`;
    credit.set(k, num(credit.get(k), 0) + num(r.duration_minutes, 0));
  }

  const active = new Set(allocatable);
  const items = [];
  const completedItems = [];
  const excludedItems = [];
  let completedExcluded = 0;

  for (const row of Array.isArray(syllabus) ? syllabus : []) {
    if (!row || typeof row !== 'object') continue;
    const chapter = String(row.chapter || row.topic || '').trim();
    if (!chapter) { excludedItems.push({ id: row.id, reason: 'no-chapter' }); continue; }
    const progress = clampNum(row.progress_percent, 0, 100);
    const track = trackOfRow(row, prio);
    if (String(row.status || '').toLowerCase() === 'completed' || progress >= 100) {
      completedExcluded += 1;
      // FIX-S S3 needs to know WHAT was conquered and WHEN, to build the
      // test + spaced-revision ladder. completed_at is optional in the data:
      // a row without it is treated as conquered "today" by the caller.
      completedItems.push({
        id: row.id,
        chapter,
        subject: String(row.subject || 'Subject'),
        track,
        completedAt: row.completed_at && dayjs(row.completed_at).isValid() ? dateStr(dayjs(row.completed_at)) : null,
        reason: 'completed',
      });
      continue;
    }
    if (!active.has(track)) {
      excludedItems.push({ id: row.id, chapter, reason: 'track-not-planned', track });
      continue;
    }
    const baseMin = Math.max(0, Math.round(num(row.estimated_hours, 4) * 60 * num(factor, 1) * (1 - progress / 100)));
    const key = `${String(row.subject || '').toLowerCase()}|${chapter.toLowerCase()}`;
    const credited = Math.min(baseMin, num(credit.get(key), 0));
    const remaining = baseMin - credited;
    if (remaining <= 0) {
      completedExcluded += 1;
      completedItems.push({ id: row.id, chapter, reason: credited > 0 ? 'sessions-completed' : 'no-workload' });
      continue;
    }
    if (remaining < MIN_BLOCK_MIN) {
      // less than one viable block left: the chapter is effectively done.
      // Keeping it would stall the queue head and waste whole days.
      completedExcluded += 1;
      completedItems.push({ id: row.id, chapter, reason: 'below-minimum-block' });
      continue;
    }
    const rawDeadline = row.deadline || (deadlines && deadlines[row.id]) ||
      (track === 'class' ? classTarget : track === 'olympiad' ? olyTarget : track === 'exam' ? examTarget : null);
    const deadline = rawDeadline ? (isDateStr(String(rawDeadline)) ? String(rawDeadline) : dateStr(dayjs(rawDeadline))) : null;
    items.push({
      id: row.id || `${track}:${key}`,
      subject: String(row.subject || 'Subject'),
      chapter,
      track,
      weightage: clampNum(row.weightage, 1, 5),
      remainingMinutes: remaining,
      plannedMinutes: 0,
      deadline,
      overdue: !!(deadline && deadline < today),
      creditedMinutes: credited,
      // one-shot events: prepping for an olympiad/main exam ON or AFTER its date
      // is an impossible allocation, so such work stops at the date and is reported
      hardStop:
        track === 'olympiad' && olympiadDate ? dateStr(dayjs(olympiadDate))
        : track === 'exam' && examDate ? dateStr(dayjs(examDate))
        : null,
    });
  }
  return { items, completedExcluded, completedItems, excludedItems };
}

// ---------- the main planner ----------
// planSchedule(input) -> { rows, coverage }
// input: {
//   syllabus,            REAL syllabus rows (status, progress_percent, deadline, weightage, estimated_hours)
//   existing,            schedule rows that already exist (any status) — never duplicated, they consume capacity
//   deadlines,           optional { syllabusId: 'YYYY-MM-DD' } map used when a row has no deadline of its own
//   examDate, olympiadDate, schoolExams,
//   priorities,          student's own { order, enabled, timeSplit } (FIX B)
//   dailyHours, preferredTime, daysOff[], prepLevel, weeks, userId,
//   today, createdAt     injectable -> deterministic
// }
export function planSchedule(input) {
  const opts = input || {};
  const syllabus = Array.isArray(opts.syllabus) ? opts.syllabus : [];
  const existingRows = (Array.isArray(opts.existing) ? opts.existing : []).filter(Boolean);

  const today = resolvePlanDate(opts.today);
  const stamp = opts.createdAt || nowIso();
  const userId = opts.userId;

  const factor = difficultyFactor(opts.prepLevel);
  const startM = startMinutesFor(opts.preferredTime);
  const prio = normalizePriorities(opts.priorities);
  const trackIndex = {};
  prio.order.forEach((t, i) => { trackIndex[t] = i; });

  const dailyHours = Math.max(0, num(opts.dailyHours, 3));
  const capacityMin = planCapacityMinutes(dailyHours);
  const noCapacity = capacityMin < MIN_BLOCK_MIN;

  const examDate = opts.examDate || null;
  const olympiadDate = opts.olympiadDate || null;
  const exams = allSchoolExams(opts.schoolExams);

  // horizon: the rolling window, EXTENDED to cover a distant main exam,
  // olympiad date or the furthest school exam (v1.0.6 recovery rule), capped at 365d.
  const examLimit = examDate ? dayjs(examDate) : null;
  const olympiadLimit = olympiadDate ? dayjs(olympiadDate) : null;
  let horizon = dayjs(today).add(Math.max(1, num(opts.weeks, 6)) * 7, 'day');
  if (examLimit && examLimit.isAfter(horizon)) horizon = examLimit;
  if (olympiadLimit && olympiadLimit.isAfter(horizon)) horizon = olympiadLimit;
  if (exams.length) {
    const furthestSchool = dayjs(exams[exams.length - 1].end || exams[exams.length - 1].start);
    if (furthestSchool.isAfter(horizon)) horizon = furthestSchool;
  }
  const maxHorizon = dayjs(today).add(HORIZON_CAP_DAYS, 'day');
  if (horizon.isAfter(maxHorizon)) horizon = maxHorizon;
  const totalDays = clampNum(horizon.diff(dayjs(today), 'day'), 1, HORIZON_CAP_DAYS);

  // every day inside a school exam RANGE is an exam day; the 14 days before it
  // through its end are protected — no NEW class study goes in there
  const schoolExamDates = new Set();
  const protectedDates = new Set();
  for (const e of exams) {
    const days = clampNum(dayjs(e.end).diff(dayjs(e.start), 'day'), 0, 30);
    for (let i = 0; i <= days; i++) schoolExamDates.add(dateStr(dayjs(e.start).add(i, 'day')));
    for (let i = 0; i <= SCHOOL_EXAM_BUFFER_DAYS + days; i++) {
      protectedDates.add(dateStr(dayjs(e.start).subtract(SCHOOL_EXAM_BUFFER_DAYS - i, 'day')));
    }
  }

  // a 0% split (or a disabled track) means "never schedule this track"
  const allocatable = prio.order.filter((t) => num(prio.timeSplit[t], 0) > 0);

  const built = buildWorkItems({
    syllabus, existing: existingRows, deadlines: opts.deadlines || null, prio, factor,
    today, examDate, olympiadDate, schoolExams: exams, allocatable,
  });
  const items = built.items;
  const ctx = { today, horizonDays: totalDays, trackIndex };

  // a track with NO work in the plan claims no share of the day — its time is free
  const tracksWithWork = new Set(items.map((it) => it.track));

  const queues = {};
  for (const t of allocatable) queues[t] = [];
  for (const it of items) (queues[it.track] || (queues[it.track] = [])).push(it);
  const sortQueue = (t) => { if (queues[t]) queues[t].sort((a, b) => compareUrgency(a, b, ctx)); };
  for (const t of Object.keys(queues)) sortQueue(t);

  // ---------- FIX-S S4: the class session's hard cutoff ----------
  // Class-track NEW content stops here; olympiad / competitive tracks run to their
  // own event dates. Pure + date-injected, so the dev-date offset tests it too.
  const cutoff = classSessionCutoff(today);

  // ---------- FIX-S S1: the class week is a rotation of subject PAIRS ----------
  // Built once per plan from the class chapters that still need time, keyed by
  // calendar date, so regenerating mid-week does not reshuffle the week.
  const rotation = buildSubjectRotation(items.filter((it) => it.track === 'class'), today, totalDays);

  // ---------- FIX-S S2: exam-aware run-up ----------
  // Per school exam: the subjects that still hold chapters DUE BEFORE that exam
  // starts. Inside the 14-day run-up those subjects lead the day's pair and lead
  // the revision wave. Overlapping ranges -> the nearest exam start wins.
  const runUps = exams
    .map((e) => {
      const due = items
        .filter((it) => it.track === 'class' && isDateStr(it.deadline) && it.deadline < e.start)
        .sort((a, b) => compareUrgency(a, b, ctx));
      const subjects = [];
      for (const it of due) if (!subjects.includes(it.subject)) subjects.push(it.subject);
      return {
        exam: e.label || 'School exam',
        start: e.start,
        end: e.end,
        windowStart: dateStr(dayjs(e.start).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day')),
        dueSubjects: subjects,
        dueChapters: due.map((it) => ({ subject: it.subject, chapter: it.chapter, deadline: it.deadline })),
      };
    })
    .filter((r) => r.dueSubjects.length > 0);
  const runUpFor = (date) => {
    let hit = null;
    for (const r of runUps) {
      const diff = dayjs(r.start).diff(dayjs(date), 'day');
      if (diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS && (!hit || r.start < hit.start)) hit = r;
    }
    return hit;
  };
  // today's class pair: rotation order, with the run-up leading it. S2 changes
  // WHICH subject leads and how the minutes split — it never removes the second.
  const classPairFor = (date) => {
    const pair = (rotation.byDate && rotation.byDate[date]) || [];
    if (!pair.length) return pair;
    const run = runUpFor(date);
    if (!run) return pair;
    const inPair = pair.filter((s) => run.dueSubjects.includes(s));
    if (inPair.length) return [inPair[0], ...pair.filter((s) => s !== inPair[0])].slice(0, 2);
    return [run.dueSubjects[0], ...pair].slice(0, 2);
  };

  // ---------- FIX-S S3: conquered chapter -> ONE chapter test + spaced revisions ----------
  const pipeline = [];
  let pipelineSkippedTrack = 0;
  for (const c of built.completedItems) {
    if (!c || c.reason !== 'completed') continue; // only genuinely conquered chapters
    const track = c.track || 'class';
    if (!allocatable.includes(track)) { pipelineSkippedTrack += 1; continue; } // track not planned at all
    const base = isDateStr(c.completedAt) ? c.completedAt : today; // no completed_at -> conquered today
    const ageDays = dayjs(today).diff(dayjs(base), 'day');
    if (ageDays > SPACED_REVISION_OFFSETS[SPACED_REVISION_OFFSETS.length - 1]) {
      // conquered longer ago than the whole ladder: one honest catch-up revision,
      // not four sessions pretending the chapter was finished yesterday
      pipeline.push({
        date: today, kind: 'rev', offsetDays: null, subject: c.subject, chapter: c.chapter,
        track, type: 'revision', minutes: SPACED_REVISION_MIN,
        topic: `Spaced revision (catch-up): ${c.chapter}`,
      });
      continue;
    }
    const ladder = [
      { kind: 'test', off: CHAPTER_TEST_OFFSET_DAYS, type: 'mock', minutes: CHAPTER_TEST_MIN, label: 'Chapter test' },
      ...SPACED_REVISION_OFFSETS.map((off) => ({
        kind: 'rev', off, type: 'revision', minutes: SPACED_REVISION_MIN, label: `Spaced revision (+${off}d)`,
      })),
    ];
    for (const step of ladder) {
      const target = dateStr(dayjs(base).add(step.off, 'day'));
      pipeline.push({
        // a step that already fell in the past clamps to today — never scheduled backwards
        date: target < today ? today : target,
        kind: step.kind,
        offsetDays: step.off,
        subject: c.subject,
        chapter: c.chapter,
        track,
        type: step.type,
        minutes: step.minutes,
        topic: `${step.label}: ${c.chapter}`,
      });
    }
  }
  pipeline.sort((a, b) => (a.date !== b.date
    ? (a.date < b.date ? -1 : 1)
    : (num(a.offsetDays, 0) - num(b.offsetDays, 0))
      || String(a.subject).localeCompare(String(b.subject))
      || String(a.chapter).localeCompare(String(b.chapter))));
  const pipelineTotal = pipeline.length;
  // Identity of a pipeline session as recoverable from a STORED schedule row:
  // subject + topic (the topic carries both the chapter and the ladder step) + type.
  // schedule rows have no syllabus FK, so this is row.id + kind + offsetDate in the
  // only form the database can answer with. Regeneration seeds it from `existing`,
  // so a session is created exactly once even if it rolled to a later day.
  const pipelineKeys = new Set();
  const pipelineEmitted = { test: 0, rev: 0 };
  let pipelineSuppressed = 0;
  let pipelineCutoffStopped = 0;
  let pipelineEventStopped = 0;
  let classCutoffDays = 0;

  // existing entries: their minutes occupy the day, their slots are never re-emitted
  const existingKeys = new Set();
  const loadByDate = {};
  for (const r of existingRows) {
    const k = dedupeKey(r);
    if (k) existingKeys.add(k);
    // FIX-S S3: a chapter test / spaced revision already on the calendar is never
    // re-created — the ladder runs once per conquered chapter, not once per regeneration
    const rTopic = String(r.topic || '');
    if (/^(Chapter test|Spaced revision)/.test(rTopic)) {
      pipelineKeys.add([String(r.subject || ''), rTopic, String(r.session_type || '')].join('|'));
    }
    if (String(r.status || 'pending') !== 'pending') continue;
    if (!isDateStr(String(r.date || '')) || String(r.date) < today) continue;
    loadByDate[r.date] = num(loadByDate[r.date], 0) + num(r.duration_minutes, 0);
  }

  const offDays = new Set((Array.isArray(opts.daysOff) ? opts.daysOff : []).map((v) => Number(v)));
  const dayCapacity = (date, isDayOff) => {
    if (noCapacity) return 0;
    const base = isDayOff ? Math.min(DAY_OFF_CAP_MIN, capacityMin) : capacityMin;
    return Math.max(0, base - num(loadByDate[date], 0));
  };

  // FIX-S S2 edge: a revision-wave day that falls on a declared day off moves to the
  // PREVIOUS day — a day off stays a day off, and the run-up loses no revision.
  const movedWaveDates = new Map(); // day before -> the day-off date it carries
  if (offDays.size && runUps.length) {
    for (let d = 1; d < totalDays; d++) {
      const offDate = dateStr(dayjs(today).add(d, 'day'));
      const weekday = (dayjs(offDate).day() + 6) % 7;
      if (!offDays.has(weekday)) continue;
      if (!runUps.some((r) => {
        const diff = dayjs(r.start).diff(dayjs(offDate), 'day');
        return diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS;
      })) continue;
      const before = dateStr(dayjs(today).add(d - 1, 'day'));
      if (!movedWaveDates.has(before)) movedWaveDates.set(before, offDate);
    }
  }

  const reasons = [];
  if (!syllabus.length) reasons.push('no-syllabus');
  if (!examDate && !olympiadDate && !exams.length) reasons.push('no-exam-dates');
  if (!opts.priorities) reasons.push('no-priorities');
  if (noCapacity) reasons.push('no-available-time');
  if (syllabus.length && !items.length) reasons.push('no-pending-work');

  const rows = [];
  const studied = [];              // {subject, chapter, date, track} for revision cycles
  const leftover = {};
  for (const t of allocatable) leftover[t] = 0;

  let duplicatesSuppressed = 0;
  let protectedBlocksSkipped = 0;
  const tooLate = [];

  // drop work whose event date has arrived/passed — it can never be prepared again
  const pruneExpired = (date) => {
    for (const t of Object.keys(queues)) {
      const q = queues[t];
      if (!q || !q.length) continue;
      for (let i = q.length - 1; i >= 0; i--) {
        const it = q[i];
        if (it.hardStop && date >= it.hardStop && it.remainingMinutes > 0) {
          tooLate.push({
            id: it.id, subject: it.subject, chapter: it.chapter, track: it.track,
            weightage: it.weightage, deadline: it.deadline, datePassed: it.hardStop,
            remainingHours: round1(it.remainingMinutes / 60),
            plannedHours: round1(it.plannedMinutes / 60),
            reason: 'date-passed',
          });
          q.splice(i, 1);
        }
      }
    }
  };
  let finishedTopics = 0;
  let studyCapacityMin = 0;
  let studyDays = 0;

  for (let d = 0; d < totalDays; d++) {
    const date = dateStr(dayjs(today).add(d, 'day'));
    const weekday = (dayjs(date).day() + 6) % 7; // 0=Mon
    const isDayOff = offDays.has(weekday);
    const daysToExam = examDate ? dayjs(examDate).diff(dayjs(date), 'day') : null;
    const schoolExamToday = schoolExamDates.has(date);
    const dayBeforeSchoolExam = exams.some((e) => dateStr(dayjs(e.start).subtract(1, 'day')) === date);
    // revision wave: the 14 days before each school exam RANGE START
    const inSchoolExamRev = exams.some((e) => {
      const diff = dayjs(e.start).diff(dayjs(date), 'day');
      return diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS;
    });
    // FIX-S S4: a mock driven by the olympiad date is prep FOR that olympiad — it
    // stops at the date, exactly like the study work does (H14 rule). A "full-length
    // mock" a week after the event is over would be fake preparation.
    const olympiadAhead = !!olympiadDate && date < dateStr(dayjs(olympiadDate));
    const isMockDay =
      !schoolExamToday &&
      ((weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 70 : olympiadAhead)) ||
        dayBeforeSchoolExam ||
        (olympiadDate && dateStr(dayjs(olympiadDate).subtract(2, 'day')) === date));
    const classProtected = protectedDates.has(date);
    // FIX-S S4: after the session cutoff the class track takes no NEW content.
    // Exam-related class days are carved out — a school exam that straddles the
    // cutoff still gets its run-up, its light exam-day revision and its pre-exam
    // mock; olympiad / competitive tracks are never bound by the class cutoff.
    const mainExamBufferDay = examDate != null && daysToExam != null
      && daysToExam <= Math.max(3, Math.round(totalDays * 0.12)) && daysToExam > 0;
    const examRelatedDay = schoolExamToday || dayBeforeSchoolExam || inSchoolExamRev || isMockDay || mainExamBufferDay;
    const classBlocked = date > cutoff && !examRelatedDay;
    if (classBlocked) classCutoffDays += 1;
    // same honesty rule as pruneExpired, applied to consolidation sessions: once a
    // one-shot event's date has arrived, revising for it is meaningless — no
    // revision / quiz / conquered-chapter ladder rows for that track from then on.
    const eventDate = (track) => (track === 'olympiad' ? olympiadDate : track === 'exam' ? examDate : null);
    const eventPassed = (track) => {
      const e = eventDate(track);
      return !!e && date >= dateStr(dayjs(e));
    };
    // FIX-S S1/S2: today's class subject pair (rotation order, exam run-up aware)
    const classPair = classPairFor(date);
    const isUrgentNow = (it) => !!it.overdue
      || (isDateStr(it.deadline) && dayjs(it.deadline).diff(dayjs(date), 'day') <= URGENT_LEAD_DAYS);

    let cursor = startM;
    let capacity = dayCapacity(date, isDayOff);
    const dayStart = capacity;
    let blocks = 0;
    let dupGuard = 0;

    const push = (subject, topic, type, minutes, track, priority) => {
      const m = Math.min(Math.floor(num(minutes, 0)), Math.floor(capacity));
      if (m < MIN_BLOCK_MIN) return 'small';
      const start_time = minutesToTime(cursor);
      const end_time = minutesToTime(cursor + m);
      const key = dedupeKey({ date, start_time, subject: String(subject || ''), topic: String(topic || ''), session_type: type });
      if (existingKeys.has(key)) {
        // a real entry already owns this slot — step past it, never duplicate it
        duplicatesSuppressed += 1;
        cursor += m + BREATH_MIN;
        return 'dup';
      }
      existingKeys.add(key);
      rows.push({
        user_id: userId,
        date,
        start_time,
        end_time,
        subject: String(subject || ''),
        topic: String(topic || ''),
        session_type: type,
        track: track || 'class',
        status: 'pending',
        duration_minutes: m,
        priority: priority || (type === 'mock' ? 'high' : 'normal'),
        created_at: stamp,
      });
      cursor += m + BREATH_MIN;
      capacity = Math.max(0, capacity - (m + BREATH_MIN));
      blocks += 1;
      return 'ok';
    };

    // size a study block: capped by the track quota, the day and the item itself,
    // and it swallows a stranded tail instead of wasting it
    // allowTail is only true for capacity that no track claimed (phase 2), so a
    // track's declared share is never stolen to round off somebody else's block.
    const blockFor = (item, quota, allowTail) => {
      let block = Math.min(MAX_BLOCK_MIN, Math.floor(num(quota, 0)), Math.floor(capacity), Math.ceil(num(item.remainingMinutes, 0)));
      if (block < MIN_BLOCK_MIN) return 0;
      if (allowTail && capacity - block - BREATH_MIN < MIN_BLOCK_MIN) {
        block = Math.min(Math.floor(capacity), Math.max(block, Math.floor(capacity) - BREATH_MIN));
      }
      return block >= MIN_BLOCK_MIN ? block : 0;
    };

    // place one study block for a track; returns 'ok' | 'dup' | 'none'
    // onlySubjects (FIX-S S1): restrict the pick to the day's subject pair — the
    // most urgent chapter WITHIN that pair leads, everything else keeps its queue.
    const placeStudy = (track, quota, allowTail, onlySubjects) => {
      const q = queues[track];
      if (!q || !q.length) return 'none';
      if (track === 'class' && classProtected) { protectedBlocksSkipped += 1; return 'none'; }
      sortQueue(track);
      const pool = onlySubjects && onlySubjects.length ? q.filter((it) => onlySubjects.includes(it.subject)) : q;
      if (!pool.length) return 'none';
      const it = pool[0];
      const block = blockFor(it, Math.min(num(quota, 0), capacity), allowTail);
      if (!block) return 'none';
      const res = push(it.subject, it.chapter, 'study', block, track, it.overdue ? 'high' : 'normal');
      if (res === 'small') return 'none';
      if (res === 'dup') return 'dup';
      it.remainingMinutes = Math.max(0, it.remainingMinutes - block);
      it.plannedMinutes += block;
      studied.push({ subject: it.subject, chapter: it.chapter, date, track });
      if (it.remainingMinutes > 0 && it.remainingMinutes < MIN_BLOCK_MIN) {
        it.absorbedMinutes = it.remainingMinutes; // tail too small for a real block
        it.remainingMinutes = 0;
      }
      if (it.remainingMinutes <= 0) {
        const idx = q.indexOf(it);
        if (idx >= 0) q.splice(idx, 1); // the picked item is not always the queue head now
        finishedTopics += 1;
        // every 2nd finished topic gets a timed-practice block
        if (finishedTopics % 2 === 0 && capacity >= 35) {
          push(it.subject, `Timed practice: 10 Qs in 25 min (${it.chapter})`, 'practice', 30, track);
        }
      }
      return 'ok';
    };

    // spend up to `quota` minutes of this track's allocation; returns minutes used.
    // Behaviour is unchanged when onlySubjects is null (non-class tracks).
    const spendQuota = (track, quota, onlySubjects) => {
      let spent = 0;
      while (capacity >= MIN_BLOCK_MIN && spent < quota && blocks < MAX_BLOCKS_PER_DAY && dupGuard <= MAX_BLOCKS_PER_DAY) {
        const before = capacity;
        const res = placeStudy(track, Math.min(quota - spent, capacity), false, onlySubjects);
        if (res === 'none') break;
        if (res === 'dup') { dupGuard += 1; spent += MIN_BLOCK_MIN; if (capacity === before) continue; }
        spent += before - capacity;
      }
      return spent;
    };

    // minutes this track MUST get today to still make its deadlines (EDF rate)
    const deadlineNeed = (track) => {
      const q = queues[track];
      if (!q || !q.length) return 0;
      let need = 0;
      for (const it of q) {
        if (!isDateStr(it.deadline)) continue;
        const days = dayjs(it.deadline).diff(dayjs(date), 'day');
        if (days > URGENT_LEAD_DAYS) continue;
        need += num(it.remainingMinutes, 0) / Math.max(1, days);
      }
      return Math.ceil(need);
    };

    pruneExpired(date);

    // zero available time => plan nothing at all (never invent minutes)
    if (noCapacity) continue;

    // FIX-S S3: today's conquered-chapter test / spaced revisions go in FIRST —
    // short, dated commitments that consolidation must not lose. Nothing is
    // dropped: a session that does not fit (or lands on an exam day or a declared
    // day off) simply rolls to the next day of the plan.
    if (!isDayOff && pipeline.length) {
      while (pipeline.length && pipeline[0].date <= date && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
        const s = pipeline[0];
        const pkey = [s.subject, s.topic, s.type].join('|');
        if (pipelineKeys.has(pkey)) { pipeline.shift(); pipelineSuppressed += 1; continue; }
        if (s.track === 'class' && classBlocked) { pipeline.shift(); pipelineCutoffStopped += 1; continue; }
        if (eventPassed(s.track)) { pipeline.shift(); pipelineEventStopped += 1; continue; }
        if (schoolExamToday && s.kind === 'test') break; // no full chapter test ON an exam day — it waits
        const res = push(s.subject, s.topic, s.type, s.minutes, s.track, s.kind === 'test' ? 'high' : 'normal');
        if (res === 'small') break;                     // no room for a real block today -> rolls forward
        pipelineKeys.add(pkey);
        pipeline.shift();
        if (res === 'dup') { pipelineSuppressed += 1; continue; }
        pipelineEmitted[s.kind] = num(pipelineEmitted[s.kind], 0) + 1;
      }
    }

    // School exam DAY itself — light revision only, no new topics
    if (schoolExamToday) {
      const exam = exams.find((e) => date >= e.start && date <= e.end);
      push('School Exam', `${(exam && exam.label) || 'Exam'} — quick recall + formula scan`, 'revision', Math.min(EXAM_DAY_REVISION_MIN, capacity), 'class');
      continue;
    }

    // Mock day: full-length timed test + analysis.
    // FIX-S S4: a mock belongs to the event that drives it. A board/main-exam or
    // pre-school-exam mock is class-track; a mock driven only by an olympiad date
    // is OLYMPIAD prep — labelling it class would let the class-session cutoff
    // delete legitimate olympiad work (olympiad/competitive run to their own dates).
    if (isMockDay) {
      const mockLabel = dayBeforeSchoolExam ? 'Pre-school-exam mock' : 'Full-length mock';
      const mockTrack = examDate != null || dayBeforeSchoolExam || !olympiadDate ? 'class' : 'olympiad';
      push('Mock Test', `${mockLabel} + analysis`, 'mock', Math.min(MOCK_MIN, capacity), mockTrack, 'high');
      if (capacity >= 30) push('Analysis', 'Review mock mistakes + weak chapters', 'revision', Math.min(MOCK_ANALYSIS_MIN, capacity), mockTrack);
      continue;
    }

    // Revision wave before school exams: no NEW topics, revise the done ones.
    // FIX-S S2: inside the run-up the chapters DUE BEFORE that exam lead the wave,
    // so the last fortnight revises what the exam will actually ask. The wave's
    // shape (revision + timed practice, zero new study) is unchanged.
    if (inSchoolExamRev && !isDayOff && studied.some((s) => s.track === 'class')) {
      const classTopics = studied.filter((s) => s.track === 'class');
      const recent = classTopics.slice(-REV_WAVE_PICKS);
      const run = runUpFor(date);
      // chapters of subjects that are DUE BEFORE this exam lead the wave; if none of
      // them are in the most recent picks, reach back for them rather than revise
      // something the exam will not ask
      const dueAll = run ? classTopics.filter((t) => run.dueSubjects.includes(t.subject)) : [];
      const pool = dueAll.length ? dueAll.slice(-REV_WAVE_PICKS) : recent;
      const waveBlock = (idx, movedFrom) => {
        const subj = pool[idx % pool.length];
        const label = movedFrom
          ? `Revision wave (moved from ${movedFrom}): ${subj.chapter}`
          : `Revision wave: ${subj.chapter}`;
        push(subj.subject, label, 'revision', Math.min(MAX_BLOCK_MIN, capacity), 'class');
        if (capacity >= 45) {
          const nxt = pool[(idx + 1) % pool.length];
          push(nxt.subject, `Timed practice: 10 Qs in 25 min (${nxt.chapter})`, 'practice', Math.min(35, capacity), 'class');
        }
      };
      waveBlock(d, null);
      const movedFrom = movedWaveDates.get(date);
      if (movedFrom && capacity >= MIN_BLOCK_MIN) waveBlock(d + 1, movedFrom);
      continue;
    }

    // Main-exam buffer days
    if (mainExamBufferDay) {
      push('Buffer', 'Backlog / weak topics cleanup', 'revision', Math.min(90, capacity), 'class');
      continue;
    }

    // ---- normal study day ----
    studyDays += 1;
    studyCapacityMin += dayStart;

    // ---- daily allocation ----
    // Phase 1a: the student's split is the FLOOR for every track that has work,
    // so no track is ever starved to zero by another track's deadlines.
    const budgets = {};
    for (const t of allocatable) budgets[t] = Math.round((dayStart * num(prio.timeSplit[t], 0)) / 100);
    const working = allocatable.filter((t) => (queues[t] || []).length);
    for (const t of working) sortQueue(t);
    const alloc = {};
    for (const t of allocatable) alloc[t] = working.includes(t) ? num(budgets[t], 0) + num(leftover[t], 0) : 0;
    // free pool = the day's minutes that no working track claimed as its floor
    let freePool = Math.max(0, dayStart - working.reduce((a, t) => a + alloc[t], 0));
    let free = freePool;

    // Phase 1b: deadline-driven top-up (earliest-deadline-first). A track whose
    // due work cannot fit in its floor gets the free pool first, and may then
    // borrow from LESS urgent tracks — but never below one viable block, so
    // borrowing raises urgency without starving anybody to zero.
    const needy = working
      .map((t) => ({ t, need: Math.min(deadlineNeed(t), dayStart) }))
      .filter((x) => x.need > alloc[x.t])
      .sort((a, b) => compareUrgency(queues[a.t][0], queues[b.t][0], ctx));
    for (const { t, need } of needy) {
      let deficit = need - alloc[t];
      if (deficit <= 0) continue;
      const fromFree = Math.min(deficit, free);
      alloc[t] += fromFree;
      free -= fromFree;
      freePool = Math.max(0, freePool - fromFree);
      deficit -= fromFree;
      if (deficit <= 0) continue;
      const lenders = working
        .filter((o) => o !== t && alloc[o] > 0 && compareUrgency(queues[t][0], queues[o][0], ctx) < 0)
        .sort((a, b) => compareUrgency(queues[b][0], queues[a][0], ctx)); // least urgent lends first
      for (const o of lenders) {
        if (deficit <= 0) break;
        const canTake = Math.max(0, alloc[o] - Math.min(alloc[o], MIN_BLOCK_MIN));
        if (!canTake) continue;
        const took = Math.min(deficit, canTake);
        alloc[o] -= took;
        alloc[t] += took;
        deficit -= took;
      }
    }

    // Phase 1c: spend each track's allocation. A class day is spent on the day's
    // subject PAIR (FIX-S S1): the lead subject takes the bigger share when it has
    // a deadline breathing down its neck, but the second subject is never removed
    // from the day — it keeps at least one real block whenever the day can hold two.
    for (const track of allocatable) {
      const q = queues[track];
      if (!q || !q.length) { leftover[track] = 0; continue; }
      const quota = num(alloc[track], 0);
      if (quota < MIN_BLOCK_MIN) {
        // too small for a real block today — bank it rather than inflate it
        leftover[track] = isDayOff ? 0 : Math.min(LEFTOVER_CAP_MIN, quota);
        continue;
      }
      if (track === 'class' && classBlocked) { leftover[track] = 0; continue; } // FIX-S S4
      const pair = track === 'class' ? classPair : null;
      const lead = pair && pair.length ? pair[0] : null;
      const second = pair && pair.length > 1 ? pair[1] : null;
      const leadHasWork = !!lead && q.some((it) => it.subject === lead);
      const secondHasWork = !!second && q.some((it) => it.subject === second);
      let spent = 0;
      if (leadHasWork && secondHasWork && quota >= 2 * MIN_BLOCK_MIN) {
        const leadUrgent = q.some((it) => it.subject === lead && isUrgentNow(it));
        const secondQuota = clampNum(
          leadUrgent ? PAIR_URGENT_SECONDARY_MIN : Math.round(quota * PAIR_SECONDARY_SHARE),
          MIN_BLOCK_MIN,
          Math.max(MIN_BLOCK_MIN, quota - MIN_BLOCK_MIN)
        );
        spent += spendQuota(track, quota - secondQuota, [lead]);
        spent += spendQuota(track, secondQuota, [second]);
      } else if (leadHasWork || secondHasWork) {
        // one half of the pair is finished -> that subject takes the day (S1b)
        spent += spendQuota(track, quota, [leadHasWork ? lead : second]);
      } else {
        // pair exhausted (or a non-class track): plain urgency order, as before
        spent += spendQuota(track, quota, null);
      }
      leftover[track] = isDayOff ? 0 : Math.min(LEFTOVER_CAP_MIN, Math.max(0, quota - spent));
    }

    // revision cycle every 3rd day (revisit the last topics)
    if (d % REVISION_CYCLE_DAYS === REVISION_CYCLE_DAYS - 1 && studied.length && capacity >= 20) {
      const recent = studied.slice(-4);
      const bySubject = {};
      for (const s of recent) (bySubject[s.subject] = bySubject[s.subject] || new Set()).add(s.chapter);
      const subjects = Object.keys(bySubject);
      if (subjects.length) {
        const subj = subjects[d % subjects.length];
        const chapters = [...bySubject[subj]].slice(0, 2).join(', ');
        const lastTrack = recent[recent.length - 1].track || 'class';
        // FIX-S S4: class-track consolidation stops at the session cutoff, and no
        // track gets consolidation sessions after its own event date
        if (!(lastTrack === 'class' && classBlocked) && !eventPassed(lastTrack)) {
          push(subj, `Revision: ${chapters}`, 'revision', Math.min(40, capacity), lastTrack);
        }
      }
    }

    // short quiz slot when there's leftover time
    if (capacity >= 20 && studied.length) {
      const last = studied[studied.length - 1];
      if (!(last.track === 'class' && classBlocked) && !eventPassed(last.track)) {
        push(last.subject, `Quick quiz: ${last.chapter}`, 'quiz', Math.min(20, capacity), last.track);
      }
    }

    // Phase 2 — minutes that no track claimed flow to the most at-risk REAL work.
    // A track that has work keeps its declared share; only unclaimed time moves.
    while (freePool > 0 && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY && dupGuard <= MAX_BLOCKS_PER_DAY) {
      for (const t of allocatable) sortQueue(t);
      const cands = allocatable.filter((t) => (queues[t] || []).length && !(t === 'class' && (classProtected || classBlocked)));
      if (!cands.length) break;
      cands.sort((a, b) => compareUrgency(queues[a][0], queues[b][0], ctx));
      const winner = cands[0];
      // FIX-S S1: unclaimed minutes stay inside the day's class pair as well, so a
      // top-up can never undo the interleave; if that pair is finished, the minutes
      // still go to real class work instead of being wasted.
      const only = winner === 'class' && classPair.length ? classPair : null;
      const before = capacity;
      let res = placeStudy(winner, capacity, true, only);
      if (res === 'none' && only) res = placeStudy(winner, capacity, true, null);
      if (res === 'none') break;
      if (res === 'dup') { dupGuard += 1; if (capacity === before) continue; }
      freePool = Math.max(0, freePool - (before - capacity));
    }
  }

  // anything still unfinished whose event date the plan already reached is too late,
  // not merely "did not fit" — classified honestly instead of silently dropped
  pruneExpired(dateStr(horizon));

  // ---------- coverage: honest reporting, powers the priority banner ----------
  const nextSchool = nextSchoolExamOnOrAfter(exams, today);
  const perTrack = {};
  for (const t of allocatable) perTrack[t] = { total: 0, planned: 0, started: 0 };
  for (const it of items) {
    const b = perTrack[it.track] || (perTrack[it.track] = { total: 0, planned: 0, started: 0 });
    b.total += 1;
    if (it.remainingMinutes <= 0) b.planned += 1;
    else if (it.plannedMinutes > 0) b.started += 1;
  }

  const briefOf = (it) => ({
    id: it.id, subject: it.subject, chapter: it.chapter, track: it.track,
    weightage: it.weightage, deadline: it.deadline,
    remainingHours: round1(it.remainingMinutes / 60),
  });
  const planned = items
    .filter((it) => it.plannedMinutes > 0)
    .sort((a, b) => compareUrgency(a, b, ctx))
    .map((it) => ({ ...briefOf(it), plannedHours: round1(it.plannedMinutes / 60), complete: it.remainingMinutes <= 0 }));
  const tooLateIds = new Set(tooLate.map((t) => t.id));
  const stillOpen = items.filter((it) => !tooLateIds.has(it.id));
  // unscheduled = got NO time at all; partial = started but could not be finished
  const unscheduled = stillOpen
    .filter((it) => it.plannedMinutes <= 0 && it.remainingMinutes > 0)
    .sort((a, b) => compareUrgency(b, a, ctx))
    .map(briefOf);
  const partial = stillOpen
    .filter((it) => it.plannedMinutes > 0 && it.remainingMinutes > 0)
    .sort((a, b) => compareUrgency(b, a, ctx))
    .map((it) => ({ ...briefOf(it), plannedHours: round1(it.plannedMinutes / 60) }));

  // FIX-S S2: class chapters whose deadline lands INSIDE a protected exam window
  // cannot be finished before that exam — no new topics are allowed in there (the
  // accepted H4 rule wins). They are named here and scheduled after the exam
  // instead of being quietly treated as on time.
  const dueInProtected = items
    .filter((it) => it.track === 'class' && isDateStr(it.deadline) && protectedDates.has(it.deadline))
    .sort((a, b) => compareUrgency(a, b, ctx))
    .map(briefOf);

  const requiredMinutes = items.reduce((a, it) => a + it.plannedMinutes + it.remainingMinutes, 0);
  const plannedMinutes = items.reduce((a, it) => a + it.plannedMinutes, 0);
  const totalRequiredHours = Math.round(requiredMinutes / 60);
  const totalAvailableHours = Math.round(totalDays * dailyHours);
  const requiredPerDay = totalDays > 0 ? round1(requiredMinutes / 60 / totalDays) : 0;
  const overdueCount = items.filter((it) => it.overdue).length;
  const overloaded = unscheduled.length > 0 || partial.length > 0 || tooLate.length > 0 || requiredPerDay > dailyHours;
  const shortfallHours = Math.max(0, round1((requiredMinutes - plannedMinutes) / 60));
  // FIX-S S2: the nearest exam run-up that overlaps this plan window (else null)
  const horizonEnd = dateStr(horizon);
  const nextRunUp = runUps
    .filter((r) => r.start >= today && r.windowStart <= horizonEnd)
    .sort((a, b) => (a.start < b.start ? -1 : 1))[0] || null;

  let coverageWarning = null;
  if (noCapacity) {
    coverageWarning = `⚠️ No study time available (${dailyHours} hrs/day) — nothing was scheduled. Set your real daily hours in Profile; no time was invented.`;
  } else if (requiredPerDay > dailyHours) {
    coverageWarning = `⚠️ Need ${requiredPerDay.toFixed(1)} hrs/day but you have ${dailyHours} hrs/day — ${(requiredPerDay - dailyHours).toFixed(1)} hrs short. Increase daily hours or extend exam date.`;
  }
  if (overloaded && (unscheduled.length || partial.length)) {
    const extra = `${unscheduled.length} chapter(s) got no time and ${partial.length} could not be finished in this plan — listed, not hidden.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ${extra}` : `⚠️ Overloaded: ${extra}`;
  }
  if (tooLate.length) {
    const late = `${tooLate.length} chapter(s) cannot be prepared before their exam/olympiad date — they stop at that date instead of being scheduled after it.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ${late}` : `⚠️ ${late}`;
  }
  // FIX-S S2: class chapters due INSIDE a protected exam window cannot be finished
  // before that exam (no new topics are allowed in there). Say it plainly.
  if (dueInProtected.length) {
    const msg = `${dueInProtected.length} class chapter(s) are due inside the exam run-up window, where no new topics are allowed — they cannot be finished before that exam. Named in the summary, then scheduled after it.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${msg}` : `⚠️ ${msg}`;
  }
  // FIX-S S4: the class session has a hard end. Work that no longer fits is named
  // here — never quietly scheduled after the cutoff and never silently dropped.
  const classUnplaced = [...unscheduled, ...partial].filter((u) => u.track === 'class');
  if (classCutoffDays > 0 && classUnplaced.length) {
    const cut = `${classUnplaced.length} class chapter(s) could not be placed before the ${cutoff} class-session cutoff (no new class content after ${CLASS_SESSION_END.replace('-', '/')}) — listed above, not scheduled late and not dropped. Olympiad/exam tracks are unaffected.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${cut}` : `⚠️ ${cut}`;
  }
  // FIX-S S3: ladder steps that did not fit inside the plan window are named too
  if (pipeline.length) {
    const pend = `${pipeline.length} conquered-chapter session(s) (chapter test / spaced revision) did not fit before this plan's horizon ends — extend the plan window to keep the ladder whole.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${pend}` : `⚠️ ${pend}`;
  }

  const coverage = {
    priorityOrder: allocatable,
    timeSplit: prio.timeSplit,
    today,
    totalDays,
    studyDays,
    classTotal: (perTrack.class || { total: 0 }).total,
    classPlanned: (perTrack.class || { planned: 0 }).planned,
    classStarted: (perTrack.class || { started: 0 }).started,
    olympiadTotal: (perTrack.olympiad || { total: 0 }).total,
    olympiadPlanned: (perTrack.olympiad || { planned: 0 }).planned,
    olympiadStarted: (perTrack.olympiad || { started: 0 }).started,
    examTotal: (perTrack.exam || { total: 0 }).total,
    examPlanned: (perTrack.exam || { planned: 0 }).planned,
    examStarted: (perTrack.exam || { started: 0 }).started,
    custom: Object.keys(perTrack)
      .filter((t) => t.startsWith('custom:'))
      .map((t) => ({
        id: t,
        name: (prio.custom && prio.custom[t] && prio.custom[t].name) || t,
        total: perTrack[t].total,
        planned: perTrack[t].planned,
        started: perTrack[t].started,
      })),
    nextSchoolExam: nextSchool,
    classDoneBy: nextSchool ? dateStr(dayjs(nextSchool.start).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day')) : null,
    olympiadDoneBy: olympiadDate ? dateStr(dayjs(olympiadDate).subtract(1, 'day')) : null,
    examDoneBy: examDate ? dateStr(dayjs(examDate).subtract(1, 'day')) : null,
    totalRequiredHours,
    totalAvailableHours,
    requiredPerDay,
    coverageWarning,
    // FIX-H honesty fields
    plannedMinutes,
    requiredMinutes,
    studyCapacityHours: round1(studyCapacityMin / 60),
    overdueCount,
    overloaded,
    planned,
    unscheduled,
    partial,
    tooLate,
    shortfallHours,
    classDueInProtectedWindow: dueInProtected,
    completedExcluded: built.completedExcluded,
    completedItems: built.completedItems,
    excludedItems: built.excludedItems,
    existingCount: existingRows.length,
    duplicatesSuppressed,
    protectedBlocksSkipped,
    noCapacity,
    reasons,
    // FIX-S fields (S1 rotation, S2 run-up, S3 ladder, S4 class cutoff)
    classCutoff: cutoff,
    classCutoffDaysBlocked: classCutoffDays,
    classCutoffUnplaced: classUnplaced.length,
    subjectRotation: rotation.order,
    subjectRotationDetail: rotation.subjects,
    examRunUp: nextRunUp,
    pipeline: {
      planned: pipelineTotal,
      tests: pipelineEmitted.test,
      revisions: pipelineEmitted.rev,
      duplicatesSuppressed: pipelineSuppressed,
      stoppedByCutoff: pipelineCutoffStopped,
      stoppedByEventDate: pipelineEventStopped,
      skippedDisabledTrack: pipelineSkippedTrack,
      notEmitted: pipeline.length,
    },
  };

  return { rows, coverage };
}

/**
 * Public entry point (unchanged shape): returns the row array, with the
 * coverage summary attached as `rows.coverage` for existing callers.
 */
export function generateSchedule(opts) {
  const { rows, coverage } = planSchedule(opts);
  rows.coverage = coverage;
  return rows;
}

// ---------- adaptive rescheduling (offline heuristic / catch-up) ----------
// Moves missed/overdue pending sessions to upcoming days, keeping
// the daily load balanced. Class-track sessions jump the queue —
// they move FIRST (school can't wait; the exam track can).
export function autoRescheduleMissed(scheduleRows, { dailyHours = 3, schoolExams = [], today: todayOpt = null } = {}) {
  // FIX-H: the plan date is injectable (tests/previews); default is todayStr(),
  // i.e. the same FIX-F dev-date mechanism the planner uses — one date system.
  const today = resolvePlanDate(todayOpt);
  // NEW X R7: also move skipped rows (date < today) — they roll forward, not vanish
  // FIX-D4: respect school exam ranges — never schedule heavy work into exam days
  const exams = allSchoolExams(schoolExams);
  const examDates = new Set();
  for (const e of exams) {
    const days = dayjs(e.end).diff(dayjs(e.start), 'day');
    for (let i = 0; i <= Math.min(days, 30); i++) examDates.add(dateStr(dayjs(e.start).add(i, 'day')));
  }
  const isExamDay = (d) => examDates.has(d);

  const missed = scheduleRows
    .filter((r) => (r.status === 'pending' || r.status === 'skipped') && r.date < today)
    .sort((a, b) => {
      const ta = TRACK_PRIORITY[rowTrack(a)] || 1;
      const tb = TRACK_PRIORITY[rowTrack(b)] || 1;
      if (ta !== tb) return ta - tb; // class first
      return a.date.localeCompare(b.date);
    });
  if (!missed.length) return { moved: [], kept: [] };

  const upcoming = scheduleRows
    .filter((r) => r.date >= today && r.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  const loadByDate = {};
  for (const r of upcoming) loadByDate[r.date] = (loadByDate[r.date] || 0) + (r.duration_minutes || 0);
  const cap = Math.max(45, dailyHours * 60);

  let day = dayjs(today);
  const moved = [];
  for (const m of missed) {
    // find next day with room, skipping school exam days for study sessions
    for (let i = 0; i < 28; i++) {
      const dstr = dateStr(day.add(i, 'day'));
      const isStudy = (m.session_type === 'study' || !m.session_type);
      if (isStudy && isExamDay(dstr)) continue; // FIX-D4: don't push study into exam range
      if ((loadByDate[dstr] || 0) + (m.duration_minutes || 30) <= cap) {
        loadByDate[dstr] = (loadByDate[dstr] || 0) + (m.duration_minutes || 30);
        moved.push({ ...m, date: dstr, status: 'pending' });
        break;
      }
    }
  }
  return { moved, kept: missed.filter((m) => !moved.find((x) => x.id === m.id)) };
}
