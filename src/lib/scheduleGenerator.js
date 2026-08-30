// ============================================================
// StudentOS — Smart Schedule engine (deterministic, offline-first)
// Builds a day-by-day plan from syllabus + weightage + hours +
// available time + days off + exam date, with revision cycles,
// mock days and buffer days. Layer 4 adds an AI-enhanced version
// on top of this same shape (see aiEnhanceSchedule).
// ============================================================
import dayjs from 'dayjs';
import { SESSION_TYPES } from '../config/constants';
import { minutesToTime, todayStr, dateStr } from './utils';

const PREFERRED_START = {
  early: 5 * 60,
  morning: 8 * 60,
  afternoon: 13 * 60,
  evening: 16 * 60,
  night: 19 * 60,
  late: 22 * 60,
};

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

// ---------- deadlines: distribute chapters before the exam ----------
export function autoSetDeadlines(syllabusRows, examDate, dailyHours = 3) {
  if (!examDate || !syllabusRows?.length) return {};
  const today = todayStr();
  const totalDays = Math.max(1, dayjs(examDate).diff(dayjs(today), 'day'));
  const capacityHours = totalDays * Math.max(0.5, dailyHours) * 0.85; // 15% buffer
  const pending = syllabusRows.filter((r) => r.status !== 'completed');
  const totalHours = pending.reduce((a, r) => a + (r.estimated_hours || 4), 0) || 1;

  // Higher weightage + higher estimated hours -> earlier deadline
  const sorted = [...pending].sort((a, b) => {
    const wa = (b.weightage || 3) - (a.weightage || 3);
    if (wa !== 0) return wa;
    return (a.estimated_hours || 4) - (b.estimated_hours || 4);
  });

  let consumed = 0;
  const deadlines = {};
  for (const row of sorted) {
    consumed += (row.estimated_hours || 4) / totalHours;
    const dayOffset = Math.min(totalDays - 1, Math.max(0, Math.round(consumed * capacityHours / Math.max(0.5, dailyHours))));
    deadlines[row.id] = dateStr(dayjs(today).add(dayOffset, 'day'));
  }
  return deadlines;
}

// ---------- the main planner ----------
// opts: { syllabus, examDate, dailyHours, preferredTime, daysOff[], prepLevel, weeks?, userId }
export function generateSchedule(opts) {
  const {
    syllabus = [],
    examDate = null,
    dailyHours = 3,
    preferredTime = '',
    daysOff = [],
    prepLevel = '',
    weeks = 6,
    userId,
  } = opts;

  const today = todayStr();
  const horizon = examDate
    ? dayjs.min(dayjs(examDate), dayjs(today).add(weeks * 7, 'day'))
    : dayjs(today).add(weeks * 7, 'day');
  const totalDays = Math.max(1, horizon.diff(dayjs(today), 'day'));

  const factor = difficultyFactor(prepLevel);
  const startM = startMinutesFor(preferredTime);
  const dailyCapacityMin = Math.max(30, Math.round(dailyHours * 60));

  // topics to plan (not completed), priority: weightage desc, then deadline asc
  const pending = syllabus
    .filter((r) => r.status !== 'completed')
    .sort((a, b) => {
      const w = (b.weightage || 3) - (a.weightage || 3);
      if (w !== 0) return w;
      return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
    });

  const out = [];
  const studied = []; // {subject, chapter, date} for revision cycles
  let topicIdx = 0;

  for (let d = 0; d < totalDays; d++) {
    const date = dateStr(dayjs(today).add(d, 'day'));
    const weekday = (dayjs(date).day() + 6) % 7; // 0=Mon
    const isDayOff = daysOff.includes(weekday);
    const daysToExam = examDate ? dayjs(examDate).diff(dayjs(date), 'day') : null;
    const isMockDay = weekday === 6 && examDate != null && daysToExam > 0 && daysToExam <= 70; // Sunday
    const isBufferDay = examDate != null && daysToExam != null && daysToExam <= Math.max(3, Math.round(totalDays * 0.12)) && daysToExam > 0;

    let cursor = startM;
    let remaining = isDayOff ? Math.min(60, dailyCapacityMin) : dailyCapacityMin;

    const push = (subject, topic, type, minutes) => {
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
        status: 'pending',
        duration_minutes: minutes,
        priority: type === 'mock' ? 'high' : 'normal',
        created_at: new Date().toISOString(),
      });
      cursor += minutes + 5; // 5-min breather between blocks
      remaining -= minutes + 5;
    };

    if (isBufferDay) {
      push('Buffer', 'Backlog / weak topics cleanup', 'revision', Math.min(90, remaining));
      continue;
    }

    if (isMockDay) {
      push('Mock Test', 'Full-length mock + analysis', 'mock', Math.min(120, remaining));
      const rest = Math.min(60, Math.max(0, remaining));
      if (rest >= 30) push('Analysis', 'Review mock mistakes', 'revision', rest);
      continue;
    }

    // study blocks
    while (remaining >= 30 && topicIdx < pending.length) {
      const t = pending[topicIdx];
      const needMin = Math.round((t.estimated_hours || 4) * 60 * factor);
      const block = Math.min(50, remaining, Math.max(30, needMin));
      push(t.subject, t.chapter, 'study', block);
      studied.push({ subject: t.subject, chapter: t.chapter, date });
      if (block >= Math.min(50, needMin)) {
        topicIdx++;
      }
    }

    // revision cycle every 3rd day (revisit last 2 days' topics)
    if (d % 3 === 2 && studied.length && remaining >= 20) {
      const recent = studied.slice(-4);
      const bySubject = {};
      for (const s of recent) bySubject[s.subject] = bySubject[s.subject] || new Set();
      for (const s of recent) bySubject[s.subject].add(s.chapter);
      const subjects = Object.keys(bySubject);
      if (subjects.length) {
        const subj = subjects[d % subjects.length];
        const chapters = [...bySubject[subj]].slice(0, 2).join(', ');
        push(subj, `Revision: ${chapters}`, 'revision', Math.min(40, remaining));
      }
    }

    // short quiz slot when there's leftover time
    if (remaining >= 20 && studied.length) {
      const last = studied[studied.length - 1];
      push(last.subject, `Quick quiz: ${last.chapter}`, 'quiz', Math.min(20, remaining));
    }
  }

  return out;
}

// ---------- adaptive rescheduling (offline heuristic) ----------
// Moves missed/overdue pending sessions to upcoming days, keeping
// the daily load balanced. Returns the moved rows (already updated).
export function autoRescheduleMissed(scheduleRows, { dailyHours = 3 } = {}) {
  const today = todayStr();
  const missed = scheduleRows.filter((r) => r.status === 'pending' && r.date < today);
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
