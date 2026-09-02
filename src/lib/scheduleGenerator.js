// ============================================================
// StudentOS — Smart Schedule engine (deterministic, offline-first)
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
import { minutesToTime, todayStr, dateStr } from './utils';

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

// ---------- the main planner ----------
// opts: {
//   syllabus, examDate, olympiadDate,
//   schoolExams: [{label, date}] | [{label, start_date, end_date, exact}],
//   priorities: { order, enabled, timeSplit }  (student's own — FIX B),
//   dailyHours, preferredTime, daysOff[], prepLevel, weeks?, userId
// }
export function generateSchedule(opts) {
  const {
    syllabus = [],
    examDate = null,
    olympiadDate = null,
    schoolExams = [],
    priorities = null,
    dailyHours = 3,
    preferredTime = '',
    daysOff = [],
    prepLevel = '',
    weeks = 6,
    userId,
  } = opts;

  const today = todayStr();
  const examLimit = examDate ? dayjs(examDate) : null;
  const rollingLimit = dayjs(today).add(weeks * 7, 'day');
  const horizon =
    examLimit && examLimit.isBefore(rollingLimit) ? examLimit : rollingLimit;
  const totalDays = Math.max(1, horizon.diff(dayjs(today), 'day'));

  const factor = difficultyFactor(prepLevel);
  const startM = startMinutesFor(preferredTime);
  const dailyCapacityMin = Math.max(30, Math.round(dailyHours * 60));

  const exams = allSchoolExams(schoolExams);
  // every day inside an exam RANGE (or the exact day) is an exam day
  const schoolExamDates = new Set();
  for (const e of exams) {
    const days = dayjs(e.end).diff(dayjs(e.start), 'day');
    for (let i = 0; i <= Math.min(days, 30); i++) schoolExamDates.add(dateStr(dayjs(e.start).add(i, 'day')));
  }

  // STUDENT-CONFIGURED PRIORITIES (FIX B): order + weekly time split.
  // Default: class → exam → olympiad. Disabled tracks are skipped.
  const prio = normalizePriorities(priorities);
  const activeOrder = prio.order; // only enabled tracks

  // PRIORITY QUEUE in the student's chosen order.
  // Within a track: weightage desc, deadline asc.
  const trackSorted = (rows) =>
    rows.sort((a, b) => {
      const w = (b.weightage || 3) - (a.weightage || 3);
      if (w !== 0) return w;
      return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
    });
  const pendingByTrack = {};
  for (const t of activeOrder) pendingByTrack[t] = [];
  for (const r of syllabus) {
    if (r.status === 'completed') continue;
    const t = trackOfRow(r, prio);
    (pendingByTrack[t] || pendingByTrack[rowTrack(r)] || (pendingByTrack[t] = [])).push(r);
  }
  // one queue per track; we pull from each in priority order each day
  const queues = {};
  const trackStart = {};
  for (const t of activeOrder) {
    queues[t] = trackSorted(pendingByTrack[t]);
    trackStart[t] = 0;
  }

  // per-track daily time budget from the student's split (minutes).
  // Unused budget rolls over to the NEXT track that same day.
  const trackBudget = (isDayOff) => {
    const cap = isDayOff ? Math.min(60, dailyCapacityMin) : dailyCapacityMin;
    const budgets = {};
    for (const t of activeOrder) budgets[t] = Math.round((cap * (Number(prio.timeSplit[t]) || 0)) / 100);
    return budgets;
  };

  const out = [];
  const studied = []; // {subject, chapter, date, track} for revision cycles
  let blockCount = 0;
  // Small splits (5–15% of a day) are below the 30-min minimum block.
  // Instead of inflating them, their budget accumulates day to day so the
  // track still gets a viable block every few days — split stays honest.
  const leftoverBudget = {};
  for (const t of activeOrder) leftoverBudget[t] = 0;
  const covered = {}; for (const t of activeOrder) covered[t] = 0;

  for (let d = 0; d < totalDays; d++) {
    const date = dateStr(dayjs(today).add(d, 'day'));
    const weekday = (dayjs(date).day() + 6) % 7; // 0=Mon
    const isDayOff = daysOff.includes(weekday);
    const daysToExam = examDate ? dayjs(examDate).diff(dayjs(date), 'day') : null;
    const schoolExamToday = schoolExamDates.has(date);
    const dayBeforeSchoolExam = exams.some((e) => dateStr(dayjs(e.start).subtract(1, 'day')) === date);
    // revision wave: 14 days before each school exam RANGE START
    const inSchoolExamRev = exams.some((e) => {
      const diff = dayjs(e.start).diff(dayjs(date), 'day');
      return diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS;
    });
    const isMockDay =
      !schoolExamToday &&
      ((weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 70 : olympiadDate != null)) ||
        dayBeforeSchoolExam ||
        (olympiadDate && dateStr(dayjs(olympiadDate).subtract(2, 'day')) === date));

    let cursor = startM;
    let remaining = isDayOff ? Math.min(60, dailyCapacityMin) : dailyCapacityMin;

    const push = (subject, topic, type, minutes, track) => {
      minutes = Math.min(minutes, remaining);
      if (minutes < 15) return;
      out.push({
        user_id: userId,
        date,
        start_time: minutesToTime(cursor),
        end_time: minutesToTime(cursor + minutes),
        subject,
        topic,
        session_type: type,
        track: track || 'class',
        status: 'pending',
        duration_minutes: minutes,
        priority: type === 'mock' ? 'high' : 'normal',
        created_at: new Date().toISOString(),
      });
      cursor += minutes + 5; // 5-min breather between blocks
      remaining -= minutes + 5;
    };

    // School exam DAY itself — light revision only, no new topics
    if (schoolExamToday) {
      // M-7 (audit): normalized school exams have start/end ranges, not .date —
      // matching by date never hit, so the label was always generic.
      const exam = exams.find((e) => date >= e.start && date <= e.end);
      push('School Exam', `${exam?.label || 'Exam'} — quick recall + formula scan`, 'revision', Math.min(45, remaining));
      continue;
    }

    // Mock day: full-length timed test + analysis
    if (isMockDay) {
      const mockLabel = dayBeforeSchoolExam ? 'Pre-school-exam mock' : 'Full-length mock';
      push('Mock Test', `${mockLabel} + analysis`, 'mock', Math.min(120, remaining), 'class');
      const rest = Math.max(0, remaining);
      if (rest >= 30) push('Analysis', 'Review mock mistakes + weak chapters', 'revision', Math.min(60, rest), 'class');
      continue;
    }

    // Revision wave before school exams: no NEW class topics, revise done ones
    if (inSchoolExamRev && studied.length) {
      const classTopics = studied.filter((s) => s.track === 'class');
      if (classTopics.length) {
        const recent = classTopics.slice(-6);
        const subj = recent[d % recent.length];
        push(subj.subject, `Revision wave: ${subj.chapter}`, 'revision', Math.min(50, remaining), 'class');
        // timed practice against the clock
        if (remaining >= 45) {
          const p = recent[(d + 1) % recent.length];
          push(p.subject, `Timed practice: 10 Qs in 25 min (${p.chapter})`, 'practice', Math.min(35, remaining), 'class');
        }
        continue;
      }
    }

    // Main-exam buffer days
    if (examDate != null && daysToExam != null && daysToExam <= Math.max(3, Math.round(totalDays * 0.12)) && daysToExam > 0) {
      push('Buffer', 'Backlog / weak topics cleanup', 'revision', Math.min(90, remaining), 'class');
      continue;
    }

    // ---- normal study day ----
    // 1) tracks in the STUDENT'S priority order, each with its own
    //    time budget (timeSplit). Unused budget rolls to the next track.
    const budgets = trackBudget(isDayOff);
    for (const track of activeOrder) {
      let budget = (budgets[track] || 0) + (leftoverBudget[track] || 0);
      // school-exam guard: near a school exam the class track may exceed
      // its split — class work cannot be postponed past the exam
      const classUrgent =
        track === 'class' &&
        exams.some((e) => {
          const diff = dayjs(e.start).diff(dayjs(date), 'day');
          return diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS + 7;
        });
      if (budget > 0 && budget < 30) {
        // not enough for a viable block today — save it up for tomorrow
        leftoverBudget[track] = isDayOff ? 0 : Math.min(90, budget);
        continue;
      }
      while (remaining >= 30 && (budget >= 30 || (classUrgent && remaining >= 30))) {
        const q = queues[track];
        const idx = trackStart[track];
        if (idx >= q.length) break; // this track is done — budget rolls over
        const t = q[idx];
        const needMin = Math.round((t.estimated_hours || 4) * 60 * factor);
        const block = Math.min(50, remaining, Math.max(30, needMin), Math.max(30, budget));
        push(t.subject, t.chapter, 'study', block, track);
        studied.push({ subject: t.subject, chapter: t.chapter, date, track });
        blockCount += 1;
        budget -= block + 5;
        if (block >= Math.min(50, needMin)) {
          trackStart[track] = idx + 1;
          covered[track] = (covered[track] || 0) + 1;
          // every 2nd finished topic gets a timed-practice block
          if (blockCount % 2 === 0 && remaining >= 35) {
            push(t.subject, `Timed practice: 10 Qs in 25 min (${t.chapter})`, 'practice', 30, track);
            budget -= 35;
          }
        }
        if (!classUrgent && budget < 30) break;
      }
      leftoverBudget[track] = isDayOff ? 0 : Math.min(90, Math.max(0, budget));
    }

    // 2) revision cycle every 3rd day (revisit last 2 days' topics)
    if (d % 3 === 2 && studied.length && remaining >= 20) {
      const recent = studied.slice(-4);
      const bySubject = {};
      for (const s of recent) bySubject[s.subject] = bySubject[s.subject] || new Set();
      for (const s of recent) bySubject[s.subject].add(s.chapter);
      const subjects = Object.keys(bySubject);
      if (subjects.length) {
        const subj = subjects[d % subjects.length];
        const chapters = [...bySubject[subj]].slice(0, 2).join(', ');
        const lastTrack = recent.length ? recent[recent.length - 1].track : 'class';
        push(subj, `Revision: ${chapters}`, 'revision', Math.min(40, remaining), lastTrack);
      }
    }

    // 3) short quiz slot when there's leftover time
    if (remaining >= 20 && studied.length) {
      const last = studied[studied.length - 1];
      push(last.subject, `Quick quiz: ${last.chapter}`, 'quiz', Math.min(20, remaining), last.track);
    }
  }

  // Track coverage summary — powers the priority banner in the UI
  const nextSchool = nextSchoolExamOnOrAfter(exams, today);
  const coverage = {
    priorityOrder: activeOrder,
    timeSplit: prio.timeSplit,
    classTotal: (pendingByTrack.class || []).length,
    classPlanned: covered.class || 0,
    olympiadTotal: (pendingByTrack.olympiad || []).length,
    olympiadPlanned: covered.olympiad || 0,
    examTotal: (pendingByTrack.exam || []).length,
    examPlanned: covered.exam || 0,
    custom: Object.entries(pendingByTrack)
      .filter(([t]) => t.startsWith('custom:'))
      .map(([t, rows]) => ({ id: t, name: prio.custom?.[t]?.name || t, total: rows.length, planned: covered[t] || 0 })),
    nextSchoolExam: nextSchool,
    classDoneBy: nextSchool ? dateStr(dayjs(nextSchool.start).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day')) : null,
  };
  out.coverage = coverage;
  return out;
}

// ---------- adaptive rescheduling (offline heuristic / catch-up) ----------
// Moves missed/overdue pending sessions to upcoming days, keeping
// the daily load balanced. Class-track sessions jump the queue —
// they move FIRST (school can't wait; the exam track can).
export function autoRescheduleMissed(scheduleRows, { dailyHours = 3 } = {}) {
  const today = todayStr();
  const missed = scheduleRows
    .filter((r) => r.status === 'pending' && r.date < today)
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
    // find next day with room
    for (let i = 0; i < 21; i++) {
      const dstr = dateStr(day.add(i, 'day'));
      if ((loadByDate[dstr] || 0) + (m.duration_minutes || 30) <= cap) {
        loadByDate[dstr] = (loadByDate[dstr] || 0) + (m.duration_minutes || 30);
        moved.push({ ...m, date: dstr, status: 'pending' });
        break;
      }
    }
  }
  return { moved, kept: missed.filter((m) => !moved.find((x) => x.id === m.id)) };
}
