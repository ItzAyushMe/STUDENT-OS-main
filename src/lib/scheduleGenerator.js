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
import { SESSION_TYPES, TRACK_PRIORITY } from '../config/constants';
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
      completedItems.push({ id: row.id, chapter, reason: 'completed' });
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

  // existing entries: their minutes occupy the day, their slots are never re-emitted
  const existingKeys = new Set();
  const loadByDate = {};
  for (const r of existingRows) {
    const k = dedupeKey(r);
    if (k) existingKeys.add(k);
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
    const isMockDay =
      !schoolExamToday &&
      ((weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 70 : olympiadDate != null)) ||
        dayBeforeSchoolExam ||
        (olympiadDate && dateStr(dayjs(olympiadDate).subtract(2, 'day')) === date));
    const classProtected = protectedDates.has(date);

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
    const placeStudy = (track, quota, allowTail) => {
      const q = queues[track];
      if (!q || !q.length) return 'none';
      if (track === 'class' && classProtected) { protectedBlocksSkipped += 1; return 'none'; }
      sortQueue(track);
      const it = q[0];
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
        q.shift();
        finishedTopics += 1;
        // every 2nd finished topic gets a timed-practice block
        if (finishedTopics % 2 === 0 && capacity >= 35) {
          push(it.subject, `Timed practice: 10 Qs in 25 min (${it.chapter})`, 'practice', 30, track);
        }
      }
      return 'ok';
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

    // School exam DAY itself — light revision only, no new topics
    if (schoolExamToday) {
      const exam = exams.find((e) => date >= e.start && date <= e.end);
      push('School Exam', `${(exam && exam.label) || 'Exam'} — quick recall + formula scan`, 'revision', Math.min(EXAM_DAY_REVISION_MIN, capacity), 'class');
      continue;
    }

    // Mock day: full-length timed test + analysis
    if (isMockDay) {
      const mockLabel = dayBeforeSchoolExam ? 'Pre-school-exam mock' : 'Full-length mock';
      push('Mock Test', `${mockLabel} + analysis`, 'mock', Math.min(MOCK_MIN, capacity), 'class', 'high');
      if (capacity >= 30) push('Analysis', 'Review mock mistakes + weak chapters', 'revision', Math.min(MOCK_ANALYSIS_MIN, capacity), 'class');
      continue;
    }

    // Revision wave before school exams: no NEW topics, revise the done ones
    if (inSchoolExamRev && studied.some((s) => s.track === 'class')) {
      const classTopics = studied.filter((s) => s.track === 'class');
      const recent = classTopics.slice(-REV_WAVE_PICKS);
      const subj = recent[d % recent.length];
      push(subj.subject, `Revision wave: ${subj.chapter}`, 'revision', Math.min(MAX_BLOCK_MIN, capacity), 'class');
      if (capacity >= 45) {
        const p = recent[(d + 1) % recent.length];
        push(p.subject, `Timed practice: 10 Qs in 25 min (${p.chapter})`, 'practice', Math.min(35, capacity), 'class');
      }
      continue;
    }

    // Main-exam buffer days
    if (examDate != null && daysToExam != null && daysToExam <= Math.max(3, Math.round(totalDays * 0.12)) && daysToExam > 0) {
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

    // Phase 1c: spend each track's allocation on its most urgent chapter
    for (const track of allocatable) {
      const q = queues[track];
      if (!q || !q.length) { leftover[track] = 0; continue; }
      const quota = num(alloc[track], 0);
      if (quota < MIN_BLOCK_MIN) {
        // too small for a real block today — bank it rather than inflate it
        leftover[track] = isDayOff ? 0 : Math.min(LEFTOVER_CAP_MIN, quota);
        continue;
      }
      let spent = 0;
      while (capacity >= MIN_BLOCK_MIN && spent < quota && blocks < MAX_BLOCKS_PER_DAY && dupGuard <= MAX_BLOCKS_PER_DAY) {
        const before = capacity;
        const res = placeStudy(track, Math.min(quota - spent, capacity), false);
        if (res === 'none') break;
        if (res === 'dup') { dupGuard += 1; spent += MIN_BLOCK_MIN; if (capacity === before) continue; }
        spent += before - capacity;
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
        push(subj, `Revision: ${chapters}`, 'revision', Math.min(40, capacity), lastTrack);
      }
    }

    // short quiz slot when there's leftover time
    if (capacity >= 20 && studied.length) {
      const last = studied[studied.length - 1];
      push(last.subject, `Quick quiz: ${last.chapter}`, 'quiz', Math.min(20, capacity), last.track);
    }

    // Phase 2 — minutes that no track claimed flow to the most at-risk REAL work.
    // A track that has work keeps its declared share; only unclaimed time moves.
    while (freePool > 0 && capacity >= MIN_BLOCK_MIN && blocks < MAX_BLOCKS_PER_DAY && dupGuard <= MAX_BLOCKS_PER_DAY) {
      for (const t of allocatable) sortQueue(t);
      const cands = allocatable.filter((t) => (queues[t] || []).length && !(t === 'class' && classProtected));
      if (!cands.length) break;
      cands.sort((a, b) => compareUrgency(queues[a][0], queues[b][0], ctx));
      const before = capacity;
      const res = placeStudy(cands[0], capacity, true);
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

  const requiredMinutes = items.reduce((a, it) => a + it.plannedMinutes + it.remainingMinutes, 0);
  const plannedMinutes = items.reduce((a, it) => a + it.plannedMinutes, 0);
  const totalRequiredHours = Math.round(requiredMinutes / 60);
  const totalAvailableHours = Math.round(totalDays * dailyHours);
  const requiredPerDay = totalDays > 0 ? round1(requiredMinutes / 60 / totalDays) : 0;
  const overdueCount = items.filter((it) => it.overdue).length;
  const overloaded = unscheduled.length > 0 || partial.length > 0 || tooLate.length > 0 || requiredPerDay > dailyHours;
  const shortfallHours = Math.max(0, round1((requiredMinutes - plannedMinutes) / 60));

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
    completedExcluded: built.completedExcluded,
    completedItems: built.completedItems,
    excludedItems: built.excludedItems,
    existingCount: existingRows.length,
    duplicatesSuppressed,
    protectedBlocksSkipped,
    noCapacity,
    reasons,
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
