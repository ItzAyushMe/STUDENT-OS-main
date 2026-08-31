import assert from 'node:assert';
import { levelForXp, tierForXp, levelProgress, streakOnActivity, xpForCode } from './../src/lib/xpService.js';
import { generateSchedule, autoSetDeadlines, autoRescheduleMissed } from './../src/lib/scheduleGenerator.js';
import { pickDailyArena, pickBankQuiz, QUIZ_BANK } from './../src/lib/quizBank.js';
import { uuid, mondayOf, daysBetween, seededShuffle, hashString, todayStr } from './../src/lib/utils.js';
import { XP_RULES, TIERS } from './../src/config/constants.js';

// ---- utils ----
assert.ok(uuid().length >= 30, 'uuid');
assert.equal(daysBetween('2026-01-01', '2026-01-10'), 9, 'daysBetween');
assert.equal(mondayOf('2026-08-30').format('YYYY-MM-DD'), '2026-08-24', 'mondayOf (Sunday back to Monday)'); // 2026-08-30 is a Sunday
const s1 = seededShuffle([1,2,3,4,5,6,7], 'seed');
const s2 = seededShuffle([1,2,3,4,5,6,7], 'seed');
assert.deepEqual(s1, s2, 'seededShuffle deterministic');

// ---- xp ----
assert.equal(levelForXp(0), 1, 'level 0 xp = 1');
assert.equal(levelForXp(99), 1, 'level 99 xp = 1');
assert.equal(levelForXp(100), 2, 'level 100 xp = 2');
assert.equal(xpForCode('STUDY_QUEST').amount, 30, 'quest xp 30');
assert.equal(tierForXp(0).name, 'Bronze');
assert.equal(tierForXp(4999).name, 'Bronze');
assert.equal(tierForXp(5000).name, 'Silver');
assert.equal(tierForXp(60000).name, 'Master');
assert.equal(tierForXp(150000).name, 'Grandmaster');
assert.equal(TIERS.length, 7, 'seven tiers');
assert.ok(Math.abs(levelProgress(150).pct - 0.5) < 1e-9, 'level progress');

// ---- streaks ----
const today = todayStr();
const yest = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
let st = streakOnActivity({ current_streak: 3, longest_streak: 3, streak_freezes: 1, last_active_date: yest(1) });
assert.equal(st.current, 4, 'streak continues next day');
assert.equal(st.freezeUsed, false);
st = streakOnActivity({ current_streak: 3, longest_streak: 3, streak_freezes: 1, last_active_date: yest(2) });
assert.equal(st.freezeUsed, true, 'freeze used for 1 missed day');
assert.equal(st.current, 4, 'streak saved by freeze');
st = streakOnActivity({ current_streak: 3, longest_streak: 3, streak_freezes: 0, last_active_date: yest(2) });
assert.equal(st.current, 1, 'streak resets without freeze');
st = streakOnActivity({ current_streak: 3, longest_streak: 3, streak_freezes: 0, last_active_date: today });
assert.equal(st.current, 3, 'same-day activity keeps streak');
st = streakOnActivity({ current_streak: 6, longest_streak: 6, streak_freezes: 0, last_active_date: yest(1) });
assert.equal(st.freezes, 1, 'freeze earned every 7 days');
assert.equal(st.freezeEarned, true);

// ---- schedule generator ----
const syllabus = [
  { id: 't1', subject: 'Physics', chapter: 'Kinematics', weightage: 4, estimated_hours: 10, status: 'locked' },
  { id: 't2', subject: 'Physics', chapter: 'Laws of Motion', weightage: 4, estimated_hours: 10, status: 'locked' },
  { id: 't3', subject: 'Maths', chapter: 'Trigonometry', weightage: 5, estimated_hours: 10, status: 'locked' },
  { id: 't4', subject: 'Chem', chapter: 'Bonding', weightage: 5, estimated_hours: 10, status: 'completed' },
];
const rows = generateSchedule({
  syllabus, examDate: null, dailyHours: 3, preferredTime: 'Evening (4–7 PM)', daysOff: [5], prepLevel: 'Intermediate', weeks: 2, userId: 'u1',
});
assert.ok(rows.length > 3, 'schedule has rows: ' + rows.length);
assert.ok(rows.every(r => r.user_id === 'u1'), 'userId set');
assert.ok(rows.every(r => r.status === 'pending'), 'pending status');
assert.ok(!rows.some(r => ((new Date(r.date).getDay() + 6) % 7) === 5 && r.duration_minutes > 60), 'day off is light');
// times parse
assert.ok(rows.every(r => /^\d{2}:\d{2}$/.test(r.start_time) && /^\d{2}:\d{2}$/.test(r.end_time)), 'times formatted');

