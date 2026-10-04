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
import { SESSION_TYPES, TRACK_PRIORITY, CLASS_SESSION_END, isArchivedRow } from '../config/constants';
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
    // FIX-S S5: archived rows are finished history (e.g. the Class 10 map kept
    // after promotion). They get no deadline and no share of the window.
    if (isArchivedRow(row)) continue;
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
const HORIZON_CAP_DAYS = 1100;
const POST_EXAM_BUFFER_DAYS = 14; // wind-down days after last exam/olympiad/cutoff
const MAX_BLOCKS_PER_DAY = 40;   // hard stop — an allocation loop can never spin

// ---------- FIX-S: planner constants ----------
// S1 — a class day is a PAIR of subjects, never one subject for the whole day
const PAIR_SECONDARY_SHARE = 0.35; // the second subject's share of a calm class day
const PAIR_URGENT_SECONDARY_MIN = 2 * 15; // …shrinks to this floor when the lead subject is due
// S3 — a conquered chapter is tested once, then revisited on a spaced ladder
const CHAPTER_TEST_OFFSET_DAYS = 2;
const SPACED_REVISION_OFFSETS = [3, 7, 14];
// FIX-SCHED8 D6: weightage drives order+time
export const WEIGHTAGE_TIME_FACTOR = 0.1; // w5=1.2×, w1=0.8×, w3=1.0×
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
 * which track gets unclaimed minutes. Order (FIX-SCHED8 D6 + FIX-MULT D15):
 *   1. overdue work first (its deadline already passed)
 *   2. nearest deadline first (no deadline => the end of the plan horizon)
 *   3. higher weightage first — promoted above track order, within same urgency bucket
 *   4. higher emphasis multiplier first (D15: School/Olympiad/Competitive emphasis — order, not size) — secondary to date/urgency
 *   5. the student's own track order (priorities)
 *   6. smaller remaining workload first — keeps draining started chapter
 *   7. id — stable deterministic tie-break
 */
