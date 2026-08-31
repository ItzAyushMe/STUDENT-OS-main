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

// Nearest upcoming school exam on/after a date (YYYY-MM-DD or null)
function nextSchoolExamOnOrAfter(schoolExams = [], date) {
  const valid = (schoolExams || [])
    .map((e) => ({ label: e.label || 'School exam', date: typeof e.date === 'string' ? e.date : dateStr(dayjs(e.date)) }))
    .filter((e) => e.date && !dayjs(e.date).isBefore(dayjs(date), 'day'));
  if (!valid.length) return null;
  valid.sort((a, b) => a.date.localeCompare(b.date));
  return valid[0];
}

function allSchoolExams(schoolExams = []) {
  return (schoolExams || [])
    .map((e) => ({ label: e.label || 'School exam', date: typeof e.date === 'string' ? e.date : dateStr(dayjs(e.date)) }))
    .filter((e) => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- deadlines: track-aware, school-exam aware ----------
// class rows -> 14 days before nearest school exam (else exam date)
// olympiad rows -> olympiad date (else exam date)
// exam rows -> exam date
export function autoSetDeadlines(syllabusRows, examDate, dailyHours = 3, schoolExams = []) {
  if (!syllabusRows?.length) return {};
  const today = todayStr();
  const exams = allSchoolExams(schoolExams);
  const nextSchool = nextSchoolExamOnOrAfter(exams, today);

  const out = {};
  for (const row of syllabusRows) {
    const track = rowTrack(row);
    let target = examDate || null;
    if (track === 'class' && nextSchool) {
      target = dateStr(dayjs(nextSchool.date).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day'));
    } else if (track === 'olympiad' && row.olympiad_date) {
      target = row.olympiad_date;
    }
    out[row.id] = target;
  }
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
      ? dateStr(dayjs(nextSchool.date).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day'))
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
//   schoolExams: [{label, date}],
//   dailyHours, preferredTime, daysOff[], prepLevel, weeks?, userId
// }
export function generateSchedule(opts) {
  const {
    syllabus = [],
    examDate = null,
    olympiadDate = null,
    schoolExams = [],
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
  const schoolExamDates = new Set(exams.map((e) => e.date));

  // PRIORITY QUEUE: class -> olympiad -> exam (the core rule).
  // Within a track: weightage desc, deadline asc.
  const trackSorted = (rows) =>
    rows.sort((a, b) => {
      const w = (b.weightage || 3) - (a.weightage || 3);
      if (w !== 0) return w;
      return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
    });
  const pendingByTrack = { class: [], olympiad: [], exam: [] };
  for (const r of syllabus) {
    if (r.status === 'completed') continue;
    pendingByTrack[rowTrack(r)].push(r);
  }
  const queue = [
    ...trackSorted(pendingByTrack.class),
    ...trackSorted(pendingByTrack.olympiad),
    ...trackSorted(pendingByTrack.exam),
  ];
  // position in the queue where each track starts (for track-of-the-day logic)
  const classEnd = pendingByTrack.class.length;
  const olympiadEnd = classEnd + pendingByTrack.olympiad.length;

  const out = [];
  const studied = []; // {subject, chapter, date, track} for revision cycles
  let topicIdx = 0;
  let blockCount = 0;

  for (let d = 0; d < totalDays; d++) {
    const date = dateStr(dayjs(today).add(d, 'day'));
    const weekday = (dayjs(date).day() + 6) % 7; // 0=Mon
    const isDayOff = daysOff.includes(weekday);
    const daysToExam = examDate ? dayjs(examDate).diff(dayjs(date), 'day') : null;
    const schoolExamToday = schoolExamDates.has(date);
    const dayBeforeSchoolExam = exams.some((e) => dateStr(dayjs(e.date).subtract(1, 'day')) === date);
    // revision wave: 14 days before each school exam
    const inSchoolExamRev = exams.some((e) => {
      const diff = dayjs(e.date).diff(dayjs(date), 'day');
      return diff > 0 && diff <= SCHOOL_EXAM_BUFFER_DAYS;
    });
    const isMockDay =
      !schoolExamToday &&
      ((weekday === 6 && (examDate != null ? daysToExam > 0 && daysToExam <= 70 : olympiadDate != null)) ||
        dayBeforeSchoolExam ||
        (olympiadDate && dateStr(dayjs(olympiadDate).subtract(2, 'day')) === date));
    const isBufferDay = false; // main-exam buffer handled in the day loop below
    void isBufferDay;

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
      const exam = exams.find((e) => e.date === date);
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
    // 1) the priority queue (class → olympiad → exam)
    while (remaining >= 30 && topicIdx < queue.length) {
      const t = queue[topicIdx];
      const needMin = Math.round((t.estimated_hours || 4) * 60 * factor);
      const block = Math.min(50, remaining, Math.max(30, needMin));
      push(t.subject, t.chapter, 'study', block, rowTrack(t));
      studied.push({ subject: t.subject, chapter: t.chapter, date, track: rowTrack(t) });
      blockCount += 1;
      if (block >= Math.min(50, needMin)) {
        topicIdx += 1;
        // every 2nd finished topic gets a timed-practice block
        if (blockCount % 2 === 0 && remaining >= 35) {
          push(t.subject, `Timed practice: 10 Qs in 25 min (${t.chapter})`, 'practice', 30, rowTrack(t));
        }
      }
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

  // Track coverage summary — powers the "class first ✅" banner in the UI
  const coverage = {
    classTotal: pendingByTrack.class.length,
    classPlanned: Math.min(topicIdx, classEnd),
    olympiadTotal: pendingByTrack.olympiad.length,
    olympiadPlanned: Math.max(0, Math.min(topicIdx, olympiadEnd) - classEnd),
    examTotal: pendingByTrack.exam.length,
    examPlanned: Math.max(0, topicIdx - olympiadEnd),
    nextSchoolExam: nextSchoolExamOnOrAfter(exams, today),
    classDoneBy: nextSchoolExamOnOrAfter(exams, today)
      ? dateStr(dayjs(nextSchoolExamOnOrAfter(exams, today).date).subtract(SCHOOL_EXAM_BUFFER_DAYS, 'day'))
      : null,
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