// with exam date: mock + buffer days
const rows2 = generateSchedule({
  syllabus, examDate: '2026-10-30', dailyHours: 3, preferredTime: 'Night', daysOff: [], prepLevel: 'Final revision mode', weeks: 8, userId: 'u1',
});
assert.ok(rows2.some(r => r.session_type === 'mock'), 'mock days present');
assert.ok(rows2.some(r => r.session_type === 'revision'), 'revision cycles present');

// deadlines
const dls = autoSetDeadlines(syllabus, '2026-10-30', 3);
assert.ok(dls.t1 && dls.t2 && dls.t3, 'deadlines set');
assert.ok(!dls.t4, 'completed topic has no deadline');
assert.ok(dls.t3 <= dls.t1, 'higher weightage earlier');

// reschedule
const sched = [
  { id: 'a', user_id: 'u1', date: yest(3), start_time: '18:00', duration_minutes: 45, status: 'pending', topic: 'X' },
  { id: 'b', user_id: 'u1', date: today, start_time: '18:00', duration_minutes: 45, status: 'pending', topic: 'Y' },
];
const { moved } = autoRescheduleMissed(sched, { dailyHours: 3 });
assert.equal(moved.length, 1, 'missed moved');
assert.ok(moved[0].date >= today, 'moved to future');

// ---- quiz bank ----
const a1 = pickDailyArena('2026-08-30');
const a2 = pickDailyArena('2026-08-30');
const a3 = pickDailyArena('2026-08-31');
assert.deepEqual(a1.map(q => q.q), a2.map(q => q.q), 'arena same day = same questions');
assert.notDeepEqual(a1.map(q => q.q), a3.map(q => q.q), 'arena different day = different questions');
assert.equal(a1.length, 5, 'arena 5 questions');
const q = pickBankQuiz({ subject: 'Physics', count: 5 });
assert.ok(q.length <= 5 && q.every(x => x.subject === 'Physics'), 'bank quiz subject filter');
assert.ok(QUIZ_BANK.length >= 55, 'bank size ' + QUIZ_BANK.length);
assert.ok(QUIZ_BANK.every(x => x.options[x.answer] != null && x.options.length >= 3), 'bank answers valid');

// ---- FIX 2: class-scoped syllabus (class ALWAYS wins over exam) ----
import { pickSyllabusSet, CLASS_SYLLABI, EXAM_SYLLABI, OLYMPIAD_SYLLABI } from './../src/data/syllabusData.js';

let set = pickSyllabusSet({ class_level: 'Class 10', board: 'CBSE', competitive_exam: 'JEE Main', olympiad: 'IOQM' });
assert.equal(set.class?.key, 'class10', 'Class 10 + JEE student gets the CLASS 10 syllabus (not Class 12 PCM!)');
assert.equal(set.exam?.key, 'jee', 'JEE track available as separate layer');
assert.equal(set.olympiad?.key, 'ioqm', 'IOQM track available as separate layer');
assert.ok(set.class.rows.length >= 20, 'class 10 syllabus is substantial: ' + set.class.rows.length);

set = pickSyllabusSet({ class_level: 'Class 6', competitive_exam: 'NEET' });
assert.equal(set.class?.key, 'class6', 'Class 6 student gets Class 6 syllabus even with NEET picked');

set = pickSyllabusSet({ class_level: 'Class 12', competitive_exam: 'JEE Advanced' });
assert.equal(set.class?.key, 'class12', 'Class 12 student gets Class 12 syllabus');

set = pickSyllabusSet({ class_level: 'Class 11', competitive_exam: 'NEET' });
assert.equal(set.class?.key, 'class11_12_pcb', 'Class 11 NEET aspirant gets PCB variant');