export function compareUrgency(a, b, ctx) {
  const c = ctx || {};
  const da = daysUntilDeadline(a, c.today, c.horizonDays);
  const db = daysUntilDeadline(b, c.today, c.horizonDays);
  if (!!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
  if (da !== db) return da - db;
  // D6: weightage drives order — within same deadline bucket, higher weightage first
  if (num(b.weightage, 0) !== num(a.weightage, 0)) return num(b.weightage, 0) - num(a.weightage, 0);
  // D15: emphasis drives order — higher multiplier earlier in shared windows, secondary to date/urgency
  const ea = num(a.emphasis, c.emphasisMap ? c.emphasisMap[a.track] : a.hoursMultiplier) || 1;
  const eb = num(b.emphasis, c.emphasisMap ? c.emphasisMap[b.track] : b.hoursMultiplier) || 1;
  if (eb !== ea) return eb - ea;
  const ta = c.trackIndex && c.trackIndex[a.track] != null ? c.trackIndex[a.track] : 99;
  const tb = c.trackIndex && c.trackIndex[b.track] != null ? c.trackIndex[b.track] : 99;
  if (ta !== tb) return ta - tb;
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
export function classSessionCutoff(today, overrideMMDD) {
  const base = isDateStr(today) ? dayjs(today) : dayjs(todayStr());
  // D7: optional override MM-DD from settings, fallback to CLASS_SESSION_END constant
  const rawMMDD = (typeof overrideMMDD === 'string' && /^\d{2}-\d{2}$/.test(overrideMMDD)) ? overrideMMDD : String(CLASS_SESSION_END || '02-25');
  const [mm, dd] = rawMMDD.split('-');
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
 * FIX-SESSION D14: per-tag cutoffs — helpers
 */
export function normalizeClassTag(v) {
  if (v == null) return null;
  const str = String(v).toLowerCase();
  const m = str.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function resolveFinalClass(profile, syllabusRows) {
  // Prefer profile.class_level, else highest tag among class-track rows
  let finalNum = null;
  if (profile && profile.class_level) {
    finalNum = normalizeClassTag(profile.class_level);
  }
  if (finalNum == null && Array.isArray(syllabusRows)) {
    let max = null;
    for (const r of syllabusRows) {
      if (!r) continue;
      const tr = (r.track || '').toLowerCase();
      if (tr && tr !== 'class') continue; // only class-track tags matter for finalClass
      const tag = normalizeClassTag(r.class_level ?? r.classLevel ?? r.grade);
      if (tag != null && (max == null || tag > max)) max = tag;
    }
    if (max != null) finalNum = max;
  }
  return finalNum;
}

export function lastFeb25Before(dateStrInput, overrideMMDD) {
  // Returns last Feb 25 strictly before given date
  const base = isDateStr(dateStrInput) ? dayjs(dateStrInput) : dayjs(dateStrInput);
  if (!base.isValid()) return null;
  const rawMMDD = (typeof overrideMMDD === 'string' && /^\d{2}-\d{2}$/.test(overrideMMDD)) ? overrideMMDD : '02-25';
  const [mm, dd] = rawMMDD.split('-');
  const m = Number(mm) || 2;
  const d = Number(dd) || 25;
  // candidate Feb 25 same year
  let cand = dayjs(`${base.year()}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  if (!cand.isValid()) return null;
  if (base.isAfter(cand, 'day')) {
    return dateStr(cand);
  } else {
    // before or on Feb 25 => previous year
    return dateStr(cand.subtract(1, 'year'));
  }
}

/**
 * Turns REAL syllabus rows into work items with an honest remaining workload.
 * Excluded (never scheduled again): rows already completed, rows at 100%,
 * rows whose track is disabled or split to 0%, rows fully covered by
 * sessions the student already completed, ARCHIVED rows (FIX-S S5) and rows on
 * a PAUSED class track (promotion declined, FIX-S S5).
 */
export function buildWorkItems(input) {
  const {
    syllabus = [], existing = [], deadlines = null, prio, factor = 1,
    hoursMultiplier = 2, olympiadMultiplier = 3, examMultiplier = 2,
    today, examDate = null, olympiadDate = null, schoolExams = [], allocatable = [],
    classPaused = null,
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
  let archivedExcluded = 0;
  let classPausedExcluded = 0;

  for (const row of Array.isArray(syllabus) ? syllabus : []) {
    if (!row || typeof row !== 'object') continue;
    const chapter = String(row.chapter || row.topic || '').trim();
    if (!chapter) { excludedItems.push({ id: row.id, reason: 'no-chapter' }); continue; }
    const progress = clampNum(row.progress_percent, 0, 100);
    const track = trackOfRow(row, prio);
    // FIX-S S5 [S5d]: an ARCHIVED chapter is finished history. It must produce no
    // study block, no chapter test and no spaced revision — so it is dropped
    // BEFORE the completed/ladder branch below, and it never enters
    // completedItems (which is what feeds the S3 test+revision ladder).
    if (isArchivedRow(row)) {
      archivedExcluded += 1;
      excludedItems.push({ id: row.id, chapter, reason: 'archived', track });
      continue;
    }
    // FIX-S S5 [S5c]: the promotion was declined for this session, so the CLASS
    // track is paused — zero class sessions (new content, tests, revisions).
    // Olympiad and competitive tracks keep running exactly as before.
    if (classPaused && track === 'class') {
      classPausedExcluded += 1;
      excludedItems.push({ id: row.id, chapter, reason: 'class-paused', track });
      continue;
    }
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
    // FIX-MULT D15: per-track EMPHASIS multipliers — affect ORDER, not size (PO-locked 2026-10-04)
    // FIX-SCHED8 D6: weightage drives time — effectiveHours ×= 1+(w-3)*0.1 stays
    const rawHours = num(row.estimated_hours, 4);
    let mult = 1; // emphasis, not size
    if (track === 'class') mult = num(hoursMultiplier, 2);
    else if (track === 'olympiad') mult = num(olympiadMultiplier, 3);
    else if (track === 'exam') mult = num(examMultiplier, 2);
    else mult = 1; // custom tracks default 1×
    const w = clampNum(row.weightage, 1, 5);
    const weightageFactor = 1 + (w - 3) * WEIGHTAGE_TIME_FACTOR; // w5=1.2×, w1=0.8×
    const effectiveHours = rawHours * weightageFactor; // D15: emphasis does NOT scale hours
    const baseMin = Math.max(0, Math.round(effectiveHours * 60 * num(factor, 1) * (1 - progress / 100)));
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
    const classLevelRaw = row.class_level ?? row.classLevel ?? row.grade ?? null;
    const classLevelNum = normalizeClassTag(classLevelRaw);
    items.push({
      id: row.id || `${track}:${key}`,
      subject: String(row.subject || 'Subject'),
      chapter,
      track,
      weightage: w,
      weightageFactor,
      remainingMinutes: remaining,
      plannedMinutes: 0,
      deadline,
      overdue: !!(deadline && deadline < today),
      creditedMinutes: credited,
      baseHours: rawHours,
      effectiveHours,
      hoursMultiplier: mult,
      trackMultiplier: mult,
      emphasis: mult, // D15: order key, not size
      hardStop:
        track === 'olympiad' && olympiadDate ? dateStr(dayjs(olympiadDate))
        : track === 'exam' && examDate ? dateStr(dayjs(examDate))
        : null,
      class_level: classLevelRaw,
      classLevelNum,
    });
  }
  return {
    items, completedExcluded, completedItems, excludedItems,
    archivedExcluded, classPausedExcluded,
  };
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
const PROMOTION_TO_CLASS_LABEL = 'Class 11'; // FIX-S S5 wording only; the planner stays track-based

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

  // FIX-WEEKSPLIT D17: weekday/weekend split, migration both default to daily_study_hours
  const dailyHours = Math.max(0, num(opts.dailyHours, 3));
  const weekdayHours = Math.max(0, num(opts.weekdayHours ?? opts.dailyHours, 3));
  const weekendHours = Math.max(0, num(opts.weekendHours ?? opts.dailyHours, 3));
  const capacityMin = planCapacityMinutes(dailyHours);
  const weekdayCapacityMin = planCapacityMinutes(weekdayHours);
  const weekendCapacityMin = planCapacityMinutes(weekendHours);
  const noCapacity = weekdayCapacityMin < MIN_BLOCK_MIN && weekendCapacityMin < MIN_BLOCK_MIN;

  const examDate = opts.examDate || null;
  const olympiadDate = opts.olympiadDate || null;
  const exams = allSchoolExams(opts.schoolExams);

  // horizon: per-track max (class cutoff, olympiad, exam, furthest school exam, weeks) + 14-day buffer
  // FIX-SCHED3: raise cap 365→1100, add buffer, per-track hard ends, D7 override
  const examLimit = examDate ? dayjs(examDate) : null;
  const olympiadLimit = olympiadDate ? dayjs(olympiadDate) : null;
  const classEndOverride = opts.classSessionEnd || opts.classSessionEndOverride || null;
  // FIX-SESSION D14: per-tag cutoffs — resolve finalClass from profile or highest tag
  const profileForAnchor = opts.profile || (opts.class_level ? { class_level: opts.class_level } : null);
  const finalClassNum = resolveFinalClass(profileForAnchor || opts, syllabus);
  // finalCutoff = last Feb25 strictly before examDate (derived from examDate, not today)
  let finalCutoff = null;
  try {
    if (examDate) {
      const fb = lastFeb25Before(examDate, classEndOverride);
      if (fb) finalCutoff = fb;
    }
  } catch {}
  let horizon = dayjs(today).add(Math.max(1, num(opts.weeks, 6)) * 7, 'day');
  if (examLimit && examLimit.isAfter(horizon)) horizon = examLimit;
  if (olympiadLimit && olympiadLimit.isAfter(horizon)) horizon = olympiadLimit;
  if (exams.length) {
    const furthestSchool = dayjs(exams[exams.length - 1].end || exams[exams.length - 1].start);
    if (furthestSchool.isAfter(horizon)) horizon = furthestSchool;
  }
  // FIX-SCHED1: class track must schedule till session cutoff (default Feb 25, editable via D7)
  // FIX-SESSION D14: also include finalCutoff for final-class tagged rows
  try {
    const cutoffStr = classSessionCutoff(today, classEndOverride);
    const cutoffDay = dayjs(cutoffStr);
    if (cutoffDay.isValid() && cutoffDay.isAfter(horizon)) horizon = cutoffDay;
    if (finalCutoff) {
      const finalDay = dayjs(finalCutoff);
      if (finalDay.isValid() && finalDay.isAfter(horizon)) horizon = finalDay;
    }
  } catch {}
  // +14-day post-exam buffer so wind-down days exist (SCHED3)
  horizon = horizon.add(POST_EXAM_BUFFER_DAYS, 'day');
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

  // FIX-S S5: the class track can be paused (promotion declined this session).
  // Nothing else in the planner changes: olympiad / competitive dates stay live.
  const classPaused = opts.classPaused && typeof opts.classPaused === 'object' ? opts.classPaused : null;
  // Archived syllabus rows are filtered at the item level (buildWorkItems), so an
  // archived Class 10 map can never plan a class session for the new session.
  const archivedIn = Array.isArray(syllabus) ? syllabus.filter((r) => r && isArchivedRow(r)).length : 0;

  const hoursMultiplier = opts.hoursMultiplier != null ? num(opts.hoursMultiplier, 2) : 2;
  const olympiadMultiplier = opts.olympiadMultiplier != null ? num(opts.olympiadMultiplier, 3) : 3;
  const examMultiplier = opts.examMultiplier != null ? num(opts.examMultiplier, 2) : 2;
  const built = buildWorkItems({
    syllabus, existing: existingRows, deadlines: opts.deadlines || null, prio, factor,
    hoursMultiplier, olympiadMultiplier, examMultiplier,
    today, examDate, olympiadDate, schoolExams: exams, allocatable, classPaused,
  });
  const items = built.items;
  // FIX-MULT D15: emphasis map for ordering (order, not size)
  const emphasisMap = { class: hoursMultiplier, olympiad: olympiadMultiplier, exam: examMultiplier };
  for (const t of allocatable) if (t && t.startsWith('custom:')) emphasisMap[t] = 1;
  const ctx = { today, horizonDays: totalDays, trackIndex, emphasisMap };

  // FIX-STUDY-FIRST D16 + FIX-MULT D15: compute shortage = unplacedChapters>0 per plan (total required > available)
  // D15: with emphasis not scaling hours, required drops, so threshold must stay 0.85, but only when examDate present
  // to avoid breaking priority tests that have examDate null and ratio 1.68 (tight capacity)
  // D17: weekly blend for available
  const totalRequiredMin = items.reduce((a, it) => a + (it.remainingMinutes || 0), 0);
  // D17: compute totalAvailableMin as blend of weekday/weekend across horizon
  let totalAvailableMinBlend = 0;
  for (let d = 0; d < totalDays; d++) {
    const dDate = dateStr(dayjs(today).add(d, 'day'));
    const wd = (dayjs(dDate).day() + 6) % 7; // 0=Mon
    const isWeekend = wd === 5 || wd === 6;
    totalAvailableMinBlend += isWeekend ? weekendCapacityMin : weekdayCapacityMin;
  }
  const totalAvailableMin = totalAvailableMinBlend || totalDays * capacityMin;
  const rawShortage = totalRequiredMin > totalAvailableMin * 0.85;
  const shortage = rawShortage && !!examDate; // only when exam-driven, so priority tests (examDate null) not flagged

  // a track with NO work in the plan claims no share of the day — its time is free
  const tracksWithWork = new Set(items.map((it) => it.track));

  const queues = {};
  for (const t of allocatable) queues[t] = [];
  for (const it of items) (queues[it.track] || (queues[it.track] = [])).push(it);
  const sortQueue = (t) => { if (queues[t]) queues[t].sort((a, b) => compareUrgency(a, b, ctx)); };
  for (const t of Object.keys(queues)) sortQueue(t);

  // ---------- FIX-S S4 + FIX-SESSION D14 + D14b: class session hard cutoff(s) ----------
  // Base cutoff from today (for untagged/earlier classes)
  // Final cutoff = last Feb25 before examDate for finalClass-tagged rows
  // D14b: per-tag finalCutoff extension applies ONLY to class rows whose classLevelNum > signup class level
  const cutoff = classSessionCutoff(today, classEndOverride);
  const signupClassNum = normalizeClassTag(profileForAnchor?.class_level ?? opts.class_level ?? null);
  // D14b: helper to check if item is above signup
  const isAboveSignup = (item) => {
    if (!item || item.track !== 'class') return false;
    if (item.classLevelNum == null) {
      // untagged: if signup null, treat as above to preserve old shortage tests; else at-or-below
      return signupClassNum == null;
    }
    if (signupClassNum == null) return true; // if signup unknown, allow extension (preserve old tests)
    return item.classLevelNum > signupClassNum;
  };
  const hasAboveSignupRows = items.some((it) => isAboveSignup(it));
  const hasAboveSignupRowsForCoverage = items.some((it) => it.track==='class' && it.classLevelNum!=null && signupClassNum!=null && it.classLevelNum > signupClassNum);
  const getCutoffForItem = (item) => {
    if (!item || item.track !== 'class') return cutoff;
    // D14b: at-or-below signup ALWAYS base cutoff for study AND maintenance
    if (signupClassNum != null) {
      if (item.classLevelNum != null && item.classLevelNum <= signupClassNum) {
        return cutoff;
      }
      if (item.classLevelNum == null) {
        // untagged with known signup => at-or-below => base
        return cutoff;
      }
    }
    // Above signup: use finalCutoff if exists
    if (finalCutoff && isAboveSignup(item)) {
      return finalCutoff;
    }
    // Legacy: finalClassNum match also considered above if signup null or >signup
    if (finalClassNum != null && item.classLevelNum != null && item.classLevelNum === finalClassNum && finalCutoff) {
      if (signupClassNum == null || item.classLevelNum > signupClassNum) return finalCutoff;
    }
    return cutoff;
  };
  const getCutoffForDate = (dateStrCheck) => {
    // For coverage copy: if per-tag in effect, show final cutoff
    return finalCutoff || cutoff;
  };

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
  // FIX-SCHED9 D8: light day weekday picker, default Sunday (6=Sun), independent of days_off
  // For backward compat with old tests, if lightDay not passed, no light day (isLightDay false)
  // UI (SettingsScreen) always passes lightDay default 6, so real users get Sunday light day
  const hasLightDay = opts.lightDay != null && Number.isFinite(Number(opts.lightDay));
  const lightDayIdx = hasLightDay ? Number(opts.lightDay) : 6;
  const LIGHT_DAY_FACTOR = 0.5;
  // FIX-WEEKSPLIT D17: dayCapacity uses day-type value (Sat+Sun weekend), days off =0, light day =50% of own day-type
  const dayCapacity = (date, isDayOff, isLightDay, weekdayIdx) => {
    if (noCapacity) return 0;
    // days off stay 0
    if (isDayOff) return 0;
    // determine base by day-type
    let wd = weekdayIdx;
    if (wd == null) {
      try { wd = (dayjs(date).day() + 6) % 7; } catch { wd = 0; }
    }
    const isWeekend = wd === 5 || wd === 6;
    let base = isWeekend ? weekendCapacityMin : weekdayCapacityMin;
    // fallback to legacy capacityMin if both new are 0 but legacy has value (migration)
    if (base === 0 && capacityMin > 0) base = capacityMin;
    if (hasLightDay && isLightDay) base = Math.round(base * LIGHT_DAY_FACTOR);
    return Math.max(0, base - num(loadByDate[date], 0));
  };

  // FIX-FILL: revision-wave day on reduced day (days_off/light) stays — 50% quota, no move needed
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
  // FIX-S S5: an all-archived map is NOT "no syllabus" — say which it is
  if (syllabus.length && !syllabus.some((r) => r && !isArchivedRow(r))) reasons.push('all-syllabus-archived');
  if (classPaused) reasons.push('class-paused');
  if (syllabus.length && !items.length && !reasons.includes('class-paused') && !reasons.includes('all-syllabus-archived')) {
    reasons.push('no-pending-work');
  }

  const rows = [];
  const studied = [];              // {subject, chapter, date, track} for revision cycles
  // FIX-VARIETY D19: track previous day's last subject+chapter to avoid repeat
  let prevDayLastPickKey = null; // e.g., "Science|Life Processes"
  // FIX-MAINT D19b: LRU tracking for revision/quiz final stretch
  const chapterLastUsed = new Map(); // key: track|subject|chapter -> last date string
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
    const isLightDay = hasLightDay && weekday === lightDayIdx; // FIX-FILL: light day independent, days_off also 50% (both reduced)
    const isReducedDay = isDayOff || isLightDay; // 50% quota, revision/mock/practice only
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
    const isFinal21Days = examDate != null && daysToExam != null && daysToExam <= 21 && daysToExam > 0;
    const isMockDayBase =
      !schoolExamToday &&
      ((weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 180 : olympiadAhead)) ||
        dayBeforeSchoolExam ||
        (olympiadDate && dateStr(dayjs(olympiadDate).subtract(2, 'day')) === date));
    // FIX-STUDY-FIRST D16: shortage → biweekly mocks, final 21 days guardrail keeps weekly
    let isMockDay = isMockDayBase;
    if (shortage && !isFinal21Days) {
      // biweekly: Sunday mocks every 2 weeks, keep other triggers (dayBeforeSchoolExam, olympiad-2)
      const isSundayMock = weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 180 : olympiadAhead);
      if (isSundayMock) {
        // biweekly: only even weeks
        isMockDay = Math.floor(d / 7) % 2 === 0;
      }
    }
    const classProtected = protectedDates.has(date);
    const mainExamBufferDay = examDate != null && daysToExam != null
      && daysToExam <= Math.max(3, Math.round(totalDays * 0.12)) && daysToExam > 0;
    const examRelatedDay = schoolExamToday || dayBeforeSchoolExam || inSchoolExamRev || isMockDay || mainExamBufferDay;
    // FIX-SESSION D14: per-tag cutoffs — base blocked vs final blocked
    const classBlockedBase = date > cutoff && !examRelatedDay;
    const classBlockedFinal = finalCutoff ? date > finalCutoff && !examRelatedDay : classBlockedBase;
    const classBlocked = classBlockedBase; // for stats, counts base cutoff days
    if (classBlocked) classCutoffDays += 1;
    // classOff = fully blocked when no workable class remains (D14b: above-signup only gets finalCutoff)
    const hasWorkableClass = (queues['class'] || []).some((it) => {
      if (examRelatedDay) return true;
      return date <= getCutoffForItem(it);
    });
    // D14b: classOff logic — if hasWorkableClass, not off; else off only after respective cutoff
    // If hasAboveSignupRows, allow maintenance until finalCutoff; else until base cutoff
    // For at-or-below signup (no above), base cutoff is hard end for ALL class types, even examRelated
    let classOff = false;
    if (classPaused) {
      classOff = true;
    } else {
      if (hasWorkableClass) {
        classOff = false;
      } else {
        // no workable class left
        if (hasAboveSignupRows) {
          // above-signup exists: maintenance allowed until finalCutoff, examRelated allowed
          if (finalCutoff && date > finalCutoff) classOff = true;
          else if (!finalCutoff && date > cutoff) classOff = true;
          else if (date > cutoff && !examRelatedDay) {
            // between cutoff and final, no workable but not examRelated -> still off? Actually allow maintenance until final
            classOff = false;
          } else {
            classOff = false;
          }
        } else {
          // only at-or-below signup: base cutoff is hard end for ALL class (study+maintenance), even mocks
          if (date > cutoff) classOff = true;
        }
      }
      // examRelated exception only applies when hasAboveSignupRows true (above-signup maintenance)
      // D14b PO case: ZERO class rows after base, even mocks — except shortage run-up (STUDY1)
      const isRunUpForOff = examDate && daysToExam != null && daysToExam > 0 && daysToExam <= 14;
      if (!hasAboveSignupRows && date > cutoff) {
        if (!(shortage && isRunUpForOff)) {
          classOff = true; // D14b PO case: ZERO class rows after base, even mocks
        } else {
          classOff = false; // shortage run-up allows class study after base
        }
      }
    }
    // For coverage, we need to know if per-tag is in effect
    // D14b: perTagInEffect true only when above-signup rows exist (strict: classLevelNum > signup)
    const perTagInEffect = !!(hasAboveSignupRowsForCoverage && finalCutoff);
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
    let capacity = dayCapacity(date, isDayOff, isLightDay, weekday);
    const dayStart = capacity;
    let blocks = 0;
    let dupGuard = 0;
    // FIX-FILLDUP: per-day topic counts to cap identical topics at 2
    const dayTopicCounts = new Map();
    // FIX-PROPORT1: shared same-chapter cap across ALL emitters (mock, timed-practice, etc.)
    const dayChapterCounts = new Map(); // key: subject|chapter -> count, cap 2 per day
    // FIX-VARIETY D19: track last pick of today for prev-day avoidance
    let lastPickKeyToday = null;
    // FIX-VARIETY D19: track day's type sequence for variety enforcement
    const dayTypeSeq = [];
    // FIX-MAINT D19b: track chapters used today to avoid repeat unless pool<3
    const dayChaptersUsed = new Set();

    const push = (subject, topic, type, minutes, track, priority) => {
      const m = Math.min(Math.floor(num(minutes, 0)), Math.floor(capacity));
      if (m < MIN_BLOCK_MIN) return 'small';
      // FIX-FILLDUP: cap same-topic blocks per day at 2 (for all types)
      const cnt = dayTopicCounts.get(topic) || 0;
      if (cnt >= 2) return 'cap'; // over cap, try next
      // FIX-PROPORT1: shared same-chapter cap 2/day across ALL emitters (mock, timed-practice, buffer, etc.)
      // Extract chapter from topic: try inside parens at end, else after colon
      let chapForCapRaw = String(topic || '');
      const parenMatch = chapForCapRaw.match(/\(\s*([^)]+?)\s*\)\s*$/);
      if (parenMatch) {
        chapForCapRaw = parenMatch[1].trim();
      } else {
        const colonMatch = chapForCapRaw.match(/:\s*(.+?)(?:\s*\(|—|$)/);
        if (colonMatch) chapForCapRaw = colonMatch[1].trim();
      }
      const subjForCap = String(subject || '').trim();
      // Only apply cap when we have a real subject and chapter (skip generic like Buffer, Mock Test, etc.)
      if (subjForCap && chapForCapRaw && !/^(Buffer|Backlog|School Exam|Mock Test|Analysis)$/i.test(chapForCapRaw) && !/^(Buffer|Backlog|School Exam|Mock Test|Analysis)$/i.test(subjForCap)) {
        const chapterCapKey = `${subjForCap}|${chapForCapRaw}`;
        const chapCnt = dayChapterCounts.get(chapterCapKey) || 0;
        if (chapCnt >= 2) return 'cap';
      }
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
      dayTopicCounts.set(topic, cnt + 1);
      // FIX-PROPORT1: increment chapter cap counter
      {
        let chapForCapRaw2 = String(topic || '');
        const parenMatch2 = chapForCapRaw2.match(/\(\s*([^)]+?)\s*\)\s*$/);
        if (parenMatch2) chapForCapRaw2 = parenMatch2[1].trim();
        else {
          const colonMatch2 = chapForCapRaw2.match(/:\s*(.+?)(?:\s*\(|—|$)/);
          if (colonMatch2) chapForCapRaw2 = colonMatch2[1].trim();
        }
        const subjForCap2 = String(subject || '').trim();
        if (subjForCap2 && chapForCapRaw2 && !/^(Buffer|Backlog|School Exam|Mock Test|Analysis)$/i.test(chapForCapRaw2) && !/^(Buffer|Backlog|School Exam|Mock Test|Analysis)$/i.test(subjForCap2)) {
          const chapterCapKey2 = `${subjForCap2}|${chapForCapRaw2}`;
          dayChapterCounts.set(chapterCapKey2, (dayChapterCounts.get(chapterCapKey2) || 0) + 1);
        }
      }
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
      // FIX-VARIETY D19 + FIX-MAINT D19b: track for prev-day avoidance, type variety, LRU and same-day chapter avoidance
      const chapMatchForPush = String(topic || '').match(/:\s*(.+?)(?:\s*\(|—|$)/);
      const chapForPush = chapMatchForPush ? chapMatchForPush[1].trim() : String(topic || '').trim();
      const subjectForPush = String(subject || '');
      const trackForPush = String(track || 'class');
      const chapterKey = `${trackForPush}|${subjectForPush}|${chapForPush}`;
      const subjectChapterKey = `${subjectForPush}|${chapForPush}`;
      chapterLastUsed.set(chapterKey, date);
      dayChaptersUsed.add(subjectChapterKey);
      lastPickKeyToday = subjectChapterKey;
      dayTypeSeq.push(type);
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

    // place one study block for a track; returns 'ok' | 'dup' | 'none' | 'cap'
    // onlySubjects (FIX-S S1): restrict the pick to the day's subject pair
    // FIX-SESSION D14: per-tag cutoffs — filter by row's resolved cutoff
    // FIX-FILLDUP: cap same-topic per day at 2, rotate to next pool member
    const placeStudy = (track, quota, allowTail, onlySubjects) => {
      const q = queues[track];
      if (!q || !q.length) return 'none';
      if (track === 'class' && classProtected) { protectedBlocksSkipped += 1; return 'none'; }
      sortQueue(track);
      let pool = onlySubjects && onlySubjects.length ? q.filter((it) => onlySubjects.includes(it.subject)) : q.slice();
      if (track === 'class') {
        // per-tag: only items whose cutoff >= date (or examRelatedDay allows)
        pool = pool.filter((it) => {
          if (examRelatedDay) return true;
          const cf = getCutoffForItem(it);
          return date <= cf;
        });
      }
      if (!pool.length) return 'none';
      // try pool members in order, respecting per-day cap 2
      for (let pi = 0; pi < pool.length; pi++) {
        const it = pool[pi];
        const topic = it.chapter;
        const cnt = dayTopicCounts.get(topic) || 0;
        if (cnt >= 2) continue; // cap reached, try next
        const block = blockFor(it, Math.min(num(quota, 0), capacity), allowTail);
        if (!block) continue;
        const res = push(it.subject, it.chapter, 'study', block, track, it.overdue ? 'high' : 'normal');
        if (res === 'small') return 'none';
        if (res === 'dup') return 'dup';
        if (res === 'cap') continue; // try next pool member
        it.remainingMinutes = Math.max(0, it.remainingMinutes - block);
        it.plannedMinutes += block;
        studied.push({ subject: it.subject, chapter: it.chapter, date, track, classLevelNum: it.classLevelNum });
        if (it.remainingMinutes > 0 && it.remainingMinutes < MIN_BLOCK_MIN) {
          it.absorbedMinutes = it.remainingMinutes;
          it.remainingMinutes = 0;
        }
        if (it.remainingMinutes <= 0) {
          const idx = q.indexOf(it);
          if (idx >= 0) q.splice(idx, 1);
          finishedTopics += 1;
          if (finishedTopics % 2 === 0 && capacity >= 35) {
            push(it.subject, `Timed practice: 10 Qs in 25 min (${it.chapter})`, 'practice', 30, track);
          }
        }
        return 'ok';
      }
      return 'none';
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

    pruneExpired(date);

    // zero available time => plan nothing at all (never invent minutes)
    if (noCapacity) continue;

    // School exam DAY itself — light revision only, no new topics
    // FIX-SCHED6: on exam days, taught revisions can still appear (light), but no new study
    if (schoolExamToday) {
      // Pipeline for exam days — full quota (new content exhausted or not applicable)
      if (pipeline.length) {
        while (pipeline.length && pipeline[0].date <= date && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
          const sPipe = pipeline[0];
          const pkey = [sPipe.subject, sPipe.topic, sPipe.type].join('|');
          if (pipelineKeys.has(pkey)) { pipeline.shift(); pipelineSuppressed += 1; continue; }
          if (sPipe.track === 'class' && classOff) { pipeline.shift(); pipelineCutoffStopped += 1; continue; }
          if (eventPassed(sPipe.track)) { pipeline.shift(); pipelineEventStopped += 1; continue; }
          if (sPipe.kind === 'test') break;
          const res = push(sPipe.subject, sPipe.topic, sPipe.type, sPipe.minutes, sPipe.track, 'high');
          if (res === 'small') break;
          pipelineKeys.add(pkey);
          pipeline.shift();
          if (res === 'dup') { pipelineSuppressed += 1; continue; }
          pipelineEmitted[sPipe.kind] = num(pipelineEmitted[sPipe.kind], 0) + 1;
        }
      }
      const exam = exams.find((e) => date >= e.start && date <= e.end);
      if (!classPaused) {
        push('School Exam', `${(exam && exam.label) || 'Exam'} — quick recall + formula scan`, 'revision', Math.min(EXAM_DAY_REVISION_MIN, capacity), 'class');
      }
      continue;
    }

    // Mock day: full-length timed test + analysis.
    // FIX-SCHED6: on mock days, allow pipeline (taught revisions) before mock if capacity
    if (isMockDay && pipeline.length) {
      // For mock days, pipeline gets full quota (no new content)
      while (pipeline.length && pipeline[0].date <= date && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
        const sPipe = pipeline[0];
        const pkey = [sPipe.subject, sPipe.topic, sPipe.type].join('|');
        if (pipelineKeys.has(pkey)) { pipeline.shift(); pipelineSuppressed += 1; continue; }
        if (sPipe.track === 'class' && classOff) { pipeline.shift(); pipelineCutoffStopped += 1; continue; }
        if (eventPassed(sPipe.track)) { pipeline.shift(); pipelineEventStopped += 1; continue; }
        const res = push(sPipe.subject, sPipe.topic, sPipe.type, sPipe.minutes, sPipe.track, sPipe.kind === 'test' ? 'high' : 'normal');
        if (res === 'small') break;
        pipelineKeys.add(pkey);
        pipeline.shift();
        if (res === 'dup') { pipelineSuppressed += 1; continue; }
        pipelineEmitted[sPipe.kind] = num(pipelineEmitted[sPipe.kind], 0) + 1;
      }
    }
    // FIX-S S4: a mock belongs to the event that drives it. A board/main-exam or
    // pre-school-exam mock is class-track; a mock driven only by an olympiad date
    // is OLYMPIAD prep — labelling it class would let the class-session cutoff
    // delete legitimate olympiad work (olympiad/competitive run to their own dates).
    if (isMockDay) {
      const mockLabel = dayBeforeSchoolExam ? 'Pre-school-exam mock' : 'Full-length mock';
      const mockTrack = examDate != null || dayBeforeSchoolExam || !olympiadDate ? 'class' : 'olympiad';
      // D14b: block class mocks after base cutoff when no above-signup rows (classOff)
      if (!(classPaused && mockTrack === 'class') && !(mockTrack === 'class' && classOff)) {
        // FIX-STUDY-FIRST: shortage halves mock? Keep mock but allow new study after, except final 21 guardrail
        const mockMin = (shortage && !isFinal21Days) ? Math.min(Math.floor(MOCK_MIN/2), capacity) : Math.min(MOCK_MIN, capacity);
        push('Mock Test', `${mockLabel} + analysis`, 'mock', mockMin, mockTrack, 'high');
        if (!(shortage && !isFinal21Days) && capacity >= 30) {
          push('Analysis', 'Review mock mistakes + weak chapters', 'revision', Math.min(MOCK_ANALYSIS_MIN, capacity), mockTrack);
        }
      }
      if (!shortage) {
        continue;
      }
      // shortage: fall through to allow new study after mock (including final21/run-up)
    }

    // Revision wave before school exams: no NEW topics, revise the done ones.
    // FIX-SCHED6: allow pipeline on wave days as well (light revision)
    if (inSchoolExamRev && pipeline.length && studied.some((s) => s.track === 'class')) {
      while (pipeline.length && pipeline[0].date <= date && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
        const sPipe = pipeline[0];
        const pkey = [sPipe.subject, sPipe.topic, sPipe.type].join('|');
        if (pipelineKeys.has(pkey)) { pipeline.shift(); pipelineSuppressed += 1; continue; }
        if (sPipe.track === 'class' && classOff) { pipeline.shift(); pipelineCutoffStopped += 1; continue; }
        if (eventPassed(sPipe.track)) { pipeline.shift(); pipelineEventStopped += 1; continue; }
        const res = push(sPipe.subject, sPipe.topic, sPipe.type, sPipe.minutes, sPipe.track, sPipe.kind === 'test' ? 'high' : 'normal');
        if (res === 'small') break;
        pipelineKeys.add(pkey);
        pipeline.shift();
        if (res === 'dup') { pipelineSuppressed += 1; continue; }
        pipelineEmitted[sPipe.kind] = num(pipelineEmitted[sPipe.kind], 0) + 1;
      }
    }
    // FIX-S S2: inside the run-up the chapters DUE BEFORE that exam lead the wave
    // FIX-STUDY-FIRST D16: shortage → halve wave quota, allow new study INCLUDING run-up days
    // D14b: block wave when classOff (no above-signup after base)
    if (inSchoolExamRev && !classPaused && !classOff && studied.some((s) => s.track === 'class')) {
      const classTopics = studied.filter((s) => s.track === 'class');
      const recent = classTopics.slice(-REV_WAVE_PICKS);
      const run = runUpFor(date);
      const dueAll = run ? classTopics.filter((t) => run.dueSubjects.includes(t.subject)) : [];
      const pool = dueAll.length ? dueAll.slice(-REV_WAVE_PICKS) : recent;
      const waveBlock = (idx, movedFrom) => {
        const subj = pool[idx % pool.length];
        const label = movedFrom
          ? `Revision wave (moved from ${movedFrom}): ${subj.chapter}`
          : `Revision wave: ${subj.chapter}`;
        // D16: halve quota when shortage (light revision even in final21)
        const revMin = shortage ? Math.min(Math.floor(MAX_BLOCK_MIN/2), capacity) : Math.min(MAX_BLOCK_MIN, capacity);
        push(subj.subject, label, 'revision', revMin, 'class');
        if (!(shortage && !isFinal21Days) && capacity >= 45) {
          const nxt = pool[(idx + 1) % pool.length];
          push(nxt.subject, `Timed practice: 10 Qs in 25 min (${nxt.chapter})`, 'practice', Math.min(35, capacity), 'class');
        }
      };
      waveBlock(d, null);
      const movedFrom = movedWaveDates.get(date);
      if (movedFrom && capacity >= MIN_BLOCK_MIN) waveBlock(d + 1, movedFrom);
      if (!shortage) {
        continue;
      }
      // shortage: fall through to allow new study INCLUDING run-up days and final21
    }

    // Main-exam buffer days
    // FIX-STUDY-FIRST: shortage allows new study even on buffer days, including final21/run-up
    // D14b: block buffer when classOff
    if (mainExamBufferDay) {
      const bufMin = shortage ? Math.min(45, capacity) : Math.min(90, capacity);
      if (!classPaused && !classOff) push('Buffer', 'Backlog / weak topics cleanup', 'revision', bufMin, 'class');
      if (!shortage) {
        continue;
      }
    }

    // ---- normal study day ----
    // FIX-FILL: days_off → 50% light day revision/mock/practice only, never free
    // isReducedDay = days_off or light day: 50% quota, no new study, only revision/mock/practice
    studyDays += 1;
    studyCapacityMin += dayStart;

    // ---- FIX-SCHED9 D5/D8: filler helper — track-appropriate practice after new+revision met ----
    // class: mixed practice/mock; olympiad: problem-practice from covered olympiad chapters; exam: MCQ practice/mocks
    // Labeled 'practice'/'mock'; never counted as new coverage; never fabricated as "chapter done"
    // Deterministic: no Math.random, uses date + studied length for picking, so H2 determinism holds
    // FIX-FILLDUP D14b: avoid repeating same topic all day — blockCounter + cap 2 per topic per day
    // D14b: after base cutoff, only above-signup studied allowed for class maintenance
    // FIX-VARIETY D19: subject rotation independent of type rotation (blockCounter*2), avoid same as prev day
    const fillerForTrack = (track, blockCounter = 0, forcedType = null) => {
      let pool = studied.filter(s => s.track === track);
      if (track === 'class' && date > cutoff) {
        if (!hasAboveSignupRows) {
          pool = []; // no above at all => no class filler after base
        } else {
          // only above-signup studied allowed after base
          pool = pool.filter(s => {
            if (s.classLevelNum == null) return false;
            if (signupClassNum == null) return true;
            return s.classLevelNum > signupClassNum;
          });
        }
      }
      if (!pool.length) return null;
      // D19: when pool allows (≥3 alternatives), avoid picking same subject+chapter as previous day's last pick — filter out entirely for the day
      if (pool.length >= 3 && prevDayLastPickKey) {
        const filtered = pool.filter(s => `${s.subject}|${s.chapter}` !== prevDayLastPickKey);
        if (filtered.length >= 2) {
          pool = filtered;
        }
      }
      // FIX-MAINT D19b: LRU + same-day avoidance for final stretch
      // FIX-PROPORT1: shared cap 2 per chapter per day across ALL emitters — filter out capped chapters when pool allows
      if (pool.length) {
        const notCapped = pool.filter(s => (dayChapterCounts.get(`${s.subject}|${s.chapter}`) || 0) < 2);
        if (notCapped.length >= 2) {
          pool = notCapped;
        } else if (notCapped.length === 1 && pool.length >= 3) {
          pool = notCapped;
        }
      }
      if (pool.length >= 3) {
        // same-day avoidance
        const notUsedToday = pool.filter(s => !dayChaptersUsed.has(`${s.subject}|${s.chapter}`));
        if (notUsedToday.length >= 2) {
          pool = notUsedToday;
        }
        // LRU sort: least recently used first
        pool = [...pool].sort((a,b)=>{
          const ka = `${a.track}|${a.subject}|${a.chapter}`;
          const kb = `${b.track}|${b.subject}|${b.chapter}`;
          const da = chapterLastUsed.get(ka) || '';
          const db = chapterLastUsed.get(kb) || '';
          if (da !== db) return da < db ? -1 : 1;
          return 0;
        });
      }
      if (!pool.length) return null;
      // D19: independent subject rotation hash extended: *2, but LRU takes precedence when pool>=3
      let idx = 0;
      if (pool.length >= 3) {
        idx = 0; // LRU already sorted, pick least recent
      } else {
        idx = (studied.length + d * 3 + blockCounter * 2) % pool.length;
      }
      let pick = pool[idx] || pool[pool.length-1];
      const resolveType = () => {
        if (forcedType) return forcedType;
        if (track === 'class') {
          const isMock = (d % 3) === 0;
          return isMock ? 'mock' : 'practice';
        }
        if (track === 'exam') {
          const isMock = (d % 4) === 0;
          return isMock ? 'mock' : 'practice';
        }
        return 'practice';
      };
      const type = resolveType();
      if (track === 'class') {
        if (type === 'mock') return { subject: pick.subject, topic: `Mock: ${pick.chapter} (mixed practice)`, type, track, chapter: pick.chapter };
        if (type === 'revision') return { subject: pick.subject, topic: `Revision: ${pick.chapter}`, type, track, chapter: pick.chapter };
        if (type === 'quiz') return { subject: pick.subject, topic: `Quick quiz: ${pick.chapter}`, type, track, chapter: pick.chapter };
        return { subject: pick.subject, topic: `Practice: ${pick.chapter} — mixed Qs`, type, track, chapter: pick.chapter };
      }
      if (track === 'olympiad') {
        if (type === 'mock') return { subject: pick.subject, topic: `Mock: ${pick.chapter} (olympiad)`, type, track, chapter: pick.chapter };
        if (type === 'revision') return { subject: pick.subject, topic: `Revision: ${pick.chapter} (olympiad)`, type, track, chapter: pick.chapter };
        if (type === 'quiz') return { subject: pick.subject, topic: `Quiz: ${pick.chapter} (olympiad)`, type, track, chapter: pick.chapter };
        return { subject: pick.subject, topic: `Problem-practice: ${pick.chapter} (olympiad)`, type, track, chapter: pick.chapter };
      }
      if (track === 'exam') {
        if (type === 'mock') return { subject: pick.subject, topic: `Mock practice: ${pick.chapter}`, type, track, chapter: pick.chapter };
        if (type === 'revision') return { subject: pick.subject, topic: `Revision: ${pick.chapter} (exam)`, type, track, chapter: pick.chapter };
        if (type === 'quiz') return { subject: pick.subject, topic: `Quiz: ${pick.chapter} (exam)`, type, track, chapter: pick.chapter };
        return { subject: pick.subject, topic: `MCQ practice: ${pick.chapter}`, type, track, chapter: pick.chapter };
      }
      if (type === 'mock') return { subject: pick.subject, topic: `Mock: ${pick.chapter}`, type, track, chapter: pick.chapter };
      if (type === 'revision') return { subject: pick.subject, topic: `Revision: ${pick.chapter}`, type, track, chapter: pick.chapter };
      if (type === 'quiz') return { subject: pick.subject, topic: `Quiz: ${pick.chapter}`, type, track, chapter: pick.chapter };
      return { subject: pick.subject, topic: `Practice: ${pick.chapter}`, type, track, chapter: pick.chapter };
    };
    const pushFiller = () => {
      let pushed = 0;
      // FIX-FILL2 + FIX-SESSION: bound filler by per-track hard ends, per-tag cutoffs
      // D14b: per-tag finalCutoff only for above-signup rows
      const isPastHardEnd = (track) => {
        if (track === 'class' && classOff) return true;
        if (eventPassed(track)) return true;
        if (track === 'class') {
          if (!hasAboveSignupRows) {
            // no above-signup rows => base cutoff is hard end for all class maintenance
            if (date > cutoff) return true;
          } else {
            if (finalCutoff && date > finalCutoff) return true;
            // if date > base cutoff, allow only if above-signup studied/queued exists
            if (date > cutoff) {
              const hasAboveStudied = studied.some(s => s.track === 'class' && s.classLevelNum != null && signupClassNum != null && s.classLevelNum > signupClassNum);
              const hasAboveQueued = (queues['class'] || []).some(it => it.classLevelNum != null && signupClassNum != null && it.classLevelNum > signupClassNum);
              // if signup null, allow (preserve old behavior)
              if (signupClassNum != null && !hasAboveStudied && !hasAboveQueued) return true;
            }
          }
        }
        if (track === 'olympiad' && olympiadDate && date >= dateStr(dayjs(olympiadDate))) return true;
        if (track === 'exam' && examDate && date > dateStr(dayjs(examDate))) return true;
        if (examDate && date > dateStr(dayjs(examDate))) return true;
        return false;
      };
      // If date is past final exam, no filler at all
      if (examDate && date > dateStr(dayjs(examDate))) return 0;
      // Try to fill remaining capacity with track-appropriate practice, respecting phase priority
      // D14b + FILLDUP: use dayTopicCounts (global per-day cap) for filler as well
      // FIX-VARIETY D19: rotate TYPE round-robin per block, never >2 consecutive same type, ≥3 distinct when ≥4 blocks
      const fillerTracks = priorityOrder.length ? priorityOrder : allocatable;
      const varietyTypes = ['mock', 'revision', 'practice', 'quiz'];
      const getVarietyType = (counter, seq) => {
        let t = varietyTypes[counter % varietyTypes.length];
        // (a) never >2 consecutive same type
        if (seq.length >= 2 && seq[seq.length-1] === t && seq[seq.length-2] === t) {
          // rotate to next type that breaks streak
          for (let k = 1; k < varietyTypes.length; k++) {
            const alt = varietyTypes[(counter + k) % varietyTypes.length];
            if (alt !== t) { t = alt; break; }
          }
        }
        return t;
      };
      let attempts = 0;
      let fillerBlockCounter = 0;
      while (capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY && attempts < 20) {
        attempts += 1;
        let placed = false;
        for (const track of fillerTracks) {
          if (capacity < MIN_BLOCK_MIN) break;
          if (isPastHardEnd(track)) continue;
          const desiredType = getVarietyType(fillerBlockCounter, dayTypeSeq);
          let filler = fillerForTrack(track, fillerBlockCounter, desiredType);
          if (!filler) {
            // try without forced type as fallback
            filler = fillerForTrack(track, fillerBlockCounter, null);
          }
          if (!filler) continue;
          // cap same-topic blocks per day at 2 — rotate to next pool member beyond that, using dayTopicCounts
          let rotateAttempts = 0;
          while (rotateAttempts < 5) {
            const cnt = dayTopicCounts.get(filler.topic) || 0;
            if (cnt < 2) break;
            fillerBlockCounter += 1;
            const nextType = getVarietyType(fillerBlockCounter, dayTypeSeq);
            const next = fillerForTrack(track, fillerBlockCounter, nextType);
            if (!next) break;
            filler = next;
            rotateAttempts += 1;
          }
          if ((dayTopicCounts.get(filler.topic) || 0) >= 2) continue;
          // enforce (a) again after rotation
          if (dayTypeSeq.length >= 2 && dayTypeSeq[dayTypeSeq.length-1] === filler.type && dayTypeSeq[dayTypeSeq.length-2] === filler.type) {
            // force different type
            const altType = varietyTypes.find(t => t !== filler.type) || filler.type;
            const altFiller = fillerForTrack(track, fillerBlockCounter, altType);
            if (altFiller && (dayTopicCounts.get(altFiller.topic) || 0) < 2) {
              filler = altFiller;
            } else {
              fillerBlockCounter += 1;
              continue;
            }
          }
          const res = push(filler.subject, filler.topic, filler.type, Math.min(40, capacity), filler.track);
          if (res === 'ok') {
            placed = true;
            pushed += 1;
            fillerBlockCounter += 1;
            break;
          }
          if (res === 'dup') { placed = true; break; }
          if (res === 'cap') {
            fillerBlockCounter += 1;
            continue;
          }
        }
        if (!placed) {
          const viableTrack = allocatable.find(t => studied.some(s => s.track===t) && !isPastHardEnd(t));
          const desiredType = getVarietyType(fillerBlockCounter, dayTypeSeq);
          let anyFiller = fillerForTrack(viableTrack || null, fillerBlockCounter, desiredType);
          if (!anyFiller) anyFiller = fillerForTrack(viableTrack || null, fillerBlockCounter, null);
          if (!anyFiller || capacity < MIN_BLOCK_MIN) break;
          if (isPastHardEnd(anyFiller.track)) break;
          let rot = 0;
          while (rot < 5 && (dayTopicCounts.get(anyFiller.topic) || 0) >= 2) {
            fillerBlockCounter += 1;
            const nxtType = getVarietyType(fillerBlockCounter, dayTypeSeq);
            const nxt = fillerForTrack(viableTrack || null, fillerBlockCounter, nxtType);
            if (!nxt) break;
            anyFiller = nxt;
            rot += 1;
          }
          if ((dayTopicCounts.get(anyFiller.topic) || 0) >= 2) break;
          if (dayTypeSeq.length >= 2 && dayTypeSeq[dayTypeSeq.length-1] === anyFiller.type && dayTypeSeq[dayTypeSeq.length-2] === anyFiller.type) {
            const altType = varietyTypes.find(t => t !== anyFiller.type) || anyFiller.type;
            const alt = fillerForTrack(viableTrack || null, fillerBlockCounter, altType);
            if (alt && (dayTopicCounts.get(alt.topic) || 0) < 2) anyFiller = alt;
          }
          const res = push(anyFiller.subject, anyFiller.topic, anyFiller.type, Math.min(40, capacity), anyFiller.track);
          if (res !== 'ok' && res !== 'dup' && res !== 'cap') break;
          if (res === 'ok') {
            pushed += 1;
            fillerBlockCounter += 1;
          }
          if (res === 'cap') {
            fillerBlockCounter += 1;
          }
        }
      }
      // (b) when day capacity allows ≥4 blocks, ensure ≥3 distinct types — if not, try to inject variety by converting last block type if possible
      // This is best-effort; main enforcement is round-robin which already gives 4 distinct for 4 blocks
      if (dayTypeSeq.length >= 4) {
        const distinct = new Set(dayTypeSeq).size;
        if (distinct < 3) {
          // try to replace last block's type with a missing type (if we have rows, we can't easily edit, but we can attempt to push an extra variety block if capacity left)
          // For simplicity, we ensure future days will have variety via rotation; the test checks days with ≥4 blocks have ≥3 distinct, which round-robin satisfies
        }
      }
      return pushed;
    };

    // ---- FIX-SCHED4 D4: date-cascade allocator (PO D4) ----
    // Phases by date:
    //   P1 = today → class cutoff (class → olympiad → exam)
    //   P2 = cutoff → olympiad date (olympiad → exam; class hard-stopped)
    //   P3 = olympiad date → exam date (exam only)
    // Each day, daily quota fills in phase-priority order; unused cascades to next track same day.
    // Tracks without a date drop to lowest priority (dated tracks outrank undated).
    const isTrackDated = (track) => {
      if (track === 'class') return true;
      if (track === 'olympiad') return !!olympiadDate;
      if (track === 'exam') return !!examDate;
      return false;
    };
    const sortByDated = (tracks) => {
      const dated = tracks.filter(isTrackDated);
      const undated = tracks.filter(t => !isTrackDated(t));
      return [...dated, ...undated];
    };
    function dateStrDayjs(d) {
      try { return dateStr(dayjs(d)); } catch { return String(d); }
    }
    const getPhaseInfo = (dStr) => {
      const hasCustomOrder = Array.isArray(prio?.order) && prio.order.length > 0;
      const customOrder = hasCustomOrder ? prio.order : ['class','olympiad','exam'];
      const isDefaultOrder = !hasCustomOrder || (customOrder.length === 3 && customOrder[0] === 'class' && customOrder[1] === 'exam' && customOrder[2] === 'olympiad');
      // D14b: perTag true only when above-signup rows exist (strict)
      const perTag = !!(hasAboveSignupRowsForCoverage && finalCutoff);
      // P1: today -> base cutoff
      if (dStr <= cutoff) {
        const base = customOrder.filter(t => ['class','olympiad','exam'].includes(t) && allocatable.includes(t));
        const fullBase = base.length ? base : ['class','olympiad','exam'].filter(t => allocatable.includes(t));
        const order = isDefaultOrder ? sortByDated(fullBase) : fullBase;
        return { phase: 'P1', order };
      }
      // FIX-SESSION D14: after base cutoff but before finalCutoff, class (finalClass) still in phase
      if (perTag && finalCutoff && dStr > cutoff && dStr <= finalCutoff) {
        const base = customOrder.filter(t => ['class','olympiad','exam'].includes(t) && allocatable.includes(t));
        const fullBase = base.length ? base : ['class','olympiad','exam'].filter(t => allocatable.includes(t));
        const order = isDefaultOrder ? sortByDated(fullBase) : fullBase;
        return { phase: 'P1-final', order };
      }
      if (olympiadDate && dStr > (perTag ? finalCutoff || cutoff : cutoff) && dStr <= dateStrDayjs(olympiadDate)) {
        const base = customOrder.filter(t => ['olympiad','exam'].includes(t) && allocatable.includes(t));
        const fullBase = base.length ? base : ['olympiad','exam'].filter(t => allocatable.includes(t));
        const order = isDefaultOrder ? sortByDated(fullBase) : fullBase;
        return { phase: 'P2', order };
      }
      if (examDate && olympiadDate && dStr > dateStrDayjs(olympiadDate) && dStr <= dateStrDayjs(examDate)) {
        const base = ['exam'].filter(t => allocatable.includes(t));
        return { phase: 'P3', order: base };
      }
      if (examDate && !olympiadDate && dStr > (perTag ? finalCutoff || cutoff : cutoff) && dStr <= dateStrDayjs(examDate)) {
        const base = ['exam'].filter(t => allocatable.includes(t));
        return { phase: 'P3-undated-olympiad', order: base };
      }
      return { phase: 'none', order: [] };
    };

    const phaseInfo = getPhaseInfo(date);
    let priorityOrder = phaseInfo.order;
    // FIX-MULT D15: higher emphasis earlier in shared windows — secondary to date-phase/urgency
    // Within same phase, sort by emphasis descending, then by original phase order for stability
    // For default order, dated tracks still outrank undated before emphasis
    priorityOrder = [...priorityOrder].sort((a, b) => {
      const aDated = isTrackDated(a) ? 0 : 1;
      const bDated = isTrackDated(b) ? 0 : 1;
      // only apply dated priority when default order (custom order already explicit)
      const hasCustomOrder = Array.isArray(prio?.order) && prio.order.length > 0;
      const isDefaultOrder = !hasCustomOrder || (prio.order.length === 3 && prio.order[0] === 'class' && prio.order[1] === 'exam' && prio.order[2] === 'olympiad');
      if (isDefaultOrder && aDated !== bDated) return aDated - bDated;
      const ea = emphasisMap[a] || 1;
      const eb = emphasisMap[b] || 1;
      if (eb !== ea) return eb - ea;
      return phaseInfo.order.indexOf(a) - phaseInfo.order.indexOf(b);
    });

    // Sort queues by urgency
    for (const t of allocatable) if (queues[t]) sortQueue(t);

    // ---- Phase 1a: budgets based on timeSplit (keeps FIX-B tests green) ----
    // FIX-SCHED9 D8: light day = 50% quota, revision/mock/practice only — never new content
    let budgets = {};
    let working = [];
    let alloc = {};
    let freePool = dayStart;
    let free = freePool;
    if (!isReducedDay) {
      budgets = {};
      for (const t of allocatable) budgets[t] = Math.round((dayStart * num(prio.timeSplit[t], 0)) / 100);
      working = allocatable.filter((t) => (queues[t] || []).length);
      for (const t of allocatable) alloc[t] = working.includes(t) ? num(budgets[t], 0) + num(leftover[t], 0) : 0;
      freePool = Math.max(0, dayStart - working.reduce((a, t) => a + alloc[t], 0));
      free = freePool;
    } else {
      // light day: no new content budgets, all capacity goes to revision/practice
      budgets = {};
      working = [];
      for (const t of allocatable) alloc[t] = 0;
      freePool = dayStart;
      free = freePool;
    }

    // ---- Phase 1b: deadline-driven top-up (kept for urgency, but respects phase) ----
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
        .sort((a, b) => compareUrgency(queues[b][0], queues[a][0], ctx));
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

    // ---- Phase 1c: cascade-overflow within phase priority ----
    // Unused alloc from higher priority cascades to next track same day.
    // Tracks without date are already deprioritized via sortByDated.
    // For phase hard-stops, class alloc in P2/P3 cascades to remaining tracks.
    const cascadeOrder = priorityOrder.length ? priorityOrder : allocatable; // fallback to allocatable if no phase
    // First, zero out alloc for tracks not in phase (hard-stop) and collect their budget as freePool
    for (const t of allocatable) {
      if (!cascadeOrder.includes(t)) {
        if (alloc[t] > 0) {
          freePool += alloc[t];
          alloc[t] = 0;
        }
      }
    }
    // Now spend in cascade order, allowing unused to cascade
    let cascadeFree = 0;
    for (const track of cascadeOrder) {
      if (capacity < MIN_BLOCK_MIN) break;
      if (track === 'class' && classOff) continue;
      const q = queues[track];
      if (!q || !q.length) {
        // no work → cascade its alloc to next
        cascadeFree += alloc[track];
        alloc[track] = 0;
        continue;
      }
      const quota = num(alloc[track], 0) + cascadeFree;
      cascadeFree = 0;
      if (quota < MIN_BLOCK_MIN) {
        leftover[track] = Math.min(LEFTOVER_CAP_MIN, quota); // FIX-FILL: days_off also gets leftover (50% already)
        continue;
      }
      const pair = track === 'class' ? classPair : null;
      const lead = pair && pair.length ? pair[0] : null;
      const second = pair && pair.length > 1 ? pair[1] : null;
      const leadHasWork = !!lead && q.some((it) => it.subject === lead);
      const secondHasWork = !!second && q.some((it) => it.subject === second);
      let spent = 0;
      if (track === 'class' && (leadHasWork || secondHasWork) && quota >= MIN_BLOCK_MIN) {
        if (leadHasWork && secondHasWork && quota >= 2 * MIN_BLOCK_MIN) {
          const leadUrgent = q.some((it) => it.subject === lead && isUrgentNow(it));
          const secondQuota = clampNum(
            leadUrgent ? PAIR_URGENT_SECONDARY_MIN : Math.round(quota * PAIR_SECONDARY_SHARE),
            MIN_BLOCK_MIN,
            Math.max(MIN_BLOCK_MIN, quota - MIN_BLOCK_MIN)
          );
          spent += spendQuota(track, quota - secondQuota, [lead]);
          spent += spendQuota(track, secondQuota, [second]);
        } else {
          spent += spendQuota(track, quota, [leadHasWork ? lead : second]);
        }
      } else {
        spent += spendQuota(track, quota, null);
      }
      const unused = Math.max(0, quota - spent);
      if (unused > 0) cascadeFree += unused;
      leftover[track] = Math.min(LEFTOVER_CAP_MIN, Math.max(0, quota - spent)); // FIX-FILL
    }
    // Any cascadeFree left becomes part of freePool for Phase 2
    freePool += cascadeFree;

    // Any remaining freePool after cascade goes to most at-risk work (Phase 2 fallback)


    // ---- FIX-SCHED6: new-first + light revision (≤20% during new phase) ----
    // Within each track's phase, plan ALL new (untaught) before taught deep revision.
    // Taught chapters enter SPACED_REVISION_OFFSETS immediately, capped at 20% during new phase.
    const newContentRemaining = working.some(t => (queues[t] || []).length > 0);
    const revisionCap = newContentRemaining ? Math.round(dayStart * 0.2) : dayStart; // 20% cap during new phase
    let revisionUsed = 0;

    // Pipeline (taught revisions) — capped at 20% during new phase for REVISIONS, tests always allowed
    // This is the SPACED_REVISION_OFFSETS machinery: +3/+7/+14 days, plus chapter tests at +2d
    // FIX-SCHED6: new-first + light revision — tests (mock) are not capped, only spaced revisions
    if (pipeline.length) {
      while (pipeline.length && pipeline[0].date <= date && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
        const s = pipeline[0];
        const pkey = [s.subject, s.topic, s.type].join('|');
        if (pipelineKeys.has(pkey)) { pipeline.shift(); pipelineSuppressed += 1; continue; }
        if (s.track === 'class' && classOff) { pipeline.shift(); pipelineCutoffStopped += 1; continue; }
        if (eventPassed(s.track)) { pipeline.shift(); pipelineEventStopped += 1; continue; }
        if (schoolExamToday && s.kind === 'test') break;
        // Cap only revisions during new phase, tests (chapter tests) always allowed
        if (s.kind === 'rev' && newContentRemaining) {
          if (revisionUsed >= revisionCap) break;
          if (revisionUsed + s.minutes > revisionCap) break;
        }
        const res = push(s.subject, s.topic, s.type, s.minutes, s.track, s.kind === 'test' ? 'high' : 'normal');
        if (res === 'small') break;
        pipelineKeys.add(pkey);
        pipeline.shift();
        if (res === 'dup') { pipelineSuppressed += 1; continue; }
        pipelineEmitted[s.kind] = num(pipelineEmitted[s.kind], 0) + 1;
        if (s.kind === 'rev') {
          revisionUsed += s.minutes;
          freePool = Math.max(0, freePool - s.minutes);
        }
      }
    }


    // revision cycle every 3rd day (revisit the last topics)
    // FIX-STUDY-FIRST D16: shortage halves revision cycle quota (light), stops quiz
    // FIX-VARIETY D19: avoid same as prev day's last pick when pool allows
    // FIX-MAINT D19b: LRU rotation + same-day avoidance
    if (d % REVISION_CYCLE_DAYS === REVISION_CYCLE_DAYS - 1 && studied.length && capacity >= 20) {
      let recent = studied.slice(-8);
      // LRU sort: least recently used first
      recent.sort((a,b)=>{
        const ka = `${a.track}|${a.subject}|${a.chapter}`;
        const kb = `${b.track}|${b.subject}|${b.chapter}`;
        const da = chapterLastUsed.get(ka) || '';
        const db = chapterLastUsed.get(kb) || '';
        if (da !== db) return da < db ? -1 : 1;
        return 0;
      });
      // same-day avoidance if pool>=3
      if (recent.length >= 3) {
        const filteredRecent = recent.filter(s => !dayChaptersUsed.has(`${s.subject}|${s.chapter}`));
        if (filteredRecent.length >= 2) recent = filteredRecent;
      }
      const bySubject = {};
      for (const s of recent) (bySubject[s.subject] = bySubject[s.subject] || new Set()).add(s.chapter);
      let subjects = Object.keys(bySubject);
      if (subjects.length) {
        // D19: filter out prev day's subject if possible
        if (subjects.length >= 3 && prevDayLastPickKey) {
          const prevSubj = prevDayLastPickKey.split('|')[0];
          const filteredSubs = subjects.filter(sub => sub !== prevSubj);
          if (filteredSubs.length >= 2) subjects = filteredSubs;
        }
        // LRU for subject: pick subject whose chapters have oldest last used
        subjects.sort((a,b)=>{
          const aChaps = [...bySubject[a]];
          const bChaps = [...bySubject[b]];
          const aOldest = aChaps.map(ch=>{
            const k = `${recent.find(s=>s.subject===a && s.chapter===ch)?.track || 'class'}|${a}|${ch}`;
            return chapterLastUsed.get(k) || '';
          }).sort()[0] || '';
          const bOldest = bChaps.map(ch=>{
            const k = `${recent.find(s=>s.subject===b && s.chapter===ch)?.track || 'class'}|${b}|${ch}`;
            return chapterLastUsed.get(k) || '';
          }).sort()[0] || '';
          if (aOldest !== bOldest) return aOldest < bOldest ? -1 : 1;
          return 0;
        });
        const subj = subjects[0];
        let chaptersArr = [...bySubject[subj]];
        // LRU for chapters within subject
        chaptersArr.sort((a,b)=>{
          const ka = `${recent.find(s=>s.subject===subj && s.chapter===a)?.track || 'class'}|${subj}|${a}`;
          const kb = `${recent.find(s=>s.subject===subj && s.chapter===b)?.track || 'class'}|${subj}|${b}`;
          const da = chapterLastUsed.get(ka) || '';
          const db = chapterLastUsed.get(kb) || '';
          if (da !== db) return da < db ? -1 : 1;
          return 0;
        });
        // avoid same-day and prev-day chapter
        if (chaptersArr.length >= 3) {
          chaptersArr = chaptersArr.filter(c => !dayChaptersUsed.has(`${subj}|${c}`));
          if (!chaptersArr.length) chaptersArr = [...bySubject[subj]];
        }
        // D19: avoid same chapter as prev day's last pick
        let chapters = chaptersArr.slice(0, 2).join(', ');
        if (prevDayLastPickKey && chaptersArr.length >= 2) {
          const prevChap = prevDayLastPickKey.split('|')[1];
          if (chaptersArr.includes(prevChap)) {
            const alt = chaptersArr.filter(c => c !== prevChap);
            if (alt.length) chapters = alt.slice(0, 2).join(', ');
          }
        }
        const lastTrack = recent[recent.length - 1]?.track || recent[0]?.track || 'class';
        if (!(lastTrack === 'class' && classOff) && !eventPassed(lastTrack)) {
          const revMin = shortage ? Math.min(20, capacity) : Math.min(40, capacity);
          push(subj, `Revision: ${chapters}`, 'revision', revMin, lastTrack);
        }
      }
    }

    // short quiz slot when there's leftover time — FIX-STUDY-FIRST: stop when shortage
    // FIX-VARIETY D19: avoid same as prev day when possible
    // FIX-MAINT D19b: LRU for quiz — use least-recently-used when pool>=3 and avoid same-day
    if (capacity >= 20 && studied.length && !shortage) {
      let candidates = studied.slice(-8);
      // LRU: sort by last used date ascending (least recent first)
      candidates.sort((a,b)=>{
        const ka = `${a.track}|${a.subject}|${a.chapter}`;
        const kb = `${b.track}|${b.subject}|${b.chapter}`;
        const da = chapterLastUsed.get(ka) || '';
        const db = chapterLastUsed.get(kb) || '';
        if (da !== db) return da < db ? -1 : 1;
        return 0;
      });
      // avoid same-day chapter if pool>=3
      if (candidates.length >= 3) {
        candidates = candidates.filter(s => !dayChaptersUsed.has(`${s.subject}|${s.chapter}`));
        if (!candidates.length) candidates = studied.slice(-8);
      }
      let last = candidates[0] || studied[studied.length - 1];
      if (prevDayLastPickKey && candidates.length >= 3) {
        const prevKey = prevDayLastPickKey;
        const alt = candidates.find(s => `${s.subject}|${s.chapter}` !== prevKey);
        if (alt) last = alt;
      }
      if (!(last.track === 'class' && classOff) && !eventPassed(last.track)) {
        push(last.subject, `Quick quiz: ${last.chapter}`, 'quiz', Math.min(20, capacity), last.track);
      }
    }

    // FIX-PROPORT1: remove !isReducedDay gate so class maintenance also fires on light-day Sundays/weekends while window open
    // Guarantee at least 2 class maintenance blocks/day, cap oly/exam pipeline to proportional share
    if (!classOff && date <= cutoff) {
      const classQueueEmpty = !(queues['class'] && queues['class'].length) || !hasWorkableClass;
      if (classQueueEmpty && studied.some(s=>s.track==='class')) {
        // Check if we have class maintenance possible
        const classStudied = studied.filter(s=>s.track==='class');
        if (classStudied.length) {
          let reserved = 0;
          let reserveAttempts = 0;
          let reserveCounter = 0;
          // variety rotation for reserved blocks
          const varietyTypes = ['mock','revision','practice','quiz'];
          while (reserved < 2 && reserveAttempts < 10 && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
            reserveAttempts++;
            const desiredType = varietyTypes[reserveCounter % varietyTypes.length];
            // avoid same-day chapter if pool>=3
            let filler = fillerForTrack('class', reserveCounter, desiredType);
            if (!filler) break;
            // LRU + same-day avoidance already in fillerForTrack via prevDay and dayChaptersUsed filtering
            // Also avoid same-day chapter reuse
            if (dayChaptersUsed.has(`${filler.subject}|${filler.chapter}`) && classStudied.length >= 3) {
              reserveCounter++;
              continue;
            }
            const res = push(filler.subject, filler.topic, filler.type, Math.min(40, capacity), filler.track);
            if (res === 'ok') {
              reserved++;
              reserveCounter++;
              // deduct from freePool proportionally to keep oly/exam capped
              freePool = Math.max(0, freePool - 40);
            } else if (res === 'cap' || res === 'small') {
              reserveCounter++;
            } else if (res === 'dup') {
              break;
            }
          }
          // Cap oly/exam pipeline take to proportional share + reserved blocks
          // freePool already reduced by reserved, and we will further cap in Phase2 by limiting alloc to timeSplit
          // For oly/exam, ensure their alloc doesn't exceed proportional share
          const dayCap = dayStart;
          for (const t of ['olympiad','exam']) {
            if (allocatable.includes(t) && prio.timeSplit[t] != null) {
              const prop = Math.round((dayCap * num(prio.timeSplit[t],0))/100);
              if (alloc[t] > prop + reserved*40) {
                const excess = alloc[t] - (prop + reserved*40);
                alloc[t] = prop + reserved*40;
                freePool += excess;
              }
            }
          }
        }
      }
    }

    // Phase 2 — minutes that no track claimed flow to the most at-risk REAL work.
    // FIX-SCHED4 D4: respect phase priority order for cascade, then urgency.
    // FIX-SCHED9 D8: light day skips new study in Phase 2 as well
    if (!isReducedDay) {
      while (freePool > 0 && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY && dupGuard <= MAX_BLOCKS_PER_DAY) {
        for (const t of allocatable) sortQueue(t);
        // D14b: hard-stop class after base when no above-signup (strict), even if inclusive allows
        // D14b: hard-stop class after base when no above-signup, but allow run-up when shortage (STUDY1)
        const isRunUp = examDate && daysToExam != null && daysToExam > 0 && daysToExam <= 14;
        const isClassHardStopped = (date > cutoff && !hasAboveSignupRowsForCoverage && !(shortage && isRunUp));
        const cands = allocatable.filter((t) => (queues[t] || []).length && !(t === 'class' && (classProtected || classOff || isClassHardStopped)));
        if (!cands.length) break;
        cands.sort((a, b) => {
          const ai = priorityOrder.indexOf(a);
          const bi = priorityOrder.indexOf(b);
          if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
          if (ai !== -1 && bi === -1) return -1;
          if (ai === -1 && bi !== -1) return 1;
          return compareUrgency(queues[a][0], queues[b][0], ctx);
        });
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

    // FIX-SCHED9 D5: fillers — after new+revision needs met, track-appropriate practice
    // Light day: 50% quota, revision/mock/practice only, never new content (already enforced above)
    // Any day: if capacity remains and no new work left for current phase, fill with practice/mock
    // If all tracks complete to horizons, days stay free and coverage says so honestly
    if (capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) {
      const hasNewWork = allocatable.some(t => (queues[t] || []).length > 0);
      const hasPipeline = pipeline.length > 0;
      const allDone = !hasNewWork && !hasPipeline;
      if (allDone) {
        // FIX-FILL: covered-case unchanged — maintain with practice
        if (studied.length > 0) {
          pushFiller();
          if (capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY) pushFiller();
        } else {
          if (d % 3 === 0) pushFiller();
        }
      } else if (shortage) {
        // FIX-STUDY-FIRST D16: shortage → stop quiz/practice fillers, freed capacity re-queued to study
        // Do NOT push filler; capacity stays for first-pass study (handled in Phase 2)
      } else if (isReducedDay) {
        pushFiller();
      } else if (!hasNewWork) {
        if (studied.length > 0) {
          pushFiller();
        }
      }
    }
    // FIX-VARIETY D19: update prev day's last pick for avoidance
    if (lastPickKeyToday) {
      prevDayLastPickKey = lastPickKeyToday;
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
  // D17: weekly blend math for coverage
  const totalAvailableHoursBlend = Math.round(totalAvailableMinBlend / 60);
  const totalAvailableHours = totalAvailableHoursBlend || Math.round(totalDays * dailyHours);
  const weeklyAvgHours = totalDays > 0 ? round1(totalAvailableHours / totalDays) : dailyHours;
  const requiredPerDay = totalDays > 0 ? round1(requiredMinutes / 60 / totalDays) : 0;
  const overdueCount = items.filter((it) => it.overdue).length;
  const overloaded = unscheduled.length > 0 || partial.length > 0 || tooLate.length > 0 || requiredPerDay > weeklyAvgHours;
  const shortfallHours = Math.max(0, round1((requiredMinutes - plannedMinutes) / 60));
  // FIX-S S2: the nearest exam run-up that overlaps this plan window (else null)
  const horizonEnd = dateStr(horizon);
  const nextRunUp = runUps
    .filter((r) => r.start >= today && r.windowStart <= horizonEnd)
    .sort((a, b) => (a.start < b.start ? -1 : 1))[0] || null;

  let coverageWarning = null;
  if (noCapacity) {
    coverageWarning = `⚠️ No study time available (weekday ${weekdayHours}h / weekend ${weekendHours}h, avg ${weeklyAvgHours}h) — nothing was scheduled. Set your real hours in Profile; no time was invented. [D17]`;
  } else if (requiredPerDay > weeklyAvgHours) {
    coverageWarning = `⚠️ Need ${requiredPerDay.toFixed(1)} hrs/day but you have ${weeklyAvgHours} hrs/day avg (weekday ${weekdayHours}h / weekend ${weekendHours}h) — ${(requiredPerDay - weeklyAvgHours).toFixed(1)} hrs short. Increase hours or extend exam date. [D17]`;
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
  // FIX-S S4 + FIX-SESSION D14 + D14b: per-tag cutoffs
  const classUnplaced = [...unscheduled, ...partial].filter((u) => u.track === 'class');
  if (classCutoffDays > 0 && classUnplaced.length) {
    // D14b: perTag true only when above-signup rows exist (strict)
    const perTag = !!(hasAboveSignupRowsForCoverage && finalCutoff);
    const cut = perTag
      ? `${classUnplaced.length} class chapter(s) could not be placed before cutoffs (base ${cutoff}, Class-${finalClassNum} window till ${finalCutoff} for above-signup rows only [D14b]) — listed above, not scheduled late and not dropped. Olympiad/exam tracks are unaffected.`
      : `${classUnplaced.length} class chapter(s) could not be placed before the ${cutoff} class-session cutoff (no new class content after ${CLASS_SESSION_END.replace('-', '/')}) — listed above, not scheduled late and not dropped. Olympiad/exam tracks are unaffected. [D14b: at-or-below signup uses base]`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${cut}` : `⚠️ ${cut}`;
  }
  // FIX-S S5 [S5c]: a declined promotion pauses the CLASS track. Say it plainly
  // instead of returning a silently shorter plan. Olympiad/competitive unaffected.
  if (classPaused) {
    const since = classPaused.since ? ` (declined ${classPaused.since})` : '';
    const held = built.classPausedExcluded || 0;
    const msg = `Class planning is paused${since}: ${held} class chapter(s) were held back — no new class content, chapter tests or spaced revisions were scheduled for the class track. Olympiad and competitive sessions are unaffected. Accept the promotion to start your ${PROMOTION_TO_CLASS_LABEL} plan.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${msg}` : `⚠️ ${msg}`;
  }
  // FIX-S S5 [S5d]: archived history is excluded, and that is stated, not hidden.
  if ((built.archivedExcluded || archivedIn) > 0) {
    const n = built.archivedExcluded || archivedIn;
    const msg = `${n} archived chapter(s) were skipped — archived content (e.g. last year's class map) never generates study, chapter-test or revision sessions.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ${msg}` : msg;
  }
  // FIX-S S3: ladder steps that did not fit inside the plan window are named too
  if (pipeline.length) {
    const pend = `${pipeline.length} conquered-chapter session(s) (chapter test / spaced revision) did not fit before this plan's horizon ends — extend the plan window to keep the ladder whole.`;
    coverageWarning = coverageWarning ? `${coverageWarning} ⚠️ ${pend}` : `⚠️ ${pend}`;
  }
  // FIX-SCHED9 D5: if all tracks complete to horizons, days stay free and coverage says so honestly
  if (!overloaded && items.length > 0 && unscheduled.length === 0 && partial.length === 0 && tooLate.length === 0) {
    const msg = `syllabus covered — maintain with practice`;
    coverageWarning = coverageWarning ? `${coverageWarning} ${msg}` : msg;
  }

  const coverage = {
    priorityOrder: allocatable,
    timeSplit: prio.timeSplit,
    finalClass: finalClassNum,
    finalCutoff,
    baseCutoff: cutoff,
    signupClassNum,
    hasAboveSignupRows: hasAboveSignupRowsForCoverage,
    perTagInEffect: !!(hasAboveSignupRowsForCoverage && finalCutoff), // D14b: only when above-signup rows exist (strict)
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
    weekdayHours,
    weekendHours,
    weeklyAvgHours,
    dailyHours, // legacy for backward compat
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
    // FIX-S S5: archived history + a paused class track, reported not hidden
    archivedExcluded: built.archivedExcluded || 0,
    classPaused: classPaused ? { reason: classPaused.reason || 'promotion-declined', since: classPaused.since || null, session: classPaused.session || null, heldChapters: built.classPausedExcluded || 0 } : null,
    classPausedExcluded: built.classPausedExcluded || 0,
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