set = pickSyllabusSet({ class_level: 'Class 9', competitive_exam: 'None', olympiad: 'NSO (Science)' });
assert.equal(set.class?.key, 'class9', 'Class 9 default class syllabus');
assert.equal(set.olympiad?.key, 'nso', 'NSO olympiad track');
assert.equal(set.exam, null, 'no exam track when exam is None');

for (const cls of ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12', 'College']) {
  assert.ok(CLASS_SYLLABI[cls]?.rows.length >= 10, `${cls} syllabus exists with chapters`);
}
assert.ok(Object.keys(EXAM_SYLLABI).length >= 3, 'exam tracks exist');
assert.ok(Object.keys(OLYMPIAD_SYLLABI).length >= 4, 'olympiad tracks exist');

// ---- FIX 7: priority scheduler (class → olympiad → exam) ----
const multiTrackSyllabus = [
  { id: 'c1', subject: 'Science', chapter: 'Chemical Reactions', weightage: 4, estimated_hours: 6, status: 'locked', track: 'class' },
  { id: 'c2', subject: 'Maths', chapter: 'Trigonometry', weightage: 5, estimated_hours: 10, status: 'locked', track: 'class' },
  { id: 'o1', subject: 'Maths Olympiad', chapter: 'Number Theory', weightage: 5, estimated_hours: 12, status: 'locked', track: 'olympiad' },
  { id: 'e1', subject: 'Physics (JEE)', chapter: 'Rotational Dynamics', weightage: 5, estimated_hours: 14, status: 'locked', track: 'exam' },
];
const schoolExamDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const plan = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  schoolExams: [{ label: 'Mid-Term', date: schoolExamDate }],
  dailyHours: 4,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 6,
  userId: 'u2',
});
// class rows must ALL appear before any olympiad/exam row
const order = plan.filter(r => r.session_type === 'study').map(r => r.track);
const firstNonClass = order.findIndex(t => t !== 'class');
if (firstNonClass >= 0) {
  assert.ok(order.slice(firstNonClass).every(t => t !== 'class'), 'class rows all scheduled BEFORE olympiad/exam rows');
}
assert.ok(plan.some(r => r.track === 'class'), 'class rows scheduled');
assert.ok(plan.coverage && typeof plan.coverage.classTotal === 'number', 'coverage summary attached');
// timed practice + revision + school-exam revision wave
assert.ok(plan.some(r => r.session_type === 'practice'), 'timed practice sessions present');
assert.ok(plan.some(r => r.session_type === 'revision'), 'revision present');
assert.ok(plan.some(r => r.session_type === 'mock'), 'mock days present (before school exam)');
// nothing scheduled ON the school exam day except light revision
const examDayRows = plan.filter(r => r.date === schoolExamDate);
assert.ok(examDayRows.length > 0 && examDayRows.every(r => r.session_type === 'revision'), 'school exam day = light revision only');
// class syllabus coverage before the exam (2-week buffer respected)
const lastClassDate = plan.filter(r => r.track === 'class' && r.session_type === 'study').map(r => r.date).sort().pop();
if (lastClassDate) {
  const bufferMs = new Date(schoolExamDate).getTime() - 14 * 86400000 - new Date(lastClassDate).getTime();
  assert.ok(bufferMs >= -86400000, 'class study wraps up ~2 weeks before the school exam');
}

// track-aware deadlines: class rows due before school exam minus buffer
const dls2 = autoSetDeadlines(multiTrackSyllabus, null, 4, [{ label: 'Mid-Term', date: schoolExamDate }]);
assert.ok(dls2.c1 && dls2.c2, 'class deadlines set from school exam');
assert.ok(dls2.c1 <= schoolExamDate && dls2.c2 <= schoolExamDate, 'class deadlines before school exam');
const deadlineBuffer = (new Date(schoolExamDate) - new Date(dls2.c2)) / 86400000;
assert.ok(deadlineBuffer >= 10, `class deadline ~2 weeks before school exam (buffer: ${deadlineBuffer.toFixed(1)} days)`);

console.log('ALL LOGIC TESTS PASSED ✅');
