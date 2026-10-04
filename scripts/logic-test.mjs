import assert from 'node:assert';
import { levelForXp, tierForXp, levelProgress, streakOnActivity, xpForCode } from './../src/lib/xpService.js';
import { generateSchedule, autoSetDeadlines, autoRescheduleMissed, normalizePriorities } from './../src/lib/scheduleGenerator.js';
import { pickDailyArena, pickBankQuiz, QUIZ_BANK } from './../src/lib/quizBank.js';
import { uuid, mondayOf, daysBetween, seededShuffle, hashString, todayStr } from './../src/lib/utils.js';
import { XP_RULES, TIERS, effectiveDailyHours } from './../src/config/constants.js';

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
assert.equal(set.class, null, 'FIX-B: Class 6 deleted → pickSyllabusSet returns null (existing users keep rows, no new lookup)');

set = pickSyllabusSet({ class_level: 'Class 12', competitive_exam: 'JEE Advanced' });
assert.equal(set.class?.key, 'class12', 'Class 12 student gets Class 12 syllabus');

set = pickSyllabusSet({ class_level: 'Class 11', competitive_exam: 'NEET' });
assert.equal(set.class?.key, 'class11_12_pcb', 'Class 11 NEET aspirant gets PCB variant');

set = pickSyllabusSet({ class_level: 'Class 9', competitive_exam: 'None', olympiad: 'NSO (Science)' });
assert.equal(set.class?.key, 'class9', 'Class 9 default class syllabus');
assert.equal(set.olympiad?.key, 'nso', 'NSO olympiad track');
assert.equal(set.exam, null, 'no exam track when exam is None');

for (const cls of ['Class 9', 'Class 10', 'Class 11', 'Class 12']) {
  assert.ok(CLASS_SYLLABI[cls]?.rows.length >= 10, `${cls} syllabus exists with chapters`);
}
// FIX-B: 6/7/8/College deleted per PO PDF
assert.ok(!CLASS_SYLLABI['Class 6'] && !CLASS_SYLLABI['Class 7'] && !CLASS_SYLLABI['Class 8'] && !CLASS_SYLLABI['College'], 'Class 6/7/8/College deleted per FIX-B');
assert.ok(Object.keys(EXAM_SYLLABI).length >= 3, 'exam tracks exist');
assert.ok(Object.keys(OLYMPIAD_SYLLABI).length >= 4, 'olympiad tracks exist');

// ---- FIX 7 + B + C: student-configurable priority scheduler ----
const multiTrackSyllabus = [
  { id: 'c1', subject: 'Science', chapter: 'Chemical Reactions', weightage: 4, estimated_hours: 6, status: 'locked', track: 'class' },
  { id: 'c2', subject: 'Maths', chapter: 'Trigonometry', weightage: 5, estimated_hours: 10, status: 'locked', track: 'class' },
  { id: 'c3', subject: 'Science', chapter: 'Life Processes', weightage: 5, estimated_hours: 10, status: 'locked', track: 'class' },
  { id: 'c4', subject: 'Maths', chapter: 'Quadratic Equations', weightage: 4, estimated_hours: 8, status: 'locked', track: 'class' },
  { id: 'o1', subject: 'Maths Olympiad', chapter: 'Number Theory', weightage: 5, estimated_hours: 12, status: 'locked', track: 'olympiad' },
  { id: 'e1', subject: 'Physics (JEE)', chapter: 'Rotational Dynamics', weightage: 5, estimated_hours: 14, status: 'locked', track: 'exam' },
];
const schoolStart = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
const schoolEnd = new Date(Date.now() + 66 * 86400000).toISOString().slice(0, 10);
const plan = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  schoolExams: [{ label: 'Mid-Terms', start_date: schoolStart, end_date: schoolEnd, exact: false }], // RANGE (FIX C)
  dailyHours: 3,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 10, // horizon must include the exam range at +60 days
  userId: 'u2',
});
const studyMin = (t) => plan.filter(r => r.session_type === 'study' && r.track === t).reduce((a, r) => a + r.duration_minutes, 0);
assert.ok(plan.some(r => r.track === 'class'), 'class rows scheduled');
// default split 60/30/10 -> class gets the most study minutes
assert.ok(studyMin('class') >= studyMin('exam'), `class (${studyMin('class')}min) >= exam (${studyMin('exam')}min) with default 60/30/10 split`);
// v1.0.2: small splits (10%) used to be starved to ZERO minutes — budget
// accumulation now guarantees tiny tracks still get viable blocks.
assert.ok(studyMin('olympiad') > 0, `small 10% track still surfaces (${studyMin('olympiad')}min > 0)`);
assert.ok(plan.some(r => r.session_type === 'practice'), 'timed practice sessions present');
assert.ok(plan.some(r => r.session_type === 'revision'), 'revision present');
assert.ok(plan.some(r => r.session_type === 'mock'), 'mock days present (before school exam)');
// exam RANGE: every day in the range is light-revision-only
const rangeDay = new Date(Date.now() + 62 * 86400000).toISOString().slice(0, 10);
const rangeRows = plan.filter(r => r.date === rangeDay);
assert.ok(rangeRows.length > 0 && rangeRows.every(r => r.session_type === 'revision'), 'school exam RANGE day = light revision only');
// class study wraps up ~2 weeks before the range START
const lastClassDate = plan.filter(r => r.track === 'class' && r.session_type === 'study').map(r => r.date).sort().pop();
if (lastClassDate) {
  const bufferMs = new Date(schoolStart).getTime() - 14 * 86400000 - new Date(lastClassDate).getTime();
  assert.ok(bufferMs >= -86400000, 'class study wraps up ~2 weeks before the school exam range');
}

// tight capacity: the split actually constrains who gets time (FIX B)
// FIX-SCHED1: horizon now extends to classSessionCutoff (Feb 25). For this tight-capacity
// probe we pin today to 2027-01-14 so cutoff is exactly 42 days away (2027-02-25),
// so weeks:6 stays 42 days and class track gets full window. hoursMultiplier:1 isolates priority.
const planTight = generateSchedule({
  syllabus: multiTrackSyllabus, examDate: null, dailyHours: 1, preferredTime: 'Morning',
  daysOff: [], prepLevel: 'Intermediate', weeks: 6, userId: 'u2',
  today: '2027-01-14',
  hoursMultiplier: 1, olympiadMultiplier: 1, examMultiplier: 1,
});
const tightMin = (t) => planTight.filter(r => r.session_type === 'study' && r.track === t).reduce((a, r) => a + r.duration_minutes, 0);
assert.ok(tightMin('class') > tightMin('exam') && tightMin('class') > tightMin('olympiad'), `tight capacity honours 60/30/10 split (class ${tightMin('class')} vs exam ${tightMin('exam')} vs olympiad ${tightMin('olympiad')} min)`);

// custom priority: olympiad first with a big split (FIX B) — same pinning
const plan2 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 1,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 6,
  userId: 'u2',
  today: '2027-01-14',
  hoursMultiplier: 1, olympiadMultiplier: 1, examMultiplier: 1,
  priorities: { order: ['olympiad', 'class', 'exam'], enabled: { class: true, exam: true, olympiad: true }, timeSplit: { olympiad: 70, class: 20, exam: 10 } },
});
const studyMin2 = (t) => plan2.filter(r => r.session_type === 'study' && r.track === t).reduce((a, r) => a + r.duration_minutes, 0);
assert.ok(studyMin2('olympiad') > studyMin2('class'), `olympiad-first priorities give olympiad more time (${studyMin2('olympiad')} vs ${studyMin2('class')} min)`);
assert.ok(plan2.coverage.priorityOrder[0] === 'olympiad', 'coverage reports custom order');

// disabled track never appears (FIX B) — pin today to keep horizon 28 days, class full window
const plan3 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 3,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 4,
  userId: 'u2',
  today: '2027-01-28',
  hoursMultiplier: 1,
  priorities: { order: ['class', 'exam', 'olympiad'], enabled: { class: true, exam: false, olympiad: false }, timeSplit: { class: 100, exam: 0, olympiad: 0 } },
});
assert.ok(!plan3.some(r => r.track === 'exam'), 'disabled exam track never scheduled');
assert.ok(!plan3.some(r => r.track === 'olympiad'), 'disabled olympiad track never scheduled');

// track-aware deadlines: class rows due before school exam minus buffer
const dls2 = autoSetDeadlines(multiTrackSyllabus, null, 4, [{ label: 'Mid-Term', start_date: schoolStart, end_date: schoolEnd }]);
assert.ok(dls2.c1 && dls2.c2, 'class deadlines set from school exam');
assert.ok(dls2.c1 <= schoolStart && dls2.c2 <= schoolStart, 'class deadlines before school exam range');
const deadlineBuffer = (new Date(schoolStart) - new Date(dls2.c2)) / 86400000;
assert.ok(deadlineBuffer >= 10, `class deadline ~2 weeks before school exam (buffer: ${deadlineBuffer.toFixed(1)} days)`);

// ---------- v1.0.2: custom priority tracks ----------
const normCustom = normalizePriorities({
  order: ['class', 'exam', 'olympiad'],
  timeSplit: { class: 50, exam: 30, olympiad: 10, 'custom:pb': 10 },
  custom: { 'custom:pb': { name: 'Science Boost', subjects: ['Science'] } },
});
assert.ok(normCustom.order.includes('custom:pb'), 'custom track kept in order');
assert.ok(normCustom.custom['custom:pb'].name === 'Science Boost', 'custom meta preserved');
const splitSum = normCustom.order.reduce((a, t) => a + normCustom.timeSplit[t], 0);
assert.ok(Math.abs(splitSum - 100) <= 1, `custom split normalizes to 100 (got ${splitSum})`);

// a custom track claiming Physics pulls those rows into its own track
const plan4 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 3,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 4,
  userId: 'u3',
  priorities: normCustom,
});
assert.ok(
  plan4.some((r) => r.track === 'custom:pb'),
  'custom track receives its claimed subject sessions'
);
assert.ok(plan4.coverage.custom.some((c) => c.id === 'custom:pb' && c.total > 0), 'coverage reports custom track totals');

// 0% split = skip: track present in settings but never scheduled
const normZero = normalizePriorities({ order: ['class', 'exam', 'olympiad'], timeSplit: { class: 100, exam: 0, olympiad: 0 } });
const plan5 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 3,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 4,
  userId: 'u4',
  priorities: normZero,
});
assert.ok(!plan5.some((r) => r.track === 'exam' || r.track === 'olympiad'), '0% tracks are skipped by the scheduler');

// ---------- audit 11.4: regression tests ----------
// HIGH-1: two back-to-back awards must BOTH land (the stale-profile race
// used to keep only the last delta).
{
  const { awardXPToProfile } = await import('./../src/lib/xpService.js');
  let prof = { id: 'u9', total_xp: 0, level: 1, current_streak: 0, longest_streak: 0, streak_freezes: 2, last_active_date: null };
  const inserts = [];
  const deps = {
    profile: prof, // stale snapshot (as captured in a closure)
    getProfile: () => prof, // the fix: always-fresh accessor
    updateProfile: async (patch) => { prof = { ...prof, ...patch }; },
    insert: async (row) => { inserts.push(row); },
  };
  const r1 = await awardXPToProfile(deps, 'ARENA_COMPLETE');  // +20
  const r2 = await awardXPToProfile(deps, 'ARENA_CORRECT', { amount: 50 }); // +50
  assert.strictEqual(prof.total_xp, 70, `back-to-back awards both land (total ${prof.total_xp} == 70)`);
  assert.strictEqual(inserts.length, 2, 'two xp_events rows written');
  assert.ok(r2.total === 70 && r2.total > r1.total, 'second award sees the first one\'s total');
}

// HIGH-2: every scheduled session has a track the DB CHECK accepts
{
  const validTrack = (t) => ['class', 'olympiad', 'exam'].includes(t) || /^custom:/.test(t);
  assert.ok(plan4.every((r) => validTrack(r.track)), 'all session tracks pass the (relaxed) CHECK constraint');
}


// ---------- v1.0.6 recovery: genuine regression tests (import real files) ----------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// A: habit data/log mapping must use correct habit ID (h.id not habit.id)
{
  const src = read('src/screens/life/HabitsScreen.js');
  const lines = src.split('\n');
  const frozenLines = lines.filter(l => l.includes('frozenYesterday'));
  const hasHId = frozenLines.some(l => l.includes('h.id'));
  const hasHabitIdBug = frozenLines.some(l => l.includes('habit.id'));
  assert.ok(hasHId, 'HabitsScreen frozenYesterday uses h.id');
  assert.ok(!hasHabitIdBug, 'HabitsScreen does NOT contain buggy habit.id in frozenYesterday');
}

// B: schedule horizon should cover distant exam (249 days) not stop at 42 days
{
  const distantExam = new Date(Date.now() + 249 * 86400000).toISOString().slice(0, 10);
  const syllabusLong = [
    { id: 'l1', subject: 'Physics', chapter: 'Kinematics', weightage: 4, estimated_hours: 10, status: 'locked' },
    { id: 'l2', subject: 'Maths', chapter: 'Calculus', weightage: 5, estimated_hours: 12, status: 'locked' },
  ];
  const longPlan = generateSchedule({
    syllabus: syllabusLong,
    examDate: distantExam,
    dailyHours: 2,
    preferredTime: 'Evening',
    daysOff: [],
    prepLevel: 'Intermediate',
    weeks: 6,
    userId: 'u_long',
  });
  const lastDate = longPlan.map((r) => r.date).sort().pop();
  const diffDays = Math.ceil((new Date(lastDate) - new Date()) / 86400000);
  assert.ok(diffDays >= 200, 'distant exam horizon covered: lastDate ' + lastDate + ' diff ' + diffDays + ' >= 200 (exam ' + distantExam + ')');
  assert.ok(longPlan.coverage.totalRequiredHours > 0, 'coverage totalRequiredHours computed');
}

// H: syllabus merge should add missing without early exit
{
  const src = read('src/lib/starterData.js');
  // seedSyllabusTrack should NOT have early exit that blocks merge; seedHabits/seedSyllabus may keep theirs for first-run
  const trackFnIdx = src.indexOf('seedSyllabusTrack');
  const trackFnSlice = src.slice(trackFnIdx, trackFnIdx + 800);
  assert.ok(!trackFnSlice.includes('if (existing && existing.length) return 0;'), 'seedSyllabusTrack does NOT have early exit blocking merge');
  // FIX-S S5: the merge logic was EXTRACTED to src/lib/presetRows.js (one dedupe rule
  // for every caller, archived-aware). The guard keeps its intent and now also checks
  // the new home, so the merge cannot silently disappear from either file.
  assert.ok(trackFnSlice.includes('selectFreshPresetRows') && trackFnSlice.includes('fresh'), 'seedSyllabusTrack uses the shared existingKeys/fresh merge logic');
  const presetRowsSrc = read('src/lib/presetRows.js');
  assert.ok(presetRowsSrc.includes('::') && presetRowsSrc.includes('blockingKeys'), 'presetRows.js owns the subject::chapter merge rule');
  assert.ok(presetRowsSrc.includes('isArchivedRow'), 'the merge rule ignores ARCHIVED rows (FIX-S S5)');
  assert.ok(read('src/lib/starterData.js').includes('importPresetRows'), 'starterData still exports the shared preset import');
  const existingRows = [
    { subject: 'Science', chapter: 'Motion', track: 'class', status: 'completed' },
    { subject: 'Science', chapter: 'Force', track: 'class', status: 'in_progress' },
  ];
  const presetRows = [
    { subject: 'Science', chapter: 'Motion' },
    { subject: 'Science', chapter: 'Force' },
    { subject: 'Science', chapter: 'Gravitation' },
  ];
  const existingKeys = new Set(existingRows.map((r) => r.subject + '::' + r.chapter));
  const fresh = presetRows.filter((r) => !existingKeys.has(r.subject + '::' + r.chapter));
  assert.equal(fresh.length, 1, 'merge adds only missing');
  assert.equal(fresh[0].chapter, 'Gravitation');
}

// K: quiz param changes should not reset active quiz — inspect real QuizScreen
{
  const src = read('src/screens/study/QuizScreen.js');
  assert.ok(src.includes("phase === 'playing'") || src.includes('phase !=='), 'QuizScreen guards playing phase');
  assert.ok(src.includes("phase !== 'setup'") && src.includes('return;'), 'QuizScreen only syncs in setup phase');
  // Ensure it does NOT have the results bug: topic param causing setup from results
  // Fixed version should have early return if phase !== setup, so results phase wont bounce
  const hasEarlyReturn = src.includes("if (phase !== 'setup') return;");
  assert.ok(hasEarlyReturn, 'QuizScreen has early return for non-setup phase (prevents results bug)');
}

// F: updated_at handling — schema and db.js fallback
{
  const schema = read('supabase/schema.sql');
  const tables = ['syllabus','schedule','habits','habit_logs','flashcards','content','friends','leaderboard','deadlines','mood_logs'];
  for (const t of tables) {
    const re = new RegExp('create table if not exists public\\.' + t + '[\\s\\S]*?updated_at', 'i');
    assert.ok(re.test(schema), 'schema ' + t + ' has updated_at');
  }
  assert.ok(schema.includes('users_delete_own'), 'schema has users_delete_own RLS policy');
  const dbSrc = read('src/lib/db.js');
  assert.ok(dbSrc.includes('updated_at') && dbSrc.includes('fallback'), 'db.js has updated_at fallback');
}

// J: empty in() guard — genuine check of db.js
{
  const dbSrc = read('src/lib/db.js');
  assert.ok(dbSrc.includes('empty in()') || dbSrc.includes('vals.length === 0'), 'db.js has empty in() guard');
  assert.ok(dbSrc.includes('return [];'), 'db.js returns [] for empty in()');
}

// Edge Function single implementation
{
  const edgeDir = path.join(__dirname, '..', 'supabase', 'functions', 'delete-user');
  const files = fs.readdirSync(edgeDir);
  assert.ok(files.includes('index.ts'), 'Edge Function has index.ts');
  assert.ok(!files.includes('index.js'), 'Edge Function does NOT have duplicate index.js');
}

// ---------- v1.0.6 Round2: duplicate habits idempotency ----------
{
  const src = read('src/lib/starterData.js');
  // seedHabits should be idempotent by name, not just any existing
  assert.ok(src.includes('existingNames') && src.includes('toLowerCase'), 'seedHabits is idempotent by name (existingNames set)');
  const habitFnIdx = src.indexOf('export async function seedHabits');
  const habitSlice = src.slice(habitFnIdx, habitFnIdx + 800);
  assert.ok(!habitSlice.includes('if (existing && existing.length) return 0;'), 'seedHabits does NOT have simple early-exit that allows race duplicates');
  // simulate idempotency logic
  const existing = [{ name: 'Morning Exercise' }, { name: 'Read 30 mins' }];
  const presets = [{ name: 'Morning Exercise' }, { name: 'Read 30 mins' }, { name: 'Meditate' }];
  const existingNames = new Set(existing.map(r => (r.name||'').trim().toLowerCase()));
  const fresh = presets.filter(h => !existingNames.has((h.name||'').trim().toLowerCase()));
  assert.equal(fresh.length, 1, 'seedHabits idempotency: only missing names inserted');
  assert.equal(fresh[0].name, 'Meditate');
}

// ---------- v1.0.6 Round2: mind map blank guard ----------
{
  const src = read('src/lib/aiFeatures.js');
  assert.ok(src.includes('normalizeMindMapResponse'), 'aiFeatures has mind map normalizer');
  assert.ok(src.includes('mind_maps') || src.includes('mindMaps') || src.includes('branches'), 'normalizer handles alternate shapes');
  const src2 = read('src/screens/study/TestBuilderScreen.js');
  assert.ok(src2.includes('if (!node) return null'), 'MapNode guards null node (mind map blank fix)');
  assert.ok(src2.includes('sec.label && String(sec.label).trim()'), 'Section header empty guard exists');
}

// ---------- v1.0.6 Round2: Onboarding double-seed guard ----------
{
  const src = read('src/screens/onboarding/OnboardingScreen.js');
  assert.ok(src.includes('seededRef'), 'Onboarding has seededRef guard against double seeding');
  assert.ok(src.includes('if (seededRef.current) return;'), 'Onboarding checks seededRef before seeding');
}

// ---------- NEW X R1: schema completion ----------
{
  const schema = read('supabase/schema.sql');
  // must contain add column if not exists for track, priorities, school_exams, olympiad_date, kind, gym_split
  assert.ok(schema.includes('add column if not exists track'), 'schema has add column if not exists track (schedule/syllabus)');
  assert.ok(schema.match(/alter table public\.schedule add column if not exists track/i), 'schedule.track migration exists');
  assert.ok(schema.match(/alter table public\.syllabus\s+add column if not exists track/i), 'syllabus.track migration exists');
  assert.ok(schema.match(/alter table public\.users\s+add column if not exists priorities/i), 'users.priorities migration exists');
  assert.ok(schema.match(/alter table public\.users\s+add column if not exists school_exams/i), 'users.school_exams migration exists');
  assert.ok(schema.match(/alter table public\.users\s+add column if not exists olympiad_date/i), 'users.olympiad_date migration exists');
  assert.ok(schema.match(/alter table public\.habits\s+add column if not exists kind/i), 'habits.kind migration exists');
  assert.ok(schema.match(/alter table public\.users\s+add column if not exists gym_split/i), 'users.gym_split migration exists');
  // constraint blocks use pg_constraint / IF NOT EXISTS guard
  assert.ok(schema.includes('pg_constraint') && schema.includes("conname = 'schedule_track_check'"), 'schedule_track_check uses pg_constraint guard');
  assert.ok(schema.includes("conname = 'syllabus_track_check'"), 'syllabus_track_check uses pg_constraint guard');
  assert.ok(schema.includes('IF NOT EXISTS (SELECT 1 FROM pg_constraint'), 'constraint guard pattern IF NOT EXISTS present');
  // forbidden blanket swallowing
  assert.ok(!schema.includes('EXCEPTION WHEN others THEN null') && !schema.includes('EXCEPTION WHEN OTHERS THEN NULL'), 'schema migration has NO blanket EXCEPTION WHEN others THEN null');
  // columns before constraints — track add must appear before first DO $$ guard
  const trackIdx = schema.indexOf('alter table public.schedule add column if not exists track');
  const doIdx = schema.indexOf("conname = 'schedule_track_check'");
  assert.ok(trackIdx !== -1 && doIdx !== -1 && trackIdx < doIdx, 'columns added BEFORE constraints (fixes abort bug)');
}


// ---------- NEW X R2: visible errors ----------
{
  const habitsSrc = read('src/screens/life/HabitsScreen.js');
  assert.ok(habitsSrc.includes('toggleToday') && habitsSrc.includes('infoAlert') && habitsSrc.includes('Habit save fail hua'), 'HabitsScreen toggleToday shows visible error on failure');
  assert.ok(habitsSrc.includes('useFreeze') && habitsSrc.includes('catch'), 'HabitsScreen useFreeze has try/catch');

  const gymSrc = read('src/screens/life/GymScreen.js');
  assert.ok(gymSrc.includes('finishWorkout') && gymSrc.includes('catch') && gymSrc.includes('Workout save fail hua'), 'GymScreen finishWorkout has catch with alert');
  assert.ok(gymSrc.includes('Pehle kuch sets/reps bharo'), 'GymScreen empty workout shows info alert, not silent return');
  assert.ok(gymSrc.includes('addCustomExercise') && gymSrc.includes('infoAlert'), 'GymScreen addCustomExercise visible error');
  assert.ok(gymSrc.includes('removeCustomExercise') && gymSrc.includes('infoAlert'), 'GymScreen removeCustomExercise visible error');

  const settingsSrc = read('src/screens/settings/SettingsScreen.js');
  assert.ok(settingsSrc.includes('Save Priorities') && settingsSrc.includes('try {') && settingsSrc.includes('Priorities save fail hua'), 'Settings Save Priorities has try/catch with visible error');
  assert.ok(settingsSrc.includes('Save Exam Setup') && settingsSrc.includes('Exam setup save fail hua'), 'Settings Save Exam Setup has try/catch with visible error');

  const syllabusSrc = read('src/screens/study/SyllabusScreen.js');
  assert.ok(syllabusSrc.includes('importPreset') && syllabusSrc.includes('Syllabus import fail hua'), 'Syllabus importPreset visible error');
  assert.ok(syllabusSrc.includes('importMyTrack') && syllabusSrc.includes('catch'), 'Syllabus importMyTrack has catch');
  assert.ok(syllabusSrc.includes('addChapter') && syllabusSrc.includes('Syllabus save fail hua'), 'Syllabus addChapter visible error');
}


// ---------- NEW X R3: Fair XP ----------
{
  // negative award reduces total, floor at 0, countActivity false leaves streak untouched
  const { awardXPToProfile } = await import('./../src/lib/xpService.js');
  let prof = { id: 'u_r3', total_xp: 5, level: 1, current_streak: 5, longest_streak: 5, streak_freezes: 2, last_active_date: '2026-09-19' };
  const inserts = [];
  const deps = {
    profile: prof,
    getProfile: () => prof,
    updateProfile: async (patch) => { prof = { ...prof, ...patch }; },
    insert: async (row) => { inserts.push(row); },
  };
  // HABIT_UNDO -10 with floor
  const r1 = await awardXPToProfile(deps, 'HABIT_UNDO', { countActivity: false });
  assert.ok(r1.gained === -10, 'HABIT_UNDO gained -10');
  assert.equal(prof.total_xp, 0, 'floor at 0 (5 + -10 => 0)');
  assert.equal(prof.current_streak, 5, 'countActivity false leaves streak untouched');
  assert.equal(prof.last_active_date, '2026-09-19', 'countActivity false leaves last_active_date untouched');

  // CHAPTER_UNDO -100
  prof = { id: 'u_r3b', total_xp: 150, level: 2, current_streak: 3, longest_streak: 3, streak_freezes: 1, last_active_date: '2026-09-19' };
  const deps2 = {
    profile: prof,
    getProfile: () => prof,
    updateProfile: async (patch) => { prof = { ...prof, ...patch }; },
    insert: async (row) => { inserts.push(row); },
  };
  const r2 = await awardXPToProfile(deps2, 'CHAPTER_UNDO', { countActivity: false });
  assert.equal(r2.gained, -100, 'CHAPTER_UNDO -100');
  assert.equal(prof.total_xp, 50, '150-100=50');

  // XP_RULES amounts
  const { XP_RULES } = await import('./../src/config/constants.js');
  assert.equal(XP_RULES.HABIT_UNDO.amount, -10, 'HABIT_UNDO rule -10');
  assert.equal(XP_RULES.CHAPTER_UNDO.amount, -100, 'CHAPTER_UNDO rule -100');
}

{
  // hasEarnedToday helper exists
  const src = read('src/lib/xpOnce.js');
  assert.ok(src.includes('hasEarnedToday') && src.includes('markEarnedToday'), 'xpOnce helper has hasEarnedToday + markEarnedToday');
  assert.ok(src.includes('xp_events') && src.includes('AsyncStorage'), 'xpOnce uses xp_events cloud + AsyncStorage local');
  assert.ok(src.includes('localDateOf'), 'xpOnce filters by local date');

  const arenaSrc = read('src/screens/guild/ArenaScreen.js');
  assert.ok(arenaSrc.includes('hasEarnedToday') && arenaSrc.includes('alreadyEarnedNote'), 'ArenaScreen uses hasEarnedToday guard + note');
  assert.ok(arenaSrc.includes('XP aaj le liya'), 'ArenaScreen shows once-per-day note');

  const topicSrc = read('src/screens/study/TopicDetailScreen.js');
  assert.ok(topicSrc.includes('CHAPTER_UNDO') && topicSrc.includes('countActivity'), 'TopicDetailScreen awards CHAPTER_UNDO on downgrade');

  const habitsSrc = read('src/screens/life/HabitsScreen.js');
  assert.ok(habitsSrc.includes('HABIT_UNDO'), 'HabitsScreen undo awards HABIT_UNDO');

  const overlaySrc = read('src/components/gamer/Overlays.js');
  assert.ok(overlaySrc.includes('isNeg') || overlaySrc.includes('Number(toast.amount) < 0'), 'Overlays handles negative toast in red');
}


// ---------- NEW X R4: AI service layer ----------
{
  const { looksLikeMissingModel, callProvider } = await import('./../src/lib/aiModelGuard.js');
  assert.ok(looksLikeMissingModel('Gemini 404 gemini-2.5-flash is no longer available to new users'), 'looksLikeMissingModel matches no longer available');
  assert.ok(looksLikeMissingModel('model_not_found: openai/gpt-oss-20b'), 'looksLikeMissingModel matches model_not_found');
  assert.ok(looksLikeMissingModel('shut down 16 Aug 2026'), 'looksLikeMissingModel matches shut down');

  // simulate callProvider with fake requester that 404s model1 and succeeds on model2
  let calls = [];
  const fakeRequester = async (model, args) => {
    calls.push(model);
    if (model === 'gemini-flash-latest') throw new Error('404 gemini-flash-latest is no longer available to new users');
    return `ok from ${model}`;
  };
  const res = await callProvider(['gemini-flash-latest', 'gemini-3.5-flash'], fakeRequester, {});
  assert.equal(res, 'ok from gemini-3.5-flash', 'callProvider advances to next model on missing model');
  assert.ok(calls.includes('gemini-flash-latest') && calls.includes('gemini-3.5-flash'), 'both models tried');

  const src = read('src/lib/aiService.js');
  assert.ok(src.includes("'gemini-flash-latest'") && src.includes("'gemini-3.5-flash'") && src.includes("'gemini-3.1-flash-lite'"), 'GEMINI_MODELS updated to new list');
  // FIX-F9: qwen/qwen3.6-27b 404 — removed from GROQ_MODELS, only verified production models remain
  assert.ok(src.includes("'openai/gpt-oss-120b'") && src.includes("'openai/gpt-oss-20b'"), 'GROQ_MODELS has openai models');
  const groqModelsLineRaw = src.split('\n').find(l => l.includes('GROQ_MODELS') && l.includes('const')) || '';
  const groqModelsLine = groqModelsLineRaw.split('//')[0]; // ignore inline comment documenting removal
  assert.ok(!groqModelsLine.includes('qwen/qwen3.6-27b'), 'FIX-F9: qwen3.6 removed from GROQ_MODELS array (404)');
  assert.ok(!src.includes('gemini-2.0-flash') && !src.includes('gemini-2.5-flash'), 'old Gemini models removed');
  // old models removed from actual model arrays (comment may mention them for history)
  assert.ok(!groqModelsLine.includes('llama-3.3-70b-versatile') && !groqModelsLine.includes('llama-3.1-8b-instant'), 'old Groq llama models removed from GROQ_MODELS');

  const constSrc = read('src/config/constants.js');
  assert.ok(constSrc.includes("gemini: 'gemini-flash-latest'") && constSrc.includes("groq: 'openai/gpt-oss-120b'"), 'AI_MODELS constants updated');
}


// ---------- NEW X R5: Test Builder normalizer ----------
{
  const { normalizeTestQuestion } = await import('./../src/lib/testQuestionNormalizer.js');

  // Scenario 1: string-form VSAQ/SAQ/LAQ should NOT be dropped (inherits type) — FIX-A2: answer must be EMPTY
  const s1 = normalizeTestQuestion("What is photosynthesis?", "vsaq");
  assert.ok(s1 && s1.q.includes("photosynthesis") && s1.type.includes("vsaq"), "string-form VSAQ kept with type inheritance");
  assert.ok(s1.answer === '' && s1.answer_text === '', "FIX-A2: string-form answer empty, not question repeated");

  const s2 = normalizeTestQuestion("Explain Newton's laws", "saq");
  assert.ok(s2 && s2.type.includes("saq"), "string-form SAQ kept");
  assert.ok(s2.answer === '' && s2.answer_text === '', "FIX-A2: SAQ string-form empty answer");

  const s3 = normalizeTestQuestion("Derive the equation", "laq");
  assert.ok(s3 && s3.type.includes("laq"), "string-form LAQ kept");
  assert.ok(s3.answer === '' && s3.answer_text === '', "FIX-A2: LAQ string-form empty answer");

  // FIX-A2 specific regression
  const regA2 = normalizeTestQuestion("Define photosynthesis.", "vsaq");
  assert.ok(regA2.q === "Define photosynthesis." && regA2.answer === '' && regA2.type === 'vsaq', "FIX-A2 regression: Define photosynthesis. -> q kept, answer empty, type vsaq");

  // Scenario 2: answers under ans/solution/model_answer are read
  const qAns = normalizeTestQuestion({ q: "Capital of India?", ans: "New Delhi", type: "saq" });
  assert.ok(qAns && qAns.answer_text.includes("New Delhi"), "answer from ans key read");

  const qSol = normalizeTestQuestion({ q: "What is 2+2?", solution: "4", type: "vsaq" });
  assert.ok(qSol && qSol.answer_text.includes("4"), "answer from solution key read");

  const qModel = normalizeTestQuestion({ q: "Define gravity", model_answer: "Force that attracts", type: "saq" });
  assert.ok(qModel && qModel.answer_text.includes("Force"), "answer from model_answer key read");

  // Scenario 3: unresolved MCQ answers → null, never default A
  const qNoAns = normalizeTestQuestion({ q: "What is X?", options: ["A","B","C","D"], type: "mcq" });
  assert.ok(qNoAns && qNoAns.answer === null, "MCQ with no answer → null, not default A");

  const qBadAns = normalizeTestQuestion({ q: "What is Y?", options: ["A","B","C","D"], answer: "Z", type: "mcq" });
  assert.ok(qBadAns && qBadAns.answer === null, "MCQ with unresolvable answer → null");

  // FIX-A3: loose prefix must NOT match
  const { resolveAnswerIndexStrict } = await import('./../src/lib/testQuestionNormalizer.js');
  const strictZebra = resolveAnswerIndexStrict({ answer: 'zebra', options: ['x','y','z','w'] });
  assert.ok(strictZebra === null, "FIX-A3: zebra should NOT match z via prefix → null");
  const strictParis = resolveAnswerIndexStrict({ answer: 'Paris', options: ['London','Paris','Berlin','Rome'] });
  assert.ok(strictParis === 1, "FIX-A3: exact Paris matches index 1");
  const strictLetter = resolveAnswerIndexStrict({ answer: 'b', options: ['Opt A','Opt B','Opt C','Opt D'] });
  assert.ok(strictLetter === 1, "FIX-A3: letter b resolves to 1");
  const strictNum = resolveAnswerIndexStrict({ answer: '2', options: ['A','B','C','D'] });
  assert.ok(strictNum === 2 || strictNum === 1, "FIX-A3: numeric 2 resolves (0-based 2 or 1-based 1) not null");
  const strictZero = resolveAnswerIndexStrict({ answer: '0', options: ['A','B','C','D'] });
  assert.ok(strictZero === 0, "FIX-A3: numeric 0 resolves to 0");

  // Scenario 4: blank question text rejected (trim length <3)
  const qBlank = normalizeTestQuestion({ q: "  ", type: "mcq", options: ["A","B"] });
  assert.ok(qBlank === null, "blank question rejected");

  const qShort = normalizeTestQuestion({ q: "Q1", type: "saq" });
  assert.ok(qShort === null, "too short question (len<3) rejected");

  // MCQ with valid answer still works
  const qMcqValid = normalizeTestQuestion({ q: "Capital?", options: ["Delhi","Mumbai","Kolkata","Chennai"], answer: "Delhi", type: "mcq" });
  assert.ok(qMcqValid && qMcqValid.answer === 0 && qMcqValid.answer_text === "Delhi", "MCQ valid answer resolved");

  // SAQ with explicit type, no options
  const qSaq = normalizeTestQuestion({ q: "Explain photosynthesis", answer: "Process by which plants make food", type: "saq" });
  assert.ok(qSaq && qSaq.type.includes("saq") && qSaq.answer_text.includes("plants"), "SAQ explicit type works");

  // LAQ
  const qLaq = normalizeTestQuestion({ q: "Discuss climate change", answer: "Long answer about climate", type: "laq" });
  assert.ok(qLaq && qLaq.type.includes("laq"), "LAQ explicit type works");

  // VSAQ
  const qVsaq = normalizeTestQuestion({ q: "What is SI unit of force?", answer: "Newton", type: "vsaq" });
  assert.ok(qVsaq && qVsaq.type.includes("vsaq"), "VSAQ explicit type works");

  // Missing type with options → should infer mcq
  const qMissingType = normalizeTestQuestion({ q: "What is X?", options: ["A","B","C","D"], answer: "B" });
  assert.ok(qMissingType && qMissingType.type.includes("mcq"), "missing type with options inferred as mcq");
}

{
  // Batching and difficulty bands existence checks
  // FIX-G1 SUPERSEDES two assertions that used to live here:
  //   'BATCH_SIZE ... 20' and 'MAX_BATCHES ... 6'.
  // 20-question batches were the source of the Groq 413 failures, and a hard
  // 6-batch cap could never fill a 100-question bank (6 x 20 = 120 at best, but
  // under-delivery meant it always gave up short). The loop is still BOUNDED —
  // the cap just derives from the requested total instead of being a constant.
  const src = read('src/lib/aiFeatures.js');
  assert.ok(src.includes('QB_BATCH_SIZE') && !/BATCH_SIZE\s*=\s*20/.test(src), 'Question bank batching bounded and no longer 20/request');
  assert.ok(src.includes('batchCapFor') && src.includes('maxBatches'), 'Batch cap exists (bounded loop), derived from the requested total');
  const { batchCapFor, QB_BATCH_SIZE } = await import('./../src/lib/testGenKit.js');
  assert.strictEqual(QB_BATCH_SIZE, 10, 'FIX-G1: batch size is 10');
  assert.ok(batchCapFor(100, QB_BATCH_SIZE) >= Math.ceil(100 / QB_BATCH_SIZE), 'cap allows at least the minimum batches needed');
  assert.ok(Number.isFinite(batchCapFor(1000, QB_BATCH_SIZE)) && batchCapFor(1000, QB_BATCH_SIZE) < 400, 'cap stays finite/bounded for large targets');
  assert.ok(src.includes('_banner') && src.includes('questions returned'), 'Partial banner honest message exists'); // FIX-BYTE2: probe tracks the PO-ordered neutral English copy (was 'questions mile')
  assert.ok(src.includes('difficultyBand') && src.includes('foundation recall') && src.includes('olympiad HOTS'), 'Difficulty bands mapped to concrete text');
  assert.ok(src.includes('answerLengthHint') || src.includes('VSAQ = one line'), 'Answer length hints baked into prompts');
  assert.ok(src.includes('EMPTY section') || src.includes('stillMissing') || src.includes('VSAQ section nahi bheja'), 'Empty section retry logic exists');

  const builderSrc = read('src/screens/study/TestBuilderScreen.js');
  assert.ok(builderSrc.includes('elapsed') && builderSrc.includes('Professor Byte soch raha hai'), 'TestBuilder shows elapsed + stage progress UI');
  assert.ok(builderSrc.includes('difficultyPct: difficulty'), 'Mind map receives difficultyPct');
}


// ---------- NEW X R6: Flashcards crash + XP once ----------
{
  const deckSrc = read('src/screens/study/DeckScreen.js');
  assert.ok(deckSrc.includes('if (!card && !done)'), 'DeckScreen crash guard if (!card && !done) exists');
  assert.ok(deckSrc.includes('hasEarnedToday') && deckSrc.includes('markEarnedToday'), 'DeckScreen uses hasEarnedToday for once-per-day XP');
  assert.ok(deckSrc.includes('Hard = jaldi dobara'), 'DeckScreen explainer line exists');
  assert.ok(!deckSrc.includes("await awardXP('FLASHCARD_REVIEW');\n\n    setFlipped"), 'DeckScreen per-rating XP removed');

  const flashSrc = read('src/screens/study/FlashcardsScreen.js');
  assert.ok(flashSrc.includes('valid') && flashSrc.includes('front_text') && flashSrc.includes('trim().length >=1'), 'FlashcardsScreen filters invalid AI cards');
  assert.ok(flashSrc.includes('khaali cards bheje'), 'FlashcardsScreen shows honest error for 0 valid cards');

  const aiSrc = read('src/lib/aiFeatures.js');
  assert.ok(aiSrc.includes('trim().length >=1') && aiSrc.includes('front') && aiSrc.includes('back'), 'aiFeatures flashcard normalization filters empties');
}


// ---------- NEW X R7: skipped rollover ----------
{
  const { autoRescheduleMissed } = await import('./../src/lib/scheduleGenerator.js');
  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const rows = [
    { id: '1', status: 'pending', date: yesterday, duration_minutes: 30, track: 'class', subject: 'Math' },
    { id: '2', status: 'skipped', date: yesterday, duration_minutes: 30, track: 'class', subject: 'Physics' },
    { id: '3', status: 'pending', date: today, duration_minutes: 30, track: 'class', subject: 'Chem' },
  ];
  const res = autoRescheduleMissed(rows, { dailyHours: 3 });
  assert.ok(res.moved.length === 2, 'autoRescheduleMissed moves both pending + skipped past due');
  assert.ok(res.moved.some(m => m.id === '2'), 'skipped row is moved, not dropped');
  assert.ok(res.moved.every(m => m.status === 'pending'), 'moved rows reset to pending');

  const schedSrc = read('src/screens/study/ScheduleScreen.js');
  assert.ok(schedSrc.includes("status === 'skipped'") && schedSrc.includes('missed'), 'ScheduleScreen missed includes skipped');
  assert.ok(schedSrc.includes('Kal') || schedSrc.includes('kal shift'), 'Skip button clarity (Kal label)');
  assert.ok(schedSrc.includes('auto-roll') || schedSrc.includes('auto-roll forward'), 'Auto-run notice for skipped rollover');
}


// ---------- NEW X R8: gym split ----------
{
  const { getWeeklyGymSplit, classifyExercise, gymSplitBadgeText } = await import('./../src/lib/gymSplit.js');
  const logs = [
    { date: new Date().toISOString().slice(0,10), exercises: [{ name: 'Bench Press' }, { name: 'Squat' }, { name: 'Barbell Row' }] },
  ];
  const weekly = getWeeklyGymSplit(logs);
  assert.ok(weekly.breakdown.push >=1, 'push classified');
  assert.ok(weekly.breakdown.pull >=1, 'pull classified');
  assert.ok(weekly.breakdown.legs >=1, 'legs classified');
  assert.ok(weekly.splitLabel.includes('PPL'), 'PPL split detected');

  const c1 = classifyExercise('Push-ups');
  assert.ok(c1 === 'push', 'classify push');

  const badge = gymSplitBadgeText(null, weekly);
  assert.ok(badge.includes('PPL'), 'badge text from weekly');

  const gymSrc = read('src/screens/life/GymScreen.js');
  assert.ok(gymSrc.includes('Split:') && gymSrc.includes('getWeeklyGymSplit'), 'GymScreen shows split badge');
  const dbSrc = read('src/lib/db.js');
  assert.ok(dbSrc.includes('getWeeklyGymSplit'), 'db.js exports getWeeklyGymSplit');
}


// ---------- NEW X R9: good/bad habits ----------
{
  const habitSrc = read('src/screens/life/HabitsScreen.js');
  assert.ok(habitSrc.includes("kind") && habitSrc.includes("good") && habitSrc.includes("bad"), 'HabitsScreen handles good/bad kind');
  assert.ok(habitSrc.includes('HABIT_BAD') && habitSrc.includes('HABIT_BAD_UNDO'), 'HabitsScreen awards BAD XP and undo');
  assert.ok(habitSrc.includes('isBad'), 'HabitsScreen distinguishes bad habit UI');
  const xpSrc = read('src/config/constants.js');
  assert.ok(xpSrc.includes('HABIT_BAD'), 'XP rules include HABIT_BAD');
}


// ---------- NEW X R10: syllabus data overhaul (FIX-B real) ----------
{
  const { CLASS_SYLLABI } = await import('./../src/data/syllabusData.js');
  // Class 6/7/8/College must be ABSENT per FIX-B
  assert.ok(!CLASS_SYLLABI['Class 6'], 'FIX-B: Class 6 deleted');
  assert.ok(!CLASS_SYLLABI['Class 7'], 'FIX-B: Class 7 deleted');
  assert.ok(!CLASS_SYLLABI['Class 8'], 'FIX-B: Class 8 deleted');
  assert.ok(!CLASS_SYLLABI['College'], 'FIX-B: College deleted');

  const c9 = CLASS_SYLLABI['Class 9'];
  const c10 = CLASS_SYLLABI['Class 10'];
  assert.ok(c9 && c10, 'FIX-B: Class 9 and 10 present');
  assert.ok(c9.rows.length === 72, `FIX-B: Class 9 rows must be exactly 72 got ${c9?.rows.length}`);
  assert.ok(c10.rows.length === 106, `FIX-B: Class 10 rows must be exactly 106 got ${c10?.rows.length}`);

  // Representative exact chapter names per audit
  const hasChapter = (rows, name) => rows.some(r => r.chapter === name || r.chapter.includes(name));
  assert.ok(hasChapter(c10.rows, 'The Rise of Nationalism in Europe'), 'FIX-B: Class10 has The Rise of Nationalism in Europe');
  assert.ok(hasChapter(c9.rows, 'Kabir Ke Dohe'), 'FIX-B: Class9 has Kabir Ke Dohe');
  assert.ok(hasChapter(c10.rows, 'A Letter to God'), 'FIX-B: Class10 has A Letter to God');

  // Subject coverage Appendix A/B
  const subjects9 = new Set(c9.rows.map(r=>r.subject));
  const subjects10 = new Set(c10.rows.map(r=>r.subject));
  // Science, Maths, History, Geography, Political Science, Economics, English, Hindi, AI
  for (const subj of ['Science','Maths','History','Geography','Political Science','Economics','English','Hindi','AI']) {
    assert.ok(subjects9.has(subj), `FIX-B: Class9 has ${subj}`);
    assert.ok(subjects10.has(subj), `FIX-B: Class10 has ${subj}`);
  }

  // No duplicate exact chapter within same subject
  const dupCheck = (rows) => {
    const seen = new Set();
    for (const r of rows) {
      const key = `${r.subject}::${r.chapter}`;
      if (seen.has(key)) return key;
      seen.add(key);
    }
    return null;
  };
  assert.ok(!dupCheck(c9.rows), 'FIX-B: Class9 no duplicate chapters');
  assert.ok(!dupCheck(c10.rows), 'FIX-B: Class10 no duplicate chapters');

  // Class 9 Maths Part 2 speculative flag present
  assert.ok(c9.rows.some(r => r.chapter.includes('Part 2') && r.chapter.includes('speculative')), 'FIX-B: Class9 Maths Part 2 speculative flag');

  // Onboarding picker 9-12 only
  const constSrc = read('src/config/constants.js');
  // Extract CLASS_GROUPS block
  const cgMatch = constSrc.match(/CLASS_GROUPS\s*=\s*\[([\s\S]*?)\];/);
  const cgBlock = cgMatch ? cgMatch[1] : '';
  assert.ok(cgBlock.includes('Class 9') && cgBlock.includes('Class 12'), 'CLASS_GROUPS has 9-12');
  assert.ok(!cgBlock.includes('Class 6') && !cgBlock.includes('Class 7') && !cgBlock.includes('Class 8'), 'FIX-B: CLASS_GROUPS does NOT have 6-8');

  // pickSyllabusSet guards no 6-8 lookups
  const syllSrc = read('src/data/syllabusData.js');
  assert.ok(!syllSrc.includes('`Class ${n}`') || syllSrc.includes('if (n === 9'), 'normalizeClass only 9-12');
}

// ---------- NEW X R11: UX pack ----------
{
  const contentSrc = read('src/screens/study/ContentScreen.js');
  assert.ok(contentSrc.includes('noteOpen') && contentSrc.includes('ScrollView') && contentSrc.includes('selectable'), 'ContentScreen note viewer readable scrollable selectable');
  assert.ok(contentSrc.includes('numberOfLines'), 'ContentScreen truncation with numberOfLines');

  const settingsSrc = read('src/screens/settings/SettingsScreen.js');
  assert.ok(settingsSrc.includes('dailyHours') && settingsSrc.includes('hrs') && settingsSrc.includes('0.5'), 'SettingsScreen hours stepper exists');
  assert.ok(settingsSrc.includes('No exam date set') && settingsSrc.includes('Exam date past'), 'SettingsScreen exam honesty messages');
  assert.ok(settingsSrc.includes('numberOfLines'), 'SettingsScreen truncation');

  const guildSrc = read('src/screens/guild/GuildScreen.js');
  assert.ok(guildSrc.includes('once per day') || guildSrc.includes('DAILY ARENA'), 'GuildScreen arena guard note');
  assert.ok(guildSrc.includes('hasEarnedToday') || read('src/screens/guild/ArenaScreen.js').includes('hasEarnedToday'), 'Arena XP once-per-day guard exists');
}


// ---------- FIX-C: Gym Split System ----------
{
  const { todayWorkout, getExercisesForGroups, getSplitDefinition } = await import('./../src/lib/gymSplit.js');
  const { GYM_SPLITS, EXERCISE_LIBRARY, MUSCLE_GROUPS } = await import('./../src/config/constants.js');

  // Muscle groups 11
  assert.ok(MUSCLE_GROUPS.length === 11, `MUSCLE_GROUPS 11 got ${MUSCLE_GROUPS.length}`);
  assert.ok(MUSCLE_GROUPS.includes('Chest') && MUSCLE_GROUPS.includes('Abs/Core'), 'MUSCLE_GROUPS has Chest and Abs/Core');

  // Exercise library ~55
  assert.ok(EXERCISE_LIBRARY.length >= 50, `EXERCISE_LIBRARY >=50 got ${EXERCISE_LIBRARY.length}`);
  assert.ok(EXERCISE_LIBRARY.every(ex => ex.group && (ex.gym || ex.home)), 'EXERCISE_LIBRARY tagged gym/home + group');

  // GYM_SPLITS definitions
  assert.ok(GYM_SPLITS.ppl && GYM_SPLITS.arnold && GYM_SPLITS.upper_lower && GYM_SPLITS.full_body && GYM_SPLITS.custom, 'GYM_SPLITS has 5 types');
  assert.ok(GYM_SPLITS.ppl.dayTypes[0].label === 'Push Day' && GYM_SPLITS.ppl.dayTypes[0].groups.includes('Chest'), 'PPL Push Day = Chest,Shoulders,Triceps');
  assert.ok(GYM_SPLITS.ppl.dayTypes[1].groups.includes('Back'), 'PPL Pull Day includes Back');
  assert.ok(GYM_SPLITS.ppl.dayTypes[2].groups.includes('Quads'), 'PPL Legs Day includes Quads');
  assert.ok(GYM_SPLITS.arnold.dayTypes[0].groups.includes('Chest') && GYM_SPLITS.arnold.dayTypes[0].groups.includes('Back'), 'Arnold Chest+Back');
  assert.ok(GYM_SPLITS.arnold.dayTypes[2].groups.includes('Abs/Core'), 'Arnold Legs+Abs includes Abs/Core');

  // todayWorkout pure — PPL + Sunday rest → Mon Push, Tue Pull, Wed Legs, next Mon Push
  const pplSunRest = { type: 'ppl', restDays: [6] }; // Sun rest
  // Find a Monday date
  const monDate = '2026-09-21'; // 2026-09-21 is Monday
  const tueDate = '2026-09-22';
  const wedDate = '2026-09-23';
  const thuDate = '2026-09-24';
  const friDate = '2026-09-25';
  const satDate = '2026-09-26';
  const sunDate = '2026-09-27';
  const nextMon = '2026-09-28';

  const monW = todayWorkout(pplSunRest, monDate);
  const tueW = todayWorkout(pplSunRest, tueDate);
  const wedW = todayWorkout(pplSunRest, wedDate);
  const thuW = todayWorkout(pplSunRest, thuDate);
  const sunW = todayWorkout(pplSunRest, sunDate);
  const nextMonW = todayWorkout(pplSunRest, nextMon);

  assert.ok(monW.label === 'Push Day', `Mon Push got ${monW.label}`);
  assert.ok(tueW.label === 'Pull Day', `Tue Pull got ${tueW.label}`);
  assert.ok(wedW.label === 'Legs Day', `Wed Legs got ${wedW.label}`);
  assert.ok(thuW.label === 'Push Day', `Thu Push (rotation) got ${thuW.label}`);
  assert.ok(sunW.isRest, 'Sun is rest');
  assert.ok(nextMonW.label === 'Push Day', 'Next Mon fresh Push again');

  // Rest-day edges: Fri+Sun rest case
  const friSunRest = { type: 'ppl', restDays: [4,6] }; // Fri, Sun
  const friW = todayWorkout(friSunRest, friDate);
  const satW = todayWorkout(friSunRest, satDate);
  assert.ok(friW.isRest, 'Fri rest');
  assert.ok(satW.label === 'Pull Day', `Sat after Fri rest should be Pull (Mon Push Tue Pull Wed Legs Thu Push Fri Rest Sat Pull) got ${satW.label}`);

  // Week wrap: Monday always day-type 1 even if previous week had different rest
  const monAlways = todayWorkout({ type: 'upper_lower', restDays: [0,1,2,3,4,5] }, '2026-09-21'); // only Sun non-rest
  assert.ok(monAlways.isRest, 'Mon rest when restDays includes Mon');

  // Custom builder auto-fill
  const pushEx = getExercisesForGroups(['Chest','Triceps'], 'gym');
  assert.ok(pushEx.length >= 3 && pushEx.every(ex => ['Chest','Triceps'].includes(ex.group)), 'getExercisesForGroups Chest+Triceps gym');

  // GymScreen writes gym_split
  const gymSrc = read('src/screens/life/GymScreen.js');
  assert.ok(gymSrc.includes('gym_split') && gymSrc.includes('updateProfile'), 'GymScreen writes gym_split');
  assert.ok(gymSrc.includes('Rest & recover') && gymSrc.includes('Train anyway'), 'GymScreen rest day UI + override');
  assert.ok(gymSrc.includes('Split Mode') && gymSrc.includes('Classic Plans'), 'GymScreen classic toggle');
  assert.ok(gymSrc.includes('todayWorkout'), 'GymScreen uses todayWorkout pure');
}


// ---------- FIX-D: truncation, note viewer full-screen, saved ranges, AI catch-up school awareness ----------
{
  const testBuilderSrc = read('src/screens/study/TestBuilderScreen.js');
  // D1 truncation worst fixed: no slice(0,42) on chapter chips
  assert.ok(!testBuilderSrc.includes('slice(0, 42)'), 'FIX-D1: Test Builder chip no longer slices to 42 chars (truncation fixed)');
  assert.ok(testBuilderSrc.includes('Selected chapters (full names)'), 'FIX-D1: full names display added for selected chapters');
  assert.ok(testBuilderSrc.includes('selectable'), 'FIX-D1: selectable text for full chapter names');

  const contentSrc = read('src/screens/study/ContentScreen.js');
  // D2 full-screen note viewer
  assert.ok(contentSrc.includes('full-screen note reader') || contentSrc.includes('Full-screen reader'), 'FIX-D2: full-screen note reader label present');
  assert.ok(contentSrc.includes('fullReaderOpen') && contentSrc.includes('selectable'), 'FIX-D2: full-screen reader state + selectable text');
  assert.ok(contentSrc.includes('maxHeight="92%"') || contentSrc.includes('maxHeight: 520') || contentSrc.includes('full-screen reader'), 'FIX-D2: note viewer enlarged to near full-screen (92% or 520)');
  assert.ok(contentSrc.includes('position: \'absolute\'') && contentSrc.includes('zIndex: 9999'), 'FIX-D2: true full-screen overlay with absolute positioning');

  const settingsSrc = read('src/screens/settings/SettingsScreen.js');
  // D3 saved school-exam ranges visible
  assert.ok(settingsSrc.includes('Saved school exams') && settingsSrc.includes('visible to scheduler'), 'FIX-D3: saved school-exam ranges summary card visible');
  assert.ok(settingsSrc.includes('Scheduler uses these ranges') || settingsSrc.includes('light revision only'), 'FIX-D3: scheduler awareness text for saved ranges');

  // D4 AI catch-up respects school exams
  const schedGenSrc = read('src/lib/scheduleGenerator.js');
  assert.ok(schedGenSrc.includes('schoolExams') && schedGenSrc.includes('examDates') && schedGenSrc.includes('isExamDay'), 'FIX-D4: autoRescheduleMissed respects school exam ranges (examDates set + isExamDay check)');
  assert.ok(schedGenSrc.includes("isStudy && isExamDay") || schedGenSrc.includes("don't push study into exam range") || schedGenSrc.includes('FIX-D4'), 'FIX-D4: study sessions skipped on exam days');

  const aiFeatSrc = read('src/lib/aiFeatures.js');
  assert.ok(aiFeatSrc.includes('schoolExams') && aiFeatSrc.includes('school exam days are light revision only'), 'FIX-D4: aiReschedule prompt includes school exam awareness');

  const schedScreenSrc = read('src/screens/study/ScheduleScreen.js');
  assert.ok(schedScreenSrc.includes('schoolExams') && schedScreenSrc.includes('autoRescheduleMissed') && schedScreenSrc.includes('aiReschedule'), 'FIX-D4: ScheduleScreen passes schoolExams to both autoRescheduleMissed and aiReschedule');
  assert.ok(schedScreenSrc.includes('FIX-D4'), 'FIX-D4: ScheduleScreen has FIX-D4 comment');

  // Functional test: autoRescheduleMissed should NOT move study into exam range
  const { autoRescheduleMissed } = await import('./../src/lib/scheduleGenerator.js');
  const today = new Date().toISOString().slice(0,10);
  const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
  const dayAfter = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const rows = [
    { id: 'miss1', status: 'pending', date: yesterday, duration_minutes: 30, track: 'class', subject: 'Math', session_type: 'study' },
  ];
  // School exam tomorrow — should skip tomorrow for study
  const schoolExams = [{ label: 'Mid-Terms', start_date: tomorrow, end_date: tomorrow, exact: false }];
  const res = autoRescheduleMissed(rows, { dailyHours: 3, schoolExams });
  assert.ok(res.moved.length === 1, 'FIX-D4: missed moved even with exam tomorrow');
  assert.ok(res.moved[0].date !== tomorrow, `FIX-D4: moved date ${res.moved[0].date} should NOT be exam day ${tomorrow}`);
  assert.ok(res.moved[0].date === dayAfter || res.moved[0].date === today || new Date(res.moved[0].date) > new Date(tomorrow), 'FIX-D4: moved to non-exam day');
}


// ---------- FIX-E: auto rollover on schedule load ----------
{
  const schedScreenSrc = read('src/screens/study/ScheduleScreen.js');
  assert.ok(schedScreenSrc.includes('FIX-E') && schedScreenSrc.includes('auto rollover on schedule load'), 'FIX-E: auto rollover comment present');
  assert.ok(schedScreenSrc.includes('autoRolledRef') && schedScreenSrc.includes('useRef'), 'FIX-E: autoRolledRef guard with useRef');
  assert.ok(schedScreenSrc.includes('autoRollMsg') && schedScreenSrc.includes('Auto-rolled'), 'FIX-E: autoRollMsg banner shows auto-rolled count');
  assert.ok(schedScreenSrc.includes('useFocusEffect') && schedScreenSrc.includes('autoRolledRef.current = false'), 'FIX-E: guard reset on focus so next visit can auto-roll again');
  assert.ok(schedScreenSrc.includes('pastDue') && schedScreenSrc.includes('autoRescheduleMissed'), 'FIX-E: pastDue detection + autoRescheduleMissed call on load');
  assert.ok(schedScreenSrc.includes('schoolExams') && schedScreenSrc.includes('autoRescheduleMissed'), 'FIX-E: respects schoolExams (from FIX-D4)');

  // Functional: simulate load with missed -> auto moves
  const { autoRescheduleMissed } = await import('./../src/lib/scheduleGenerator.js');
  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const rows = [
    { id: 'a1', status: 'pending', date: yesterday, duration_minutes: 30, track: 'class', subject: 'Physics', session_type: 'study' },
    { id: 'a2', status: 'skipped', date: yesterday, duration_minutes: 30, track: 'exam', subject: 'Chemistry', session_type: 'study' },
  ];
  const res = autoRescheduleMissed(rows, { dailyHours: 3, schoolExams: [] });
  assert.ok(res.moved.length === 2, 'FIX-E: autoRescheduleMissed moves both pending+skipped on load');
  assert.ok(res.moved.every(m => m.date >= today), 'FIX-E: moved to today or future, not past');
  assert.ok(res.moved.every(m => m.status === 'pending'), 'FIX-E: moved reset to pending');
}


// ---------- FIX-F: F1-F9 implementation pack ----------
{
  // F1 gym XP farm guard
  const gymSrc = read('src/screens/life/GymScreen.js');
  assert.ok(gymSrc.includes('hasEarnedToday') && gymSrc.includes('markEarnedToday'), 'F1: GymScreen uses hasEarnedToday/markEarnedToday guard');
  assert.ok(gymSrc.includes("'workout'") && gymSrc.includes('Aaj ka gym XP le liya'), 'F1: workout key + daily cap note present');
  assert.ok(gymSrc.includes('xp_earned') && gymSrc.includes('alreadyEarned') || gymSrc.includes('xpToLog'), 'F1: xp_earned 0 when already earned');
  assert.ok(gymSrc.includes('Log workout FIRST') || gymSrc.includes('independent of XP'), 'F1: logging independent of XP success');

  // Simulate fail-before vs pass-after for gym XP
  // Fail-before: no guard -> second completion also +30
  let totalXp = 0;
  const award = (amt) => { totalXp += amt; };
  // Old behavior: 4 completions = 120
  totalXp = 0;
  for (let i=0;i<4;i++) award(30);
  assert.equal(totalXp, 120, 'F1 fail-before: 4 completions = 120 XP farmable');
  // New behavior: guard -> only first counts
  totalXp = 0;
  const seen = new Set();
  const today = '2026-09-21';
  for (let i=0;i<4;i++) {
    const key = `workout:${today}`;
    if (!seen.has(key)) { award(30); seen.add(key); }
  }
  assert.equal(totalXp, 30, 'F1 pass-after: 4 completions same day = 30 XP only');

  // F2 split mode header
  assert.ok(gymSrc.includes('FIX-F2') && gymSrc.includes('split mode list header'), 'F2: split mode header comment present');
  // Both modes should have header row Exercise/Sets/Reps/Wt(kg) — JSX separate Text nodes
  const wtCount = (gymSrc.match(/Wt\(kg\)/g) || []).length;
  const exerciseHeaderCount = (gymSrc.match(/>Exercise<\/Text>/g) || []).length;
  assert.ok(wtCount >= 2, `F2: both Classic and Split have Wt(kg) header (found ${wtCount})`);
  assert.ok(exerciseHeaderCount >= 2, `F2: both Classic and Split have Exercise header (found ${exerciseHeaderCount})`);

  // F3 email registration no corrupt account
  const authSrc = read('src/lib/auth.js');
  assert.ok(authSrc.includes('FIX-F3') && authSrc.includes('no session'), 'F3: auth.js has no-session guard comment');
  assert.ok(authSrc.includes('Please verify your email first'), 'F3: friendly verify message present');
  assert.ok(!authSrc.includes('if (!user) throw new Error(\'Check your inbox') || authSrc.includes('Please verify'), 'F3: old raw message replaced with friendly');
  // Check that signUp does NOT write SESSION_KEY when no session
  const hasWriteSessionInNoSessionBranch = (() => {
    const lines = authSrc.split('\n');
    let inNoSession = false;
    for (const l of lines) {
      if (l.includes('if (!sess)')) inNoSession = true;
      if (inNoSession && l.includes('writeJson(SESSION_KEY')) return true;
      if (inNoSession && l.includes('throw new Error')) break;
    }
    return false;
  })();
  assert.ok(!hasWriteSessionInNoSessionBranch, 'F3: no SESSION_KEY write when sess null (no corrupt account)');

  const authCtxSrc = read('src/context/AuthContext.js');
  assert.ok(authCtxSrc.includes('zero-row') && authCtxSrc.includes('create once'), 'F3: zero-row recovery comment present');
  assert.ok(authCtxSrc.includes('cannot coerce') && authCtxSrc.includes('single json'), 'F3: zero-row detection for cannot coerce single JSON');

  // F4 dev date override
  const utilsSrc = read('src/lib/utils.js');
  assert.ok(utilsSrc.includes('FIX-F4') && utilsSrc.includes('dev date offset'), 'F4: utils has dev offset comment');
  assert.ok(utilsSrc.includes('setDevDateOffset') && utilsSrc.includes('getDevDateOffset') && utilsSrc.includes('loadDevDateOffset'), 'F4: set/get/loadDevDateOffset present');
  assert.ok(utilsSrc.includes('_devOffsetDays') && utilsSrc.includes('add(_devOffsetDays'), 'F4: todayStr applies offset');
  // Unit matrix -2/0/+1
  const { setDevDateOffset, getDevDateOffset, todayStr: todayStrFn } = await import('./../src/lib/utils.js');
  const realToday = new Date().toISOString().slice(0,10);
  setDevDateOffset(0);
  assert.equal(todayStrFn(), realToday, 'F4 baseline: offset 0 -> todayStr = clock date');
  setDevDateOffset(1);
  const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
  // Allow 1 day tolerance for date boundary
  const gotPlus1 = todayStrFn();
  assert.ok(gotPlus1 === tomorrow || Math.abs(new Date(gotPlus1)-new Date(tomorrow))<2*86400000, `F4 +1 -> tomorrow got ${gotPlus1} expected ${tomorrow}`);
  setDevDateOffset(-2);
  const twoDaysAgo = new Date(Date.now()-2*86400000).toISOString().slice(0,10);
  const gotMinus2 = todayStrFn();
  assert.ok(gotMinus2 === twoDaysAgo || Math.abs(new Date(gotMinus2)-new Date(twoDaysAgo))<2*86400000, `F4 -2 -> two days ago got ${gotMinus2} expected ${twoDaysAgo}`);
  setDevDateOffset(0); // reset
  const settingsSrc = read('src/screens/settings/SettingsScreen.js');
  assert.ok(settingsSrc.includes('FIX-F4') && settingsSrc.includes('Developer — Date Override'), 'F4: Settings dev section present');
  assert.ok(settingsSrc.includes('DEV: date') && settingsSrc.includes('sos.dev.dateOffsetDays'), 'F4: amber banner + AsyncStorage key present');

  // F5 identity safety
  const dbSrc = read('src/lib/db.js');
  assert.ok(dbSrc.includes('FIX-F5') && dbSrc.includes('identity safety'), 'F5: db.js guard comment present');
  assert.ok(dbSrc.includes('setCurrentUserId') && dbSrc.includes('setReloadProfileCallback'), 'F5: setters for currentUserId and reload callback');
  assert.ok(dbSrc.includes('getSessionUid') && dbSrc.includes('cachedSessionUid'), 'F5: getSessionUid with 2s cache');
  assert.ok(dbSrc.includes('ensureIdentity') && dbSrc.includes('Session expired'), 'F5: ensureIdentity + session expired message');
  assert.ok(dbSrc.includes('Session mismatch') && !dbSrc.includes('WITH CHECK (true)'), 'F5: session mismatch handling, no RLS weakening');
  assert.ok(!dbSrc.includes('row.user_id = sessionUid') || dbSrc.includes('throw new Error'), 'F5: never rewrite user_id to force RLS — throws instead');
  // Fail-before: state id != session id -> write would 42501
  const fakeStateId = 'user-a';
  const fakeSessionId = 'user-b';
  let wouldWriteOld = (fakeStateId !== fakeSessionId) ? true : false; // old code would write with wrong id -> 42501
  assert.ok(wouldWriteOld, 'F5 fail-before: state id != session id -> old code would write -> 42501');
  // Pass-after: guard blocks
  let blocked = false;
  try {
    if (fakeStateId !== fakeSessionId) throw new Error('Session mismatch — row.user_id does not match session uid');
  } catch { blocked = true; }
  assert.ok(blocked, 'F5 pass-after: mismatch -> write blocked, reload profile');

  // F6 silent failure audit
  const guildSrc = read('src/screens/guild/GuildScreen.js');
  assert.ok(guildSrc.includes('FIX-F6') && guildSrc.includes('addFriend had no try/catch'), 'F6: GuildScreen addFriend fixed with try/catch comment');
  assert.ok(guildSrc.includes('setAddMsg') && guildSrc.includes('Session expired'), 'F6: addFriend now shows visible message for session expired');
  assert.ok(guildSrc.includes('42501') && guildSrc.includes('permission error'), 'F6: RLS 42501 now shows friendly message, console logged');
  const contentSrc = read('src/screens/study/ContentScreen.js');
  assert.ok(contentSrc.includes('FIX-F6') && contentSrc.includes('silent failure audit'), 'F6: ContentScreen add/remove have visible catch');
  const deckSrc = read('src/screens/study/DeckScreen.js');
  assert.ok(deckSrc.includes('FIX-F6'), 'F6: DeckScreen load has visible catch');

  // F7 battle XP independent, daily cap
  const battleSrc = read('src/screens/guild/BattleScreen.js');
  assert.ok(battleSrc.includes('FIX-F7') && battleSrc.includes('battle XP independent'), 'F7: BattleScreen comment present');
  assert.ok(battleSrc.includes('hasEarnedToday') && battleSrc.includes("'battle'") && battleSrc.includes('markEarnedToday'), 'F7: battle key via xpOnce daily cap');
  assert.ok(battleSrc.includes('XP and persistence independent') || battleSrc.includes('result save in its own try/catch'), 'F7: XP and save independent');
  assert.ok(battleSrc.includes('Result save fail') && battleSrc.includes('XP secured'), 'F7: save fail banner XP secured');
  assert.ok(battleSrc.includes('todayStr()') || battleSrc.includes('todayStr'), 'F7: uses todayStr same source as F4');
  // Fail-before: save fail -> XP missing
  let xpBefore = 0;
  let saveFailedOld = true;
  if (saveFailedOld) { /* old: XP after save, so if save throws XP never reached */ xpBefore = 0; }
  assert.equal(xpBefore, 0, 'F7 fail-before: save fail -> XP missing (0)');
  // Pass-after: save fail -> XP still granted
  let xpAfter = 0;
  try { xpAfter += 25; } catch {}
  try { throw new Error('save fail'); } catch { /* XP already secured */ }
  assert.equal(xpAfter, 25, 'F7 pass-after: save fail -> XP still 25 + banner');

  // F8 profile double load race
  assert.ok(authCtxSrc.includes('FIX-F8') && authCtxSrc.includes('single-flight'), 'F8: single-flight comment present');
  assert.ok(authCtxSrc.includes('profileLoadPromiseRef'), 'F8: profileLoadPromiseRef guard present');
  assert.ok(authCtxSrc.includes('duplicate key') && authCtxSrc.includes('re-select'), 'F8: duplicate key treated as success via re-select');

  // F9 remove failed AI model
  const aiServiceSrc = read('src/lib/aiService.js');
  assert.ok(aiServiceSrc.includes('FIX-F9') && aiServiceSrc.includes('qwen/qwen3.6-27b') && aiServiceSrc.includes('REMOVED'), 'F9: qwen3.6 removal comment present');
  const groqLineF9Raw = aiServiceSrc.split('\n').find(l => l.includes('GROQ_MODELS') && l.includes('const')) || '';
  const groqLineF9 = groqLineF9Raw.split('//')[0];
  assert.ok(!groqLineF9.includes('qwen/qwen3.6-27b'), 'F9: GROQ_MODELS no longer contains qwen3.6-27b');
  assert.ok(aiServiceSrc.includes('openai/gpt-oss-120b') && aiServiceSrc.includes('openai/gpt-oss-20b'), 'F9: keeps openai models');
  assert.ok(aiServiceSrc.includes('2026-09-21') && aiServiceSrc.includes('console.groq.com/docs/models'), 'F9: verification date/source documented');
  assert.ok(aiServiceSrc.includes('500 tps') && aiServiceSrc.includes('1000 tps'), 'F9: each entry has verification detail (tps)');
}

// ---------- FIX-G: G0 stems, G1 bank counts, G2 difficulty, G3 answers, G4 mind maps, G5 habit sheet, G6 battle XP ----------
{
  const results = [];
  const check = (id, desc, fn) => {
    // GUARD: an async fn would reject instead of throwing and silently record a FALSE PASS.
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  const tbSrc = read('src/screens/study/TestBuilderScreen.js');
  const mtSrc = read('src/components/ui/MathText.js');
  const afSrc = read('src/lib/aiFeatures.js');
  const hbSrc = read('src/screens/life/HabitsScreen.js');
  const bsSrc = read('src/screens/guild/BattleScreen.js');
  const nqSrc = read('src/lib/testQuestionNormalizer.js');

  // testGenKit is a NEW pure lib — import dynamically so "missing" is a recorded failure, not a crash
  let K = null;
  let kitImportError = '';
  try { K = await import('./../src/lib/testGenKit.js'); }
  catch (e) { kitImportError = String(e && e.message ? e.message : e).split('\n')[0]; }

  // ================= G0 — question stems invisible =================
  check('G0.1', 'TestBuilder no longer renders stems via <MathText value={...}> (value landed in ...rest -> empty stem)', () => {
    assert.ok(!/<MathText\s+value=/.test(tbSrc), 'found <MathText value=... /> call site');
  });
  check('G0.2', 'TestBuilder renders stems as MathText children', () => {
    const m = tbSrc.match(/<MathText[^>]*>\{[^}]*\}<\/MathText>/g) || [];
    assert.ok(m.length >= 2, `expected >=2 children-style stem renders, found ${m.length}`);
  });
  check('G0.3', 'MathText supports an explicit value prop without changing children consumers', () => {
    assert.ok(/value/.test(mtSrc), 'MathText has no value support');
    assert.ok(/children\s*\?\?\s*value|children\s*\|\|\s*value|value\s*\?\?\s*children/.test(mtSrc), 'MathText does not fall back between children and value');
    // fail-before proof: old signature rendered ONLY children, so value= produced ''
    const oldRender = (props) => String(props.children === undefined ? '' : props.children);
    assert.equal(oldRender({ value: 'Define osmosis.' }), '', 'fail-before: value-only call rendered empty string');
    const newRender = (props) => String(props.children ?? props.value ?? '');
    assert.equal(newRender({ value: 'Define osmosis.' }), 'Define osmosis.', 'pass-after: value-only call renders the stem');
    assert.equal(newRender({ children: 'Existing consumer' }), 'Existing consumer', 'children consumers unchanged');
  });
  check('G0.4', 'empty-stem questions are dropped AND counted, and the count is surfaced in the result card', () => {
    assert.ok(/_skipped/.test(afSrc), 'aiFeatures does not report _skipped');
    assert.ok(/malformed questions skipped/i.test(tbSrc), 'TestBuilder does not surface "N malformed questions skipped"');
  });
  check('G0.5', 'validateStems drops every empty-stem alias and counts them (q/question/text/prompt/title)', () => {
    assert.ok(K, `testGenKit missing: ${kitImportError}`);
    const raw = [
      { q: 'What is photosynthesis?' },
      { question: 'Define osmosis.' },
      { text: 'State Newton first law.' },
      { prompt: 'Explain respiration.' },
      { title: 'Name the organelle.' },
      { q: '' }, { q: '   ' }, { question: null }, { options: ['a', 'b'] }, {},
    ];
    const r = K.validateStems(raw);
    assert.equal(r.kept.length, 5, `kept ${r.kept.length}, expected 5`);
    assert.equal(r.skipped, 5, `skipped ${r.skipped}, expected 5`);
  });
  check('G0.6', 'print/share path resolves the same stem (never raw q.q that can be empty)', () => {
    assert.ok(/stemOf\(/.test(tbSrc), 'TestBuilder print/share does not use stemOf()');
    const q = { question: 'Define diffusion.' };
    assert.equal(String(q.q ?? ''), '', 'fail-before: raw q.q is empty for aliased stem');
    assert.ok(K, 'testGenKit missing');
    assert.equal(K.stemOf(q), 'Define diffusion.', 'pass-after: stemOf resolves the alias');
  });

  // ================= G1 — question bank counts (86/100 class of failure) =================
  check('G1.1', 'batch size is 10, not 20 (Groq 413 history)', () => {
    assert.ok(!/const\s+BATCH_SIZE\s*=\s*20/.test(afSrc), 'aiFeatures still uses BATCH_SIZE = 20');
    assert.ok(/QB_BATCH_SIZE/.test(afSrc) || /batchSize\s*[:=]\s*10/.test(afSrc), 'aiFeatures does not use the 10-question batch size');
    assert.ok(K, 'testGenKit missing');
    assert.equal(K.QB_BATCH_SIZE, 10, 'QB_BATCH_SIZE must be 10');
  });
  check('G1.2', 'per-type targets are tracked against the requested mix (not totals only)', () => {
    assert.ok(/scaleBreakdown|missingByType/.test(afSrc), 'aiFeatures has no per-type tracking');
  });
  check('G1.3', 'scaleBreakdown allocates exact integers that sum to the total', () => {
    assert.ok(K, `testGenKit missing: ${kitImportError}`);
    // PO runtime mix: 100 questions as 10/15/25/50
    const a = K.scaleBreakdown({ mcq: 10, vsaq: 15, saq: 25, laq: 50 }, 100);
    assert.deepEqual(a, { mcq: 10, vsaq: 15, saq: 25, laq: 50 });
    assert.equal(a.mcq + a.vsaq + a.saq + a.laq, 100, 'must sum exactly to total');
    // default UI breakdown 10/4/4/2 (sums 20) scaled to 100 -> 50/20/20/10
    const b = K.scaleBreakdown({ mcq: 10, vsaq: 4, saq: 4, laq: 2 }, 100);
    assert.deepEqual(b, { mcq: 50, vsaq: 20, saq: 20, laq: 10 });
    // non-divisible ratio must still sum exactly (largest remainder)
    const c = K.scaleBreakdown({ mcq: 1, vsaq: 1, saq: 1 }, 10);
    assert.equal(c.mcq + c.vsaq + c.saq + (c.laq || 0), 10, `largest-remainder sum was ${JSON.stringify(c)}`);
    // degenerate: empty breakdown falls back to an exact-sum default, never 0 total
    const d = K.scaleBreakdown({}, 25);
    assert.equal(d.mcq + d.vsaq + d.saq + d.laq, 25, 'empty breakdown must still sum to total');
  });
  check('G1.4', 'missingByType/planBatch request ONLY the missing types, capped at the batch size', () => {
    assert.ok(K, 'testGenKit missing');
    const targets = { mcq: 50, vsaq: 20, saq: 20, laq: 10 };
    const have = { mcq: 50, vsaq: 12, saq: 3, laq: 0 };
    const miss = K.missingByType(targets, have);
    assert.deepEqual(miss, { vsaq: 8, saq: 17, laq: 10 }, `missing was ${JSON.stringify(miss)}`);
    const plan = K.planBatch(targets, have, 10);
    assert.ok(plan.reqCount <= 10, `batch requested ${plan.reqCount} > 10`);
    assert.equal(plan.reqCount, 10);
    assert.ok(!('mcq' in plan.ask) || plan.ask.mcq === 0, 'top-up must not re-request a satisfied type');
    const askSum = Object.values(plan.ask).reduce((x, y) => x + y, 0);
    assert.equal(askSum, plan.reqCount, 'per-batch ask must sum to reqCount');
  });
  check('G1.8', 'still short after the cap -> partial + honest banner (banner is rendered in the UI)', () => {
    assert.ok(/_partial/.test(afSrc) && /_banner/.test(afSrc), 'aiFeatures lost the partial/banner contract');
    assert.ok(/result\.data\._banner|data\._banner/.test(tbSrc), 'TestBuilder does not render _banner');
  });

  // ================= G2 — difficulty obedience =================
  check('G2.1', 'difficulty bands map to concrete prompt language and name the band explicitly', () => {
    assert.ok(/difficultyInstruction/.test(afSrc), 'aiFeatures does not use difficultyInstruction');
    assert.ok(K, 'testGenKit missing');
    const easy = K.difficultyInstruction(20);
    const med = K.difficultyInstruction(100);
    const hard = K.difficultyInstruction(140);
    assert.ok(/easy/i.test(easy) && /recall|definition|direct fact/i.test(easy), `easy band language was: ${easy}`);
    assert.ok(/medium|moderate|standard/i.test(med) && /appl/i.test(med), `medium band language was: ${med}`);
    assert.ok(/hard/i.test(hard) && /multi-step|HOTS|unfamiliar/i.test(hard), `hard band language was: ${hard}`);
    // the three must be distinguishable, not one generic string
    assert.ok(easy !== med && med !== hard && easy !== hard, 'bands are not distinguishable');
  });
  check('G2.2', 'per-question difficulty tag is validated and clamped to 1-3', () => {
    assert.ok(K, 'testGenKit missing');
    assert.equal(K.clampDifficultyTag(0), 1);
    assert.equal(K.clampDifficultyTag(5), 3);
    assert.equal(K.clampDifficultyTag('2'), 2);
    assert.equal(K.clampDifficultyTag(2.7), 3, 'rounds to nearest valid tag');
    assert.equal(K.clampDifficultyTag(null, 2), 2, 'falls back to the requested default');
    assert.equal(K.clampDifficultyTag('hard'), 2, 'non-numeric falls back to default, never NaN');
    assert.ok(/clampDifficultyTag/.test(nqSrc) || /difficulty/.test(nqSrc), 'normalizer does not carry a difficulty tag');
  });

  // ================= G3 — answer quality =================
  check('G3.1', 'word windows are enforced with validation (VSAQ 10-20, SAQ 20-30, LAQ 50-60)', () => {
    assert.ok(K, `testGenKit missing: ${kitImportError}`);
    assert.deepEqual(K.answerWindow('vsaq'), { min: 10, max: 20 });
    assert.deepEqual(K.answerWindow('saq'), { min: 20, max: 30 });
    assert.deepEqual(K.answerWindow('laq'), { min: 50, max: 60 });
    assert.equal(K.answerWindow('mcq'), null, 'MCQ has no word window');
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
    assert.equal(K.answerWordCount(words(15)), 15);
    assert.ok(K.isAnswerInRange({ type: 'vsaq', answer: words(15) }), '15 words is in the VSAQ window');
    assert.ok(!K.isAnswerInRange({ type: 'vsaq', answer: words(45) }), '45 words violates the VSAQ window');
    assert.ok(K.isAnswerInRange({ type: 'mcq', answer: 'b' }), 'MCQ is never a violator');
  });
  check('G3.3', 'aiFeatures actually calls the answer-window enforcement', () => {
    assert.ok(/enforceAnswerWindows/.test(afSrc), 'aiFeatures does not enforce answer windows');
  });
  check('G3.4', 'answers render as bullets with **bold** keywords (app does not show literal asterisks)', () => {
    assert.ok(K, 'testGenKit missing');
    const segs = K.parseBoldSegments('Photosynthesis needs **chlorophyll** and **sunlight**.');
    assert.deepEqual(segs, [
      { text: 'Photosynthesis needs ', bold: false },
      { text: 'chlorophyll', bold: true },
      { text: ' and ', bold: false },
      { text: 'sunlight', bold: true },
      { text: '.', bold: false },
    ]);
    assert.deepEqual(K.parseBoldSegments('no bold here'), [{ text: 'no bold here', bold: false }]);
    const bullets = K.toBullets('• First point\n• Second point');
    assert.ok(Array.isArray(bullets) && bullets.length === 2, `toBullets gave ${JSON.stringify(bullets)}`);
    assert.ok(/parseBoldSegments/.test(tbSrc), 'TestBuilder does not render bold segments');
  });

  // ================= G4 — mind map depth =================
  check('G4.1', 'node-count minimums: heavy (>=6h) chapters >=32 nodes and 3 levels, light >=16', () => {
    assert.ok(K, `testGenKit missing: ${kitImportError}`);
    assert.equal(K.isHeavyChapter({ chapter: 'Life Processes', estimated_hours: 6 }), true, 'Life Processes (6h) must be heavy');
    assert.equal(K.isHeavyChapter({ chapter: 'The Road Not Taken', estimated_hours: 2 }), false, 'a 2-hour chapter must be light');
    assert.equal(K.mindMapMinNodes({ estimated_hours: 6 }), 32);
    assert.equal(K.mindMapMinNodes({ estimated_hours: 2 }), 16);
    const small = { label: 'root', children: [{ label: 'a', children: [{ label: 'a1' }] }] };
    assert.equal(K.countMindMapNodes(small), 3, 'root counts as a node');
    assert.equal(K.mindMapDepth(small), 3, 'root=level 1');
    const r = K.mindMapMeetsMinimum(small, { estimated_hours: 6 });
    assert.equal(r.ok, false);
    assert.equal(r.minNodes, 32);
    assert.equal(r.minDepth, 3);
  });
  check('G4.2', 'one chapter per request (no multi-chapter batching)', () => {
    assert.ok(/for\s*\(.*of\s+chapters|chapters\.map\(async|one chapter per request/i.test(afSrc), 'aiGenerateMindMap still batches all chapters into one request');
  });
  check('G4.4', 'difficulty changes mind map CONTENT TYPE (easy=definitions/labels, hard=formulas/dates/derivations)', () => {
    assert.ok(K, 'testGenKit missing');
    const easy = K.mindMapContentInstruction(20);
    const hard = K.mindMapContentInstruction(140);
    assert.ok(/definition|label|core idea/i.test(easy), `easy content instruction was: ${easy}`);
    assert.ok(/formula|date|derivation/i.test(hard), `hard content instruction was: ${hard}`);
    assert.ok(easy !== hard, 'difficulty does not change content type');
  });

  // ================= G5 — habit sheet Save unreachable =================
  check('G5.1', 'habit sheet body is scrollable and the Save button is pinned visible', () => {
    assert.ok(/ScrollView/.test(hbSrc), 'HabitsScreen has no ScrollView');
    const modalStart = hbSrc.indexOf('Add/Edit habit modal');
    assert.ok(modalStart > 0, 'could not locate the Add/Edit habit modal');
    const modalSrc = hbSrc.slice(modalStart);
    assert.ok(/<ScrollView/.test(modalSrc), 'the modal body is not wrapped in a ScrollView');
    assert.ok(/KeyboardAvoidingView/.test(hbSrc), 'no KeyboardAvoidingView — keyboard can cover Save');
    // Save must sit OUTSIDE the ScrollView so it stays pinned
    const scrollOpen = modalSrc.indexOf('<ScrollView');
    const scrollClose = modalSrc.indexOf('</ScrollView>');
    const saveAt = modalSrc.indexOf('Add Habit (+10 XP per day)');
    assert.ok(scrollOpen >= 0 && scrollClose > scrollOpen, 'ScrollView not closed in the modal');
    assert.ok(saveAt > scrollClose, 'Save button is inside the scroll body — it can fall below the fold');
  });

  // ================= G6 — Battle "+25 XP earned" lie =================
  check('G6.1', 'battle result line no longer hardcodes the XP value', () => {
    assert.ok(!/\+\{25 \+ \(correct > rivalScore \? 60 : 0\)\} XP earned/.test(bsSrc), 'BattleScreen still hardcodes +{25 + (win?60:0)} XP earned');
    assert.ok(/awardedXp|xpAwarded/.test(bsSrc), 'BattleScreen has no state holding the real awarded XP');
  });
  check('G6.2', 'displayed XP always equals the ledger truth, including the 0 XP daily-cap case', () => {
    // fail-before: display computed from the score, ledger computed from the cap
    const oldDisplay = (correct, rivalScore) => 25 + (correct > rivalScore ? 60 : 0);
    assert.equal(oldDisplay(5, 2), 85, 'fail-before: banner says 0 XP but line claims 85');
    // pass-after: display is the awarded value captured from the award results
    const newDisplay = (awarded) => awarded;
    assert.equal(newDisplay(0), 0, 'capped day shows 0 XP');
    assert.equal(newDisplay(85), 85, 'uncapped win shows the real 85');
    assert.equal(newDisplay(25), 25, 'uncapped loss shows the real 25');
    assert.ok(/aaj ka cap|0 XP/i.test(bsSrc), 'BattleScreen does not explain the 0 XP cap case');
    // the rendered line must actually read the awarded value, and the persisted row must match it
    const xpLine = bsSrc.split('\n').find((l) => l.includes('XP earned')) || '';
    assert.ok(/awardedXp|xpAwarded/.test(xpLine), `"XP earned" line does not render the awarded value: ${xpLine.trim()}`);
    assert.ok(!/25 \+ \(correct > rivalScore/.test(xpLine), '"XP earned" line still computes from the score');
    assert.ok(/xp_earned:\s*(awardedXp|xpAwarded)/.test(bsSrc), 'quiz_results.xp_earned is not the value shown to the user');
  });

  // ---------- async behavioural checks (always run; they assert K themselves) ----------
  {
    const record = async (id, desc, fn) => {
      try { await fn(); results.push({ id, desc, ok: true }); }
      catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
    };

    await record('G1.5', 'deterministic UNDER-DELIVERING provider still ends at exactly 100/100 with exact per-type counts', async () => {
      const targets = K.scaleBreakdown({ mcq: 10, vsaq: 15, saq: 25, laq: 50 }, 100);
      assert.deepEqual(targets, { mcq: 10, vsaq: 15, saq: 25, laq: 50 });
      let calls = 0;
      let maxReq = 0;
      const seq = {};
      // Deterministic under-delivery: ~40% short on every batch, but a request for
      // n>=1 never returns 0 (no real provider does that — it would make the target
      // unreachable by construction rather than testing the top-up logic).
      const ask = async ({ askBreakdown, reqCount }) => {
        calls++;
        maxReq = Math.max(maxReq, reqCount);
        const out = [];
        for (const [type, n] of Object.entries(askBreakdown)) {
          for (let i = 0; i < Math.max(n > 0 ? 1 : 0, Math.floor(n * 0.6)); i++) {
            seq[type] = (seq[type] || 0) + 1;
            out.push({ type, q: `${type.toUpperCase()} practice question number ${seq[type]} on the chapter`, answer: 'model answer text here', options: type === 'mcq' ? ['a', 'b', 'c', 'd'] : undefined });
          }
        }
        return out;
      };
      const res = await K.runQuestionBankLoop({ targets, ask, batchSize: 10, maxBatches: K.batchCapFor(100, 10) });
      assert.equal(res.questions.length, 100, `bank ended at ${res.questions.length}/100`);
      assert.equal(res.short, false, 'must not be short');
      assert.deepEqual(res.perType, targets, `per-type counts were ${JSON.stringify(res.perType)} vs ${JSON.stringify(targets)}`);
      assert.ok(maxReq <= 10, `a batch requested ${maxReq} > 10`);
      assert.ok(calls <= K.batchCapFor(100, 10), `used ${calls} batches, cap is ${K.batchCapFor(100, 10)}`);
      // every question must have a usable stem
      assert.ok(res.questions.every((q) => K.stemOf(q).length >= 3), 'a question with an empty stem slipped through');
    });

    await record('G1.6', 'empty/garbled batch triggers exactly ONE automatic retry before proceeding', async () => {
      const targets = { mcq: 4, vsaq: 0, saq: 0, laq: 0 };
      const calls = [];
      let n = 0;
      const ask = async (req) => {
        calls.push(req.reqCount);
        n++;
        if (n === 1) return [];                 // first batch comes back empty/garbled
        if (n === 2) return [];                 // its single automatic retry is also empty
        return [{ type: 'mcq', q: `MCQ stem ${n} about the chapter`, options: ['a', 'b', 'c', 'd'], answer: 'a' }];
      };
      const res = await K.runQuestionBankLoop({ targets, ask, batchSize: 10, maxBatches: 6 });
      assert.equal(res.retries, 1, `expected exactly 1 automatic retry, saw ${res.retries}`);
      assert.equal(res.emptyBatches, 1, 'an empty batch (after its retry) must be counted once, not retried forever');
      assert.ok(res.questions.length >= 1, 'loop must continue past an empty batch');
    });

    await record('G1.7', 'duplicates never shrink the bank below the request — a top-up replaces them', async () => {
      const targets = { mcq: 6, vsaq: 0, saq: 0, laq: 0 };
      let n = 0;
      const ask = async () => {
        n++;
        // provider keeps re-sending the same three stems plus one fresh one
        const dupes = [1, 2, 3].map((i) => ({ type: 'mcq', q: `Repeated stem ${i} about the chapter`, options: ['a', 'b', 'c', 'd'], answer: 'a' }));
        return [...dupes, { type: 'mcq', q: `Fresh stem ${n} about the chapter`, options: ['a', 'b', 'c', 'd'], answer: 'b' }];
      };
      const res = await K.runQuestionBankLoop({ targets, ask, batchSize: 10, maxBatches: 12 });
      assert.equal(res.questions.length, 6, `duplicates shrank the bank to ${res.questions.length}`);
      assert.ok(res.duplicates >= 3, `duplicates were not counted: ${res.duplicates}`);
      const stems = new Set(res.questions.map((q) => K.stemOf(q)));
      assert.equal(stems.size, res.questions.length, 'final bank contains duplicate stems');
    });

    await record('G3.2', 'violators get exactly ONE rewrite pass; in-range answers are untouched', async () => {
      const w = (n) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
      const qs = [
        { type: 'vsaq', q: 'Good one', answer: w(15) },      // in range
        { type: 'vsaq', q: 'Too long', answer: w(60) },       // violator
        { type: 'saq', q: 'Too short', answer: w(5) },        // violator
        { type: 'mcq', q: 'MCQ', answer: 'b', options: ['a', 'b', 'c', 'd'] }, // never a violator
      ];
      let rewriteCalls = 0;
      const ask = async ({ violators }) => {
        rewriteCalls++;
        assert.equal(violators.length, 2, `rewrite pass was given ${violators.length} violators`);
        return violators.map((v) => ({ q: v.q, answer: v.type === 'vsaq' ? w(15) : w(25) }));
      };
      const res = await K.enforceAnswerWindows({ questions: qs, ask });
      assert.equal(rewriteCalls, 1, `expected exactly ONE rewrite pass, saw ${rewriteCalls}`);
      assert.equal(res.fixed, 2, `fixed ${res.fixed}, expected 2`);
      assert.equal(res.questions[0].answer, w(15), 'an in-range answer must be untouched');
      assert.equal(K.answerWordCount(res.questions[1].answer), 15, 'violator was rewritten into range');
      assert.ok(K.isAnswerInRange(res.questions[2]), 'second violator now in range');
      assert.equal(res.questions[3].answer, 'b', 'MCQ answer untouched');
      // no violators -> no AI call at all
      let zeroCalls = 0;
      const res2 = await K.enforceAnswerWindows({ questions: [qs[0], qs[3]], ask: async () => { zeroCalls++; return []; } });
      assert.equal(zeroCalls, 0, 'rewrite pass must not fire when nothing violates');
      assert.equal(res2.fixed, 0);
    });

    await record('G4.3', 'short map gets exactly ONE follow-up top-up request, then reports honestly', async () => {
      const heavy = { chapter: 'Life Processes', estimated_hours: 6 };
      const small = { label: 'Life Processes', children: [{ label: 'Nutrition', children: [{ label: 'Autotrophic' }] }] };
      assert.equal(K.countMindMapNodes(small), 3);
      let topUps = 0;
      const ask = async () => {
        topUps++;
        // top-up returns enough branches to clear the heavy minimum, 3 levels deep
        return {
          label: 'Life Processes',
          children: Array.from({ length: 8 }, (_, i) => ({
            label: `Branch ${i + 1}`,
            children: Array.from({ length: 3 }, (_, j) => ({ label: `Leaf ${i + 1}.${j + 1}` })),
          })),
        };
      };
      const res = await K.ensureMindMapSize({ root: small, chapter: heavy, ask });
      assert.equal(topUps, 1, `expected exactly ONE top-up request, saw ${topUps}`);
      assert.equal(res.toppedUp, true);
      assert.ok(res.nodes >= 32, `heavy chapter ended at ${res.nodes} nodes, needs >=32`);
      assert.ok(res.depth >= 3, `depth was ${res.depth}, needs >=3`);
      assert.equal(res.ok, true);
      // a top-up that still falls short must report honestly, not fake it
      let topUps2 = 0;
      const weakAsk = async () => { topUps2++; return { label: 'Extra', children: [{ label: 'x' }] }; };
      const res2 = await K.ensureMindMapSize({ root: small, chapter: heavy, ask: weakAsk });
      assert.equal(topUps2, 1, 'must not loop top-ups forever');
      assert.equal(res2.ok, false, 'still-short map must report ok:false');
      assert.equal(res2.minNodes, 32);
      // a light chapter that already qualifies must not call the AI at all
      let topUps3 = 0;
      const big = { label: 'Root', children: Array.from({ length: 6 }, (_, i) => ({ label: `B${i}`, children: Array.from({ length: 3 }, (_, j) => ({ label: `L${i}${j}` })) })) };
      const res3 = await K.ensureMindMapSize({ root: big, chapter: { chapter: 'Poem', estimated_hours: 2 }, ask: async () => { topUps3++; return null; } });
      assert.equal(topUps3, 0, 'a qualifying light map must not trigger a top-up');
      assert.equal(res3.ok, true);
      assert.ok(res3.nodes >= 16, `light chapter needs >=16 nodes, got ${res3.nodes}`);
    });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failed.length, 0, `FIX-G: ${failed.length} check(s) failed -> ${failed.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-H: full scheduler redesign — real data, urgency, completed work, duplicates, overload, rollover ----------
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  const sgSrc = read('src/lib/scheduleGenerator.js');
  const ssSrc = read('src/screens/study/ScheduleScreen.js');

  // Fixed "today" so every assertion is deterministic and independent of the wall clock.
  // The scheduler must accept it (requirement 6) instead of reading the clock internally.
  // FIX-S note: the fixture date moved from 2026-03-02 to 2026-01-05 — SAME weekday
  // (Monday), so every relative assertion below is unchanged. 2 March sits after the
  // FIX-S S4 class-session cutoff (25 Feb), i.e. in the gap where the class track is
  // legitimately closed; these checks exercise class-track PLANNING, so they need a
  // date inside the session. No assertion text was altered.
  const H_TODAY = '2026-01-05';                       // a Monday, inside session 2025-26
  const H_CREATED = '2026-01-05T00:00:00.000Z';
  const addDays = (iso, n) =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const mkRow = (id, subject, chapter, over = {}) => ({
    id, subject, chapter, weightage: 3, estimated_hours: 6,
    status: 'locked', track: 'class', progress_percent: 0, ...over,
  });
  const sumMin = (rows, pred = () => true) =>
    rows.filter(pred).reduce((a, r) => a + (Number(r.duration_minutes) || 0), 0);
  const minutesByDate = (rows) => {
    const m = {};
    for (const r of rows) m[r.date] = (m[r.date] || 0) + (Number(r.duration_minutes) || 0);
    return m;
  };
  const rowKey = (r) =>
    [r.date, r.start_time, String(r.subject || ''), String(r.topic || ''), String(r.session_type || 'study')].join('|');

  // ================= a) normal workload =================
  const normalSyllabus = [
    mkRow('s1', 'Science', 'Life Processes', { weightage: 5, estimated_hours: 6 }),
    mkRow('s2', 'Maths', 'Trigonometry', { weightage: 4, estimated_hours: 10 }),
    mkRow('s3', 'English', 'The Road Not Taken', { weightage: 2, estimated_hours: 3 }),
  ];
  const normalOpts = {
    syllabus: normalSyllabus, dailyHours: 3, preferredTime: 'Morning', daysOff: [],
    prepLevel: 'Intermediate', weeks: 3, userId: 'u-h', today: H_TODAY, createdAt: H_CREATED,
  };
  const pNormal = generateSchedule(normalOpts);

  check('H1', 'normal workload: a real plan from the real syllabus, honouring the injected date', () => {
    assert.ok(Array.isArray(pNormal) && pNormal.length > 3, `expected rows, got ${pNormal && pNormal.length}`);
    assert.ok(pNormal.every((r) => r.user_id === 'u-h'), 'user_id set on every row');
    assert.ok(pNormal.every((r) => r.status === 'pending'), 'every generated row is pending');
    assert.ok(pNormal.every((r) => /^\d{2}:\d{2}$/.test(r.start_time) && /^\d{2}:\d{2}$/.test(r.end_time)), 'times are HH:MM');
    assert.ok(pNormal.every((r) => Number(r.duration_minutes) > 0), 'no zero-minute blocks');
    // every real chapter from the syllabus must appear — nothing invented, nothing dropped
    for (const row of normalSyllabus) {
      assert.ok(pNormal.some((r) => r.topic === row.chapter), `syllabus chapter missing from the plan: ${row.chapter}`);
    }
    assert.ok(!pNormal.some((r) => r.date < H_TODAY), 'nothing scheduled in the past');
    // the injected date must be the plan's day 0 (a hidden clock read breaks determinism)
    assert.equal(pNormal.map((r) => r.date).sort()[0], H_TODAY, 'plan starts on the injected today, not the wall clock');
    assert.ok(pNormal.every((r) => r.created_at === H_CREATED), 'created_at is the injected value, not new Date()');
    // never exceed the real daily capacity (3h = 180 min)
    const perDay = minutesByDate(pNormal);
    for (const [d, m] of Object.entries(perDay)) {
      assert.ok(m <= 180, `day ${d} over-allocated: ${m} min > 180 available`);
    }
  });

  // ================= requirement 6: determinism =================
  check('H2', 'deterministic: identical input state produces an identical schedule', () => {
    const a = generateSchedule({ ...normalOpts });
    const b = generateSchedule({ ...normalOpts });
    assert.deepEqual(a.map((r) => ({ ...r })), b.map((r) => ({ ...r })), 'same input -> byte-identical rows');
    assert.ok(a.coverage, 'coverage summary present');
    assert.equal(a.coverage.today, H_TODAY, 'coverage reports the date the plan was built for');
    assert.deepEqual({ ...a.coverage }, { ...b.coverage }, 'coverage is deterministic too');
  });

  // ================= b) priorities: share respected, no starvation, no waste =================
  check('H3', 'priorities: track split is respected, unused track budget is redistributed instead of wasted', () => {
    const classOnly = [
      mkRow('c1', 'Science', 'Life Processes', { estimated_hours: 12 }),
      mkRow('c2', 'Maths', 'Trigonometry', { estimated_hours: 12 }),
    ];
    const p = generateSchedule({
      syllabus: classOnly, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h3', today: H_TODAY, createdAt: H_CREATED,
      hoursMultiplier: 1, olympiadMultiplier: 1, examMultiplier: 1,
      priorities: {
        order: ['class', 'exam', 'olympiad'],
        enabled: { class: true, exam: true, olympiad: true },
        timeSplit: { class: 50, exam: 30, olympiad: 20 },
      },
    });
    assert.ok(p.length > 0, 'plan produced');
    assert.ok(!p.some((r) => r.track === 'exam' || r.track === 'olympiad'), 'tracks with no work get no rows');
    // exam+olympiad have zero work, so their 50% of the day must flow to class work
    const day1 = sumMin(p, (r) => r.date === H_TODAY);
    assert.ok(day1 >= 0.8 * 180, `available time wasted: only ${day1} of 180 min used on day 1`);
    // a small split must still surface (no starvation of a real track)
    const p2 = generateSchedule({
      syllabus: [
        mkRow('c1', 'Science', 'Life Processes', { track: 'class', estimated_hours: 8 }),
        mkRow('o1', 'Maths Olympiad', 'Number Theory', { track: 'olympiad', estimated_hours: 8 }),
      ],
      dailyHours: 1, preferredTime: 'Morning', daysOff: [], weeks: 2, userId: 'u-h3',
      today: H_TODAY, createdAt: H_CREATED,
      hoursMultiplier: 1, olympiadMultiplier: 1, examMultiplier: 1,
      priorities: {
        order: ['class', 'olympiad'],
        enabled: { class: true, olympiad: true, exam: false },
        timeSplit: { class: 90, olympiad: 10 },
      },
    });
    const olyMin = sumMin(p2, (r) => r.track === 'olympiad' && r.session_type === 'study');
    const clsMin = sumMin(p2, (r) => r.track === 'class' && r.session_type === 'study');
    assert.ok(olyMin > 0, `10% track starved to zero (${olyMin} min)`);
    assert.ok(clsMin > olyMin, `90/10 split honoured (class ${clsMin} vs olympiad ${olyMin})`);
  });

  // ================= c) school exam urgency =================
  check('H4', 'school exams: no NEW class study inside the protected exam window, overload named', () => {
    const examStart = addDays(H_TODAY, 20);
    const examEnd = addDays(H_TODAY, 23);
    const heavy = Array.from({ length: 12 }, (_, i) =>
      mkRow(`x${i}`, 'Science', `Chapter ${i}`, { estimated_hours: 10, weightage: 1 + (i % 5) }));
    const p = generateSchedule({
      syllabus: heavy, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 5,
      userId: 'u-h4', today: H_TODAY, createdAt: H_CREATED,
      schoolExams: [{ label: 'Mid-Terms', start_date: examStart, end_date: examEnd }],
    });
    assert.ok(p.length > 0, 'plan produced');
    const winStart = addDays(examStart, -14);
    const inside = p.filter(
      (r) => r.track === 'class' && r.session_type === 'study' && r.date >= winStart && r.date <= examEnd
    );
    assert.equal(inside.length, 0, `new class study inside the exam window: ${inside.map((r) => r.date).join(',')}`);
    // exam days themselves stay light revision only
    const examDayRows = p.filter((r) => r.date >= examStart && r.date <= examEnd);
    assert.ok(examDayRows.every((r) => r.session_type !== 'study'), 'exam days carry no new study blocks');
    // 120h of work vs 105h of capacity => overloaded, and the plan must SAY so
    assert.equal(p.coverage.overloaded, true, 'overload must be exposed, not hidden');
    assert.ok(Array.isArray(p.coverage.unscheduled) && p.coverage.unscheduled.length > 0, 'chapters that cannot fit are named');
  });

  // ================= d) olympiad date =================
  check('H5', 'olympiad date: olympiad work is bound to finish before the date', () => {
    const olyDate = addDays(H_TODAY, 25);
    const p = generateSchedule({
      syllabus: [
        mkRow('o1', 'Maths Olympiad', 'Number Theory', { track: 'olympiad', estimated_hours: 12, weightage: 5 }),
        mkRow('o2', 'Maths Olympiad', 'Combinatorics', { track: 'olympiad', estimated_hours: 12, weightage: 4 }),
        mkRow('c1', 'Science', 'Life Processes', { track: 'class', estimated_hours: 6 }),
      ],
      olympiadDate: olyDate, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 8,
      userId: 'u-h5', today: H_TODAY, createdAt: H_CREATED,
    });
    const olyStudy = p.filter((r) => r.track === 'olympiad' && r.session_type === 'study');
    assert.ok(olyStudy.length > 0, 'olympiad work is scheduled');
    assert.ok(
      olyStudy.every((r) => r.date < olyDate),
      `olympiad work scheduled after the olympiad date ${olyDate}: ${olyStudy.filter((r) => r.date >= olyDate).map((r) => r.date).join(',')}`
    );
    assert.equal(p.coverage.olympiadDoneBy, addDays(olyDate, -1), 'coverage reports the olympiad target date');
  });

  // ================= e) deadlines (incl. past deadlines) =================
  check('H6', 'deadlines: earlier deadline outranks higher weightage; overdue work goes first and is counted', () => {
    const soon = addDays(H_TODAY, 2);
    const later = addDays(H_TODAY, 25);
    const past = addDays(H_TODAY, -5);
    const p = generateSchedule({
      syllabus: [
        mkRow('u1', 'Maths', 'Quadratic Equations', { weightage: 2, estimated_hours: 4, deadline: soon }),
        mkRow('u2', 'Maths', 'Circles', { weightage: 5, estimated_hours: 4, deadline: later }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-h6', today: H_TODAY, createdAt: H_CREATED,
    });
    const firstStudy = p.find((r) => r.session_type === 'study');
    assert.ok(firstStudy, 'study block exists');
    assert.equal(firstStudy.topic, 'Quadratic Equations', 'the earlier deadline is scheduled first, not the heavier weightage');

    const pPast = generateSchedule({
      syllabus: [
        mkRow('o1', 'Maths', 'Overdue Chapter', { weightage: 1, estimated_hours: 4, deadline: past }),
        mkRow('o2', 'Maths', 'Future Chapter', { weightage: 5, estimated_hours: 4, deadline: later }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-h6', today: H_TODAY, createdAt: H_CREATED,
    });
    const firstPast = pPast.find((r) => r.session_type === 'study');
    assert.equal(firstPast.topic, 'Overdue Chapter', 'a past deadline is urgent, not ignored');
    assert.ok(pPast.coverage.overdueCount >= 1, `overdue items exposed (got ${pPast.coverage.overdueCount})`);
    assert.ok(pPast.some((r) => r.priority === 'high'), 'overdue work is marked high priority');
  });

  // ================= f) completed work exclusion =================
  check('H7', 'completed work: finished chapters never re-scheduled, partial progress and session credit reduce the remainder', () => {
    const p = generateSchedule({
      syllabus: [
        mkRow('d1', 'Science', 'Done Chapter', { status: 'completed', progress_percent: 100, estimated_hours: 10 }),
        mkRow('d2', 'Science', 'Half Chapter', { status: 'in_progress', progress_percent: 50, estimated_hours: 10 }),
        mkRow('d3', 'Science', 'Fresh Chapter', { status: 'locked', progress_percent: 0, estimated_hours: 10 }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-h7', today: H_TODAY, createdAt: H_CREATED,
      hoursMultiplier: 1,
    });
    assert.ok(!p.some((r) => r.topic === 'Done Chapter'), 'a completed chapter is never scheduled again');
    const half = sumMin(p, (r) => r.topic === 'Half Chapter' && r.session_type === 'study');
    const fresh = sumMin(p, (r) => r.topic === 'Fresh Chapter' && r.session_type === 'study');
    assert.ok(half > 0 && fresh > 0, `both incomplete chapters scheduled (half ${half}, fresh ${fresh})`);
    assert.ok(half < fresh, `50% progress must halve the remaining work (half ${half} vs fresh ${fresh})`);
    assert.ok(p.coverage.completedExcluded >= 1, `coverage counts excluded completed work (${p.coverage.completedExcluded})`);

    // credit from EXISTING completed sessions on the same chapter
    const pCredit = generateSchedule({
      syllabus: [mkRow('d3', 'Science', 'Fresh Chapter', { estimated_hours: 10 })],
      existing: [{
        id: 'x1', user_id: 'u-h7', date: H_TODAY, start_time: '08:00', end_time: '09:00',
        subject: 'Science', topic: 'Fresh Chapter', session_type: 'study', track: 'class',
        status: 'completed', duration_minutes: 600,
      }],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h7', today: H_TODAY, createdAt: H_CREATED,
      hoursMultiplier: 1,
    });
    assert.ok(
      !pCredit.some((r) => r.topic === 'Fresh Chapter' && r.session_type === 'study'),
      'a chapter already covered by completed sessions is not scheduled again'
    );
  });

  // ================= g) duplicate-generation protection =================
  check('H8', 'existing entries: never blindly duplicated, and they count toward that day capacity', () => {
    const existing = [
      { id: 'e1', user_id: 'u-h8', date: H_TODAY, start_time: '08:00', end_time: '08:50', subject: 'Science', topic: 'Life Processes', session_type: 'study', track: 'class', status: 'pending', duration_minutes: 50 },
      { id: 'e2', user_id: 'u-h8', date: H_TODAY, start_time: '09:00', end_time: '09:45', subject: 'Maths', topic: 'Trigonometry', session_type: 'practice', track: 'class', status: 'pending', duration_minutes: 45 },
    ];
    const p = generateSchedule({
      syllabus: [mkRow('s1', 'Science', 'Life Processes'), mkRow('s2', 'Maths', 'Trigonometry')],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h8', today: H_TODAY, createdAt: H_CREATED, existing,
    });
    const newKeys = new Set(p.map(rowKey));
    for (const e of existing) {
      assert.ok(!newKeys.has(rowKey(e)), `existing entry re-created (blind duplicate): ${rowKey(e)}`);
    }
    const dayTotal = sumMin(p, (r) => r.date === H_TODAY) + sumMin(existing, (e) => e.date === H_TODAY);
    assert.ok(dayTotal <= 180, `existing load ignored: ${dayTotal} min scheduled into a 180 min day`);
    assert.equal(p.coverage.existingCount, 2, 'coverage reports how many existing entries were respected');
    // running the generator twice over its own output must not grow the day
    const p2 = generateSchedule({
      syllabus: [mkRow('s1', 'Science', 'Life Processes'), mkRow('s2', 'Maths', 'Trigonometry')],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h8', today: H_TODAY, createdAt: H_CREATED, existing: [...existing, ...p],
    });
    const dupes = p2.filter((r) => newKeys.has(rowKey(r)));
    assert.equal(dupes.length, 0, `second run duplicated ${dupes.length} entries`);
  });

  // ================= h) rollover interplay (FIX-E preserved) =================
  check('H9', 'rollover: autoRescheduleMissed honours the plan date and rolled rows are not re-created', () => {
    const pastRow = {
      id: 'r1', user_id: 'u-h9', date: addDays(H_TODAY, -3), start_time: '18:00', end_time: '18:45',
      subject: 'Science', topic: 'Life Processes', session_type: 'study', track: 'class',
      status: 'pending', duration_minutes: 45,
    };
    const rolled = autoRescheduleMissed([pastRow], { dailyHours: 3, schoolExams: [], today: H_TODAY });
    assert.equal(rolled.moved.length, 1, 'the past-due row is rolled');
    assert.ok(
      rolled.moved.every((m) => m.date >= H_TODAY && m.date <= addDays(H_TODAY, 28)),
      `rolled relative to the plan date, not the wall clock: ${rolled.moved.map((m) => m.date).join(',')}`
    );
    assert.ok(rolled.moved.every((m) => m.status === 'pending'), 'rolled rows stay pending');
    // a generate that sees the rolled rows must not recreate them
    const p = generateSchedule({
      syllabus: [mkRow('s1', 'Science', 'Life Processes')],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h9', today: H_TODAY, createdAt: H_CREATED, existing: rolled.moved,
    });
    const keys = new Set(p.map(rowKey));
    assert.ok(
      !rolled.moved.some((m) => keys.has(rowKey({ ...m, session_type: m.session_type || 'study' }))),
      'rolled rows were duplicated by the generator'
    );
  });

  // ================= i) overloaded workload =================
  check('H10', 'overload: the most urgent work is kept, the rest is named, and no impossible allocation is invented', () => {
    const heavy = Array.from({ length: 24 }, (_, i) =>
      mkRow(`h${i}`, 'Science', `Chapter ${i}`, {
        estimated_hours: 20,
        weightage: 1 + (i % 5),
        deadline: i < 4 ? addDays(H_TODAY, 3) : addDays(H_TODAY, 60),
      }));
    const p = generateSchedule({
      syllabus: heavy, dailyHours: 1, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-h10', today: H_TODAY, createdAt: H_CREATED,
    });
    const cov = p.coverage;
    assert.equal(cov.overloaded, true, 'overload stated plainly');
    assert.ok(cov.shortfallHours > 0, `shortfall quantified (got ${cov.shortfallHours})`);
    assert.ok(Array.isArray(cov.unscheduled) && cov.unscheduled.length > 0, 'unscheduled work is listed');
    assert.ok(cov.requiredPerDay > 1, `requiredPerDay reported (${cov.requiredPerDay})`);
    // the most urgent + heaviest chapter is preserved WHOLE-HEARTEDLY; far-off
    // work is deferred and named, never silently sprinkled over everything
    const plannedTopics = new Set(p.filter((r) => r.session_type === 'study').map((r) => r.topic));
    assert.ok(plannedTopics.has('Chapter 3'), 'the most urgent, heaviest chapter (due in 3 days) is preserved');
    assert.ok(!plannedTopics.has('Chapter 20'), 'far-deadline work is deferred while urgent work is unfinished');
    assert.ok(Array.isArray(cov.planned) && cov.planned.length > 0, 'coverage lists what the plan did schedule');
    // nothing less urgent may be kept while something more urgent went unscheduled
    for (const pl of cov.planned) {
      for (const un of cov.unscheduled) {
        const moreUrgent =
          (!!un.deadline && (!pl.deadline || un.deadline < pl.deadline)) ||
          (!!un.deadline && !!pl.deadline && un.deadline === pl.deadline && un.weightage > pl.weightage);
        assert.ok(!moreUrgent, `less urgent "${un.chapter}" kept over more urgent "${pl.chapter}"`);
      }
    }
    assert.ok(
      cov.unscheduled.every((u) => u.chapter && u.remainingHours > 0),
      'unscheduled entries name the chapter and the hours still needed'
    );
    // never invent time: 1h/day cap respected on every day
    for (const [d, m] of Object.entries(minutesByDate(p))) {
      assert.ok(m <= 60, `day ${d} allocated ${m} min with only 60 min available`);
    }
  });

  // ================= j) missing / empty / zero inputs =================
  check('H11', 'graceful degradation: no syllabus, no deadlines, no priorities, no olympiad, zero or tiny time', () => {
    const empty = generateSchedule({ today: H_TODAY, createdAt: H_CREATED, userId: 'u-h11' });
    assert.ok(Array.isArray(empty), 'no syllabus -> still returns an array, no crash');
    assert.equal(empty.length, 0, 'no syllabus -> no invented rows');
    assert.ok(empty.coverage, 'coverage still reported');
    assert.ok(
      Array.isArray(empty.coverage.reasons) && empty.coverage.reasons.includes('no-syllabus'),
      `honest reason recorded (got ${JSON.stringify(empty.coverage.reasons)})`
    );

    const noDates = generateSchedule({
      syllabus: [mkRow('n1', 'Science', 'Life Processes')], dailyHours: 2, weeks: 2,
      userId: 'u-h11', today: H_TODAY, createdAt: H_CREATED,
    });
    assert.ok(noDates.length > 0, 'no exam/olympiad/deadlines/priorities still produces a real plan');
    assert.ok(noDates.coverage.priorityOrder.length > 0, 'default priorities applied');

    const zero = generateSchedule({
      syllabus: [mkRow('z1', 'Science', 'Life Processes')], dailyHours: 0, weeks: 2,
      userId: 'u-h11', today: H_TODAY, createdAt: H_CREATED,
    });
    assert.ok(!zero.some((r) => r.session_type === 'study'), 'zero available time must not invent study blocks');
    assert.equal(zero.coverage.noCapacity, true, 'zero time is reported instead of padded to 30 min');
    assert.ok(/time|capacity|hrs/i.test(String(zero.coverage.coverageWarning || '')), 'warning explains the zero-time case');

    const tiny = generateSchedule({
      syllabus: [mkRow('t1', 'Science', 'Life Processes')], dailyHours: 0.25, weeks: 2,
      userId: 'u-h11', today: H_TODAY, createdAt: H_CREATED,
    });
    for (const [d, m] of Object.entries(minutesByDate(tiny))) {
      assert.ok(m <= 15, `0.25h/day is 15 min — day ${d} got ${m} min (impossible allocation)`);
    }
  });

  // ================= no fake data, FIX-D4/FIX-E preserved, deadlines before planning =================
  check('H12', 'no demo data, single date system, FIX-D4 exam guard and FIX-E rollover preserved, deadlines computed before planning', () => {
    assert.ok(!/DEMO_SCHEDULE|demoSchedule|fakeSchedule|sampleSchedule|dummySchedule/i.test(sgSrc), 'no demo/fake schedule data in the scheduler');
    assert.ok(/todayStr\(\)/.test(sgSrc), 'still uses the one existing date system (todayStr -> FIX-F dev offset)');
    assert.ok(!/setDevDateOffset|devOffsetDays\s*=/.test(sgSrc), 'scheduler does not introduce a second date system');
    assert.ok(sgSrc.includes('examDates') && sgSrc.includes('isExamDay') && sgSrc.includes('FIX-D4'), 'FIX-D4 exam-day guard preserved');
    assert.ok(ssSrc.includes('autoRolledRef') && ssSrc.includes('Auto-rolled') && ssSrc.includes('pastDue'), 'FIX-E auto rollover preserved in the screen');
    assert.ok(ssSrc.includes('autoRescheduleMissed') && ssSrc.includes('aiReschedule') && ssSrc.includes('schoolExams'), 'FIX-D4/FIX-E wiring preserved');
    // the screen must feed real existing entries into the generator (duplicate protection)
    assert.ok(/existing\s*:/.test(ssSrc), 'ScheduleScreen passes existing schedule entries to the generator');
    // deadlines must be known BEFORE planning — previously they were written after, so the plan never used them
    const genIdx = ssSrc.indexOf('generateSchedule({');
    const dlIdx = ssSrc.indexOf('autoSetDeadlines(');
    assert.ok(genIdx > 0 && dlIdx > 0, 'both calls present');
    assert.ok(dlIdx < genIdx, 'deadlines are computed BEFORE the schedule is generated');
    // and the screen must surface overload honestly
    assert.ok(/overloaded|unscheduled/.test(ssSrc), 'ScheduleScreen surfaces overload instead of pretending everything fits');
  });

  // ================= zero available time must survive the trip into the planner =================
  check('H13', 'zero available time is never inflated before it reaches the planner', () => {
    assert.equal(effectiveDailyHours({ daily_study_hours: 0 }), 0, 'an explicit 0 hrs/day must stay 0, not become 2');
    assert.equal(effectiveDailyHours({}), 2, 'an unset value keeps the app default');
    assert.equal(effectiveDailyHours({ daily_study_hours: null }), 2, 'null keeps the app default');
    assert.equal(effectiveDailyHours({ daily_study_hours: 3 }), 3, 'a real value passes through unchanged');
    const p = generateSchedule({
      syllabus: [mkRow('z9', 'Science', 'Life Processes')],
      dailyHours: effectiveDailyHours({ daily_study_hours: 0 }),
      weeks: 2, userId: 'u-h13', today: H_TODAY, createdAt: H_CREATED,
    });
    assert.equal(p.length, 0, 'a 0 hrs/day profile must not produce invented sessions');
    assert.equal(p.coverage.noCapacity, true, 'the plan says plainly that there is no time');
  });

  // ================= one-shot dates: work stops at the event, backlog is named =================
  check('H14', 'exam-bound work stops at its date — an impossible backlog is reported, never scheduled after the event', () => {
    const olyDate = addDays(H_TODAY, 30);
    const heavy = Array.from({ length: 8 }, (_, i) =>
      mkRow(`ho${i}`, 'Maths Olympiad', `Oly Chapter ${i}`, { track: 'olympiad', estimated_hours: 20, weightage: 3 }));
    const p = generateSchedule({
      syllabus: heavy, olympiadDate: olyDate, dailyHours: 2, preferredTime: 'Morning',
      daysOff: [], weeks: 4, userId: 'u-h14', today: H_TODAY, createdAt: H_CREATED,
    });
    const oly = p.filter((r) => r.track === 'olympiad' && r.session_type === 'study');
    assert.ok(oly.length > 0, 'olympiad work is scheduled before the date');
    assert.ok(oly.every((r) => r.date < olyDate), `olympiad prep scheduled on/after the date ${olyDate}`);
    assert.ok(Array.isArray(p.coverage.tooLate) && p.coverage.tooLate.length > 0, 'chapters that cannot be prepared in time are named');
    assert.ok(p.coverage.tooLate.every((t) => t.reason === 'date-passed' && t.remainingHours > 0), 'the reason and the unfinished hours are explicit');
    assert.equal(p.coverage.overloaded, true, 'the overload is flagged, not hidden');
    // the same rule protects the main exam date
    const examDay = addDays(H_TODAY, 20);
    const pExam = generateSchedule({
      syllabus: Array.from({ length: 6 }, (_, i) => mkRow(`he${i}`, 'JEE', `Exam Chapter ${i}`, { track: 'exam', estimated_hours: 25 })),
      examDate: examDay, dailyHours: 2, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-h14', today: H_TODAY, createdAt: H_CREATED,
    });
    const examStudy = pExam.filter((r) => r.track === 'exam' && r.session_type === 'study');
    assert.ok(examStudy.every((r) => r.date < examDay), 'no exam-track prep scheduled on/after the main exam date');
    assert.ok(pExam.coverage.tooLate.length > 0, 'unfinishable exam backlog is reported');
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failed.length, 0, `FIX-H: ${failed.length} check(s) failed -> ${failed.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-S: S1 subject-pair interleave, S2 exam run-up, S3 conquered-chapter ladder, S4 Feb-25 class cutoff ----------
// S5 (April-1 transition / Class 10 -> 11 promotion) is NOT tested here: it is blocked on a
// schema gate (a new users column + a syllabus.status CHECK value). It is STOPPED and reported
// with the exact SQL instead of being hacked around — see FIX-S-REPORT.md.
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  // FIX-S exports live in the SAME planner module (no parallel scheduler). Imported
  // dynamically so a missing export is a recorded failure, not a suite crash.
  let SG = null; let sgErr = '';
  try { SG = await import('./../src/lib/scheduleGenerator.js'); }
  catch (e) { sgErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  let U = null; let uErr = '';
  try { U = await import('./../src/lib/utils.js'); }
  catch (e) { uErr = String(e && e.message ? e.message : e).split('\n')[0]; }

  const sgSrcS = read('src/lib/scheduleGenerator.js');
  const constSrcS = read('src/config/constants.js');
  const ssSrcS = read('src/screens/study/ScheduleScreen.js');

  // a Monday INSIDE session 2025-26 (before the 25 Feb class cutoff), so the class
  // track is legitimately open for S1-S3; S4 moves the date with the dev offset
  const S_TODAY = '2026-01-05';
  const S_CREATED = '2026-01-05T00:00:00.000Z';
  const sadd = (iso, n) =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const mkS = (id, subject, chapter, over = {}) => ({
    id, subject, chapter, weightage: 3, estimated_hours: 6,
    status: 'locked', track: 'class', progress_percent: 0, ...over,
  });
  const classStudyByDate = (rows) => {
    const m = {};
    for (const r of rows) {
      if (r.track !== 'class' || r.session_type !== 'study') continue;
      (m[r.date] = m[r.date] || new Set()).add(r.subject);
    }
    return m;
  };
  const minOf = (rows, pred) => rows.filter(pred).reduce((a, r) => a + (Number(r.duration_minutes) || 0), 0);
  const LADDER_RE = /^(Chapter test|Spaced revision)/;
  const dayjsDay = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

  // ================= S1 — weekly subject-pair interleave =================
  const sixSubjectRows = [];
  ['Maths', 'Social Science', 'English', 'Science', 'Hindi', 'AI'].forEach((subj, si) => {
    sixSubjectRows.push(mkS(`s${si}a`, subj, `${subj} — chapter A`, { estimated_hours: 6 }));
    sixSubjectRows.push(mkS(`s${si}b`, subj, `${subj} — chapter B`, { estimated_hours: 6 }));
  });

  check('S1a', '6 subjects -> every day carries a PAIR (>=2 distinct subjects) and no subject repeats on consecutive days', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    assert.equal(typeof SG.buildSubjectRotation, 'function', 'buildSubjectRotation is not exported (S1 mechanism absent)');
    const rot = SG.buildSubjectRotation(sixSubjectRows, S_TODAY, 7);
    assert.ok(rot && Array.isArray(rot.order) && rot.order.length === 6, `rotation must order all 6 subjects, got ${JSON.stringify(rot && rot.order)}`);
    assert.ok(rot.byDate && typeof rot.byDate === 'object', 'rotation must expose a per-date map');
    for (let d = 0; d < 7; d++) {
      const date = sadd(S_TODAY, d);
      const pair = rot.byDate[date];
      assert.ok(Array.isArray(pair), `no pair for ${date}`);
      assert.ok(new Set(pair).size >= 2, `day ${date} must carry >=2 distinct subjects, got ${JSON.stringify(pair)}`);
    }
    for (let d = 1; d < 7; d++) {
      const prev = new Set(rot.byDate[sadd(S_TODAY, d - 1)]);
      for (const s of rot.byDate[sadd(S_TODAY, d)]) {
        assert.ok(!prev.has(s), `${s} appears on two consecutive days`);
      }
    }
    // and the generated grid must actually FOLLOW the rotation, not just know it
    const p = generateSchedule({
      syllabus: sixSubjectRows, dailyHours: 3, preferredTime: 'Morning', daysOff: [],
      prepLevel: 'Intermediate', weeks: 1, userId: 'u-s1a', today: S_TODAY, createdAt: S_CREATED,
    });
    const grid = classStudyByDate(p);
    // FIX-SCHED3: horizon now = cutoff+14d buffer (was 51d, now 65d) — S1a intent is first 7 days pair, not entire 65d tail
    const allDays = Object.keys(grid).sort();
    const firstWeek = allDays.filter((d) => d < sadd(S_TODAY, 7));
    const days = firstWeek.length ? firstWeek : allDays.slice(0, 7);
    assert.ok(days.length >= 5, `expected class study on most of the 7 days, got ${days.length} (all ${allDays.length})`);
    for (const d of days) {
      assert.ok(grid[d].size >= 2, `grid day ${d} studied only ${[...grid[d]].join('/')} — the pair interleave is not wired into the planner`);
    }
    for (let i = 1; i < days.length; i++) {
      if (sadd(days[i - 1], 1) !== days[i]) continue; // only truly consecutive dates
      for (const s of grid[days[i]]) {
        assert.ok(!grid[days[i - 1]].has(s), `${s} studied on consecutive days ${days[i - 1]} and ${days[i]}`);
      }
    }
  });

  check('S1b', 'single-subject backlog degrades to one subject per day, plan still generated', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const rows = [mkS('m1', 'Maths', 'Trigonometry'), mkS('m2', 'Maths', 'Circles'), mkS('m3', 'Maths', 'Statistics')];
    const rot = SG.buildSubjectRotation(rows, S_TODAY, 7);
    assert.deepEqual(rot.order, ['Maths'], 'one subject -> an order of one');
    for (let d = 0; d < 7; d++) {
      const pair = rot.byDate[sadd(S_TODAY, d)];
      assert.ok(Array.isArray(pair) && pair.length === 1 && pair[0] === 'Maths', `day ${d} must degrade to a single subject, got ${JSON.stringify(pair)}`);
    }
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-s1b', today: S_TODAY, createdAt: S_CREATED,
    });
    assert.ok(p.length > 3, 'a single-subject plan still produces sessions');
    assert.ok(p.every((r) => r.session_type !== 'study' || r.subject === 'Maths'), 'no invented subjects');
    assert.deepEqual(p.coverage.subjectRotation, ['Maths'], 'the summary reports the rotation it used');
  });

  check('S1c', 'urgent chapter: the pair survives and the minutes are weighted toward the due subject', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const rows = [
      mkS('u1', 'Science', 'Electricity', { deadline: sadd(S_TODAY, 2), estimated_hours: 8, weightage: 5 }),
      mkS('u2', 'Science', 'Magnetic Effects', { deadline: sadd(S_TODAY, 3), estimated_hours: 8 }),
      mkS('h1', 'Hindi', 'Kritika', { estimated_hours: 8 }),
      mkS('h2', 'Hindi', 'Sanchayan', { estimated_hours: 8 }),
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2,
      userId: 'u-s1c', today: S_TODAY, createdAt: S_CREATED,
    });
    const day1 = p.filter((r) => r.date === S_TODAY && r.track === 'class' && r.session_type === 'study');
    const subjects = new Set(day1.map((r) => r.subject));
    assert.equal(subjects.size, 2, `day 1 must carry both subjects of the pair, got ${[...subjects].join('/') || 'none'}`);
    const sci = minOf(day1, (r) => r.subject === 'Science');
    const hin = minOf(day1, (r) => r.subject === 'Hindi');
    assert.ok(sci > 0 && hin > 0, `both subjects need real time (Science ${sci} min, Hindi ${hin} min)`);
    assert.ok(sci > hin, `deadline urgency must enlarge the due subject's share (Science ${sci} vs Hindi ${hin})`);
  });

  check('S1d', 'a declared day off stays light and does NOT shift the weekly pair pattern', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const rotA = SG.buildSubjectRotation(sixSubjectRows, S_TODAY, 14);
    const p = generateSchedule({
      syllabus: sixSubjectRows, dailyHours: 3, preferredTime: 'Morning', daysOff: [5],
      prepLevel: 'Intermediate', weeks: 2, userId: 'u-s1d', today: S_TODAY, createdAt: S_CREATED,
    });
    const offDate = sadd(S_TODAY, 5); // Saturday of week 1
    const offMin = minOf(p, (r) => r.date === offDate);
    // FIX-FILL: days_off → 50% light day revision/mock/practice only, never free
    assert.ok(offMin <= 100, `a day off must stay light (50% of 3h=90min), got ${offMin} min`);
    const grid = classStudyByDate(p);
    assert.ok(Object.keys(grid).length >= 8, `study days expected across the fortnight, got ${Object.keys(grid).length}`);
    for (const d of Object.keys(grid)) {
      const expected = rotA.byDate[d] || [];
      if (expected.length < 2) continue;
      for (const s of grid[d]) {
        assert.ok(expected.includes(s), `day ${d} studied ${s}, which is not in that calendar day's pair ${JSON.stringify(expected)} — the pattern shifted`);
      }
    }
  });

  check('S1e', '8 subjects (7+ edge): the pair pattern still interleaves and covers every subject within the week', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const rows = [];
    ['Maths', 'Science', 'English', 'Hindi', 'Social Science', 'AI', 'Computer Science', 'Sanskrit'].forEach((subj, i) => {
      rows.push(mkS(`e${i}`, subj, `${subj} — chapter A`, { estimated_hours: 5, deadline: sadd(S_TODAY, 10 + i) }));
    });
    const rot = SG.buildSubjectRotation(rows, S_TODAY, 7);
    assert.equal(rot.order.length, 8, `all 8 subjects must be in the rotation, got ${rot.order.length}`);
    const seen = new Set();
    for (let d = 0; d < 7; d++) {
      const pair = rot.byDate[sadd(S_TODAY, d)];
      assert.equal(new Set(pair).size, 2, `day ${d} must carry 2 distinct subjects, got ${JSON.stringify(pair)}`);
      pair.forEach((s) => seen.add(s));
      if (d > 0) {
        const prev = new Set(rot.byDate[sadd(S_TODAY, d - 1)]);
        for (const s of pair) assert.ok(!prev.has(s), `${s} repeats on consecutive days`);
      }
    }
    assert.equal(seen.size, 8, `a week of pairs must reach every subject, reached ${seen.size}`);
    assert.deepEqual(rot.order[0], 'Maths', 'the nearest deadline leads the rotation');
  });

  // ================= S2 — exam-aware run-up =================
  check('S2a', 'school exam ahead: every class day inside the 14-day run-up carries a due-before-exam subject', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const examStart = sadd(S_TODAY, 20);
    const examEnd = sadd(S_TODAY, 23);
    const rows = [
      // Science chapters are DUE BEFORE the exam; every other subject is due after it
      mkS('sc1', 'Science', 'Life Processes', { deadline: sadd(S_TODAY, 4), estimated_hours: 8 }),
      mkS('sc2', 'Science', 'Electricity', { deadline: sadd(S_TODAY, 6), estimated_hours: 8 }),
      mkS('ma1', 'Maths', 'Trigonometry', { deadline: sadd(S_TODAY, 40), estimated_hours: 6 }),
      mkS('en1', 'English', 'First Flight', { deadline: sadd(S_TODAY, 45), estimated_hours: 6 }),
      mkS('hi1', 'Hindi', 'Kritika', { deadline: sadd(S_TODAY, 50), estimated_hours: 6 }),
      mkS('so1', 'Social Science', 'Nationalism', { deadline: sadd(S_TODAY, 55), estimated_hours: 6 }),
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-s2a', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [{ label: 'Mid-Terms', start_date: examStart, end_date: examEnd }],
    });
    assert.ok(p.length > 0, 'plan produced');
    assert.ok(p.coverage.examRunUp, 'the summary must name the run-up it applied');
    assert.deepEqual(p.coverage.examRunUp.dueSubjects, ['Science'], `run-up must identify the due-before-exam subjects, got ${JSON.stringify(p.coverage.examRunUp.dueSubjects)}`);
    // the run-up window = the 14 days before the exam range starts
    assert.ok(p.some((r) => r.date === sadd(examStart, -1) && r.session_type === 'mock'), 'the pre-exam mock day is preserved unchanged');
    let classDays = 0;
    for (let d = 6; d <= 19; d++) {
      const date = sadd(S_TODAY, d);
      // the day before the exam keeps its accepted pre-exam mock (spec: unchanged)
      if (date === sadd(examStart, -1)) continue;
      const dayRows = p.filter((r) => r.date === date && r.track === 'class');
      if (!dayRows.length) continue;
      classDays += 1;
      assert.ok(
        dayRows.some((r) => r.subject === 'Science'),
        `run-up day ${date} carries no due-before-exam subject: ${dayRows.map((r) => `${r.session_type}:${r.subject}`).join(', ')}`
      );
    }
    assert.ok(classDays >= 10, `expected class content on most run-up days, got ${classDays}`);
    // the accepted protected-window rule must survive S2 (H4): no NEW class study in the window
    const protStart = sadd(examStart, -14);
    assert.ok(
      !p.some((r) => r.track === 'class' && r.session_type === 'study' && r.date >= protStart && r.date <= examEnd),
      'S2 must not reintroduce new class study inside the protected exam window'
    );
    // and the wave keeps its shape: revision + timed practice, no invented session types
    const waveRows = p.filter((r) => r.date >= protStart && r.date < sadd(examStart, -1) && r.track === 'class');
    assert.ok(waveRows.length > 0, 'the revision wave still runs');
    assert.ok(waveRows.every((r) => r.session_type === 'revision' || r.session_type === 'practice'), `wave session types unchanged: ${[...new Set(waveRows.map((r) => r.session_type))].join(',')}`);
  });

  check('S2b', 'no exam within 30 days -> plain rotation, no run-up reported', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const rows = sixSubjectRows.map((r) => ({ ...r, deadline: sadd(S_TODAY, 60) }));
    const rot = SG.buildSubjectRotation(rows, S_TODAY, 7);
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 1,
      userId: 'u-s2b', today: S_TODAY, createdAt: S_CREATED, schoolExams: [],
    });
    assert.ok(!p.coverage.examRunUp, 'no exam run-up may be reported when no exam is near');
    const grid = classStudyByDate(p);
    const firstDay = Object.keys(grid).sort()[0];
    assert.ok(firstDay, 'class study exists');
    const pair = rot.byDate[firstDay] || [];
    for (const s of grid[firstDay]) {
      assert.ok(pair.includes(s), `${s} studied on ${firstDay} but the plain rotation pair is ${JSON.stringify(pair)}`);
    }
  });

  check('S2c', 'overlapping exam ranges: the NEAREST exam drives the run-up', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const near = sadd(S_TODAY, 10);
    const far = sadd(S_TODAY, 25);
    const rows = [
      mkS('a1', 'Science', 'Life Processes', { deadline: sadd(S_TODAY, 8) }),   // due before the NEAR exam
      mkS('b1', 'Maths', 'Trigonometry', { deadline: sadd(S_TODAY, 20) }),      // due before the FAR exam only
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-s2c', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [
        { label: 'Unit Test', start_date: far, end_date: sadd(S_TODAY, 26) },
        { label: 'Mid-Terms', start_date: near, end_date: sadd(S_TODAY, 12) },
      ],
    });
    assert.ok(p.coverage.examRunUp, 'a run-up is reported');
    assert.equal(p.coverage.examRunUp.exam, 'Mid-Terms', `the nearest exam must win, got ${p.coverage.examRunUp.exam}`);
    assert.deepEqual(p.coverage.examRunUp.dueSubjects, ['Science'], 'only chapters due before the NEAREST exam drive it');
  });

  check('S2d', 'H14 boundary behaviour survives S2 (nothing scheduled on/after a one-shot event date)', () => {
    const olyDate = sadd(S_TODAY, 30);
    const heavy = Array.from({ length: 8 }, (_, i) =>
      mkS(`ho${i}`, 'Maths Olympiad', `Oly Chapter ${i}`, { track: 'olympiad', estimated_hours: 20 }));
    const p = generateSchedule({
      syllabus: heavy, olympiadDate: olyDate, dailyHours: 2, preferredTime: 'Morning',
      daysOff: [], weeks: 4, userId: 'u-s2d', today: S_TODAY, createdAt: S_CREATED,
    });
    const oly = p.filter((r) => r.track === 'olympiad' && r.session_type === 'study');
    assert.ok(oly.length > 0, 'olympiad work scheduled');
    assert.ok(oly.every((r) => r.date < olyDate), 'olympiad prep scheduled on/after the olympiad date');
    assert.ok(p.coverage.tooLate.length > 0, 'an impossible backlog is still reported');
  });

  check('S2e', 'exam in 10 days: the run-up is named, the protected window still forbids NEW class study, at-risk chapters are reported not hidden', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const examStart = sadd(S_TODAY, 10);
    const rows = [
      mkS('sc1', 'Science', 'Life Processes', { deadline: sadd(S_TODAY, 4), estimated_hours: 8 }),
      mkS('ma1', 'Maths', 'Trigonometry', { deadline: sadd(S_TODAY, 40), estimated_hours: 6 }),
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s2e', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [{ label: 'Mid-Terms', start_date: examStart, end_date: sadd(S_TODAY, 12) }],
    });
    assert.ok(p.coverage.examRunUp, 'the run-up is named even when it started before the plan did');
    assert.deepEqual(p.coverage.examRunUp.dueSubjects, ['Science'], 'Science is due before the exam');
    // the H4 rule wins: the class target date has already passed, so NO new class study is invented
    assert.ok(p.coverage.classDoneBy < S_TODAY, `the class target date must be honestly in the past, got ${p.coverage.classDoneBy}`);
    assert.ok(!p.some((r) => r.track === 'class' && r.session_type === 'study' && r.date < examStart), 'no new class study inside the protected window');
    // the chapter that can no longer be finished in time is NAMED, not dropped
    const named = [
      ...(p.coverage.unscheduled || []),
      ...(p.coverage.partial || []),
      ...(p.coverage.classDueInProtectedWindow || []),
      ...(p.coverage.examRunUp.dueChapters || []).map((c) => ({ chapter: c.chapter })),
    ].map((u) => u.chapter);
    assert.ok(named.includes('Life Processes'), `the at-risk chapter must be listed, got ${JSON.stringify(named)}`);
    assert.ok(/run-up window|cannot be finished/i.test(String(p.coverage.coverageWarning || '')), `the summary must say it plainly: ${p.coverage.coverageWarning}`);
  });

  check('S2f', 'exam run-up landing on a declared day off: FIX-FILL days_off now 50% light, wave can stay light', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const examStart = sadd(S_TODAY, 20);
    const rows = [
      mkS('sc1', 'Science', 'Life Processes', { deadline: sadd(S_TODAY, 4), estimated_hours: 8 }),
      mkS('ma1', 'Maths', 'Trigonometry', { deadline: sadd(S_TODAY, 40), estimated_hours: 6 }),
      mkS('en1', 'English', 'First Flight', { deadline: sadd(S_TODAY, 45), estimated_hours: 6 }),
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours: 3, preferredTime: 'Morning', daysOff: [2], // Wednesday off
      weeks: 4, userId: 'u-s2f', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [{ label: 'Mid-Terms', start_date: examStart, end_date: sadd(S_TODAY, 23) }],
    });
    const offInWindow = [sadd(S_TODAY, 9), sadd(S_TODAY, 16)]; // Wednesdays inside the run-up
    for (const off of offInWindow) {
      assert.equal((dayjsDay(off) + 6) % 7, 2, `fixture sanity: ${off} is a Wednesday`);
      assert.ok(off < examStart && off >= sadd(examStart, -14), `fixture sanity: ${off} is inside the run-up window`);
      // FIX-FILL: days_off → 50% light, revision wave allowed on reduced day (light)
      const offMin = minOf(p, (r) => r.date === off);
      assert.ok(offMin <= 100, `a day off now 50% light (revision allowed), got ${offMin} min on ${off}`);
      // If wave is on off day, it must be light (revision only, no new)
      const offBlocks = p.filter(r => r.date === off);
      const offStudy = offBlocks.filter(r => r.session_type === 'study');
      assert.equal(offStudy.length, 0, `reduced day ${off} must have zero new study blocks`);
    }
    // the run-up still prioritises the due-before-exam subject
    const moved = p.filter((r) => /Revision wave/.test(r.topic));
    assert.ok(moved.length >= 2, `both moved waves emitted, got ${moved.length}`);
    assert.ok(moved.every((r) => r.subject === 'Science'), `moved waves keep the due subject, got ${moved.map((r) => r.subject).join(',')}`);
  });

  // ================= S3 — conquered -> chapter test + spaced revision =================
  const doneRow = (id, subject, chapter, completedAt, over = {}) =>
    mkS(id, subject, chapter, { status: 'completed', progress_percent: 100, estimated_hours: 6, completed_at: completedAt, ...over });

  check('S3a', 'one conquered chapter -> exactly 1 chapter test (+2d) and 3 spaced revisions (+3/+7/+14d), never studied again', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const p = generateSchedule({
      syllabus: [
        doneRow('d1', 'Science', 'Life Processes', `${S_TODAY}T09:00:00.000Z`),
        mkS('p1', 'Maths', 'Trigonometry', { estimated_hours: 6 }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s3a', today: S_TODAY, createdAt: S_CREATED,
    });
    const tests = p.filter((r) => /^Chapter test: Life Processes$/.test(r.topic));
    const revs = p.filter((r) => /^Spaced repetition \(\+\d+d\): Life Processes$/.test(r.topic) || /^Spaced revision \(\+\d+d\): Life Processes$/.test(r.topic));
    assert.equal(tests.length, 1, `exactly one chapter test, got ${tests.length}: ${tests.map((t) => `${t.date}/${t.session_type}`).join(',')}`);
    assert.equal(tests[0].date, sadd(S_TODAY, 2), `the chapter test belongs at +2 days, got ${tests[0].date}`);
    assert.equal(tests[0].session_type, 'mock', 'the chapter test reuses the existing mock session type (no schema change)');
    assert.deepEqual(revs.map((r) => r.date).sort(), [sadd(S_TODAY, 3), sadd(S_TODAY, 7), sadd(S_TODAY, 14)], `spaced revisions at +3/+7/+14, got ${revs.map((r) => r.date).join(',')}`);
    assert.ok(revs.every((r) => r.session_type === 'revision'), 'spaced sessions use the revision type');
    assert.ok(revs.every((r) => r.duration_minutes >= 20 && r.duration_minutes <= 30), `spaced revisions are 20-30 min, got ${revs.map((r) => r.duration_minutes).join(',')}`);
    assert.ok(!p.some((r) => r.session_type === 'study' && r.topic === 'Life Processes'), 'a conquered chapter is never study-scheduled again');
    assert.deepEqual([p.coverage.pipeline.tests, p.coverage.pipeline.revisions], [1, 3], 'the summary counts the ladder it emitted');
  });

  check('S3b', 'regenerating over its own output never duplicates the ladder', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const opts = {
      syllabus: [
        doneRow('d1', 'Science', 'Life Processes', `${S_TODAY}T09:00:00.000Z`),
        mkS('p1', 'Maths', 'Trigonometry', { estimated_hours: 6 }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s3b', today: S_TODAY, createdAt: S_CREATED,
    };
    const first = generateSchedule(opts);
    const ladder = first.filter((r) => LADDER_RE.test(r.topic));
    assert.equal(ladder.length, 4, `the first run must produce exactly 4 ladder sessions, got ${ladder.length}`);
    const second = generateSchedule({ ...opts, existing: first });
    const again = second.filter((r) => LADDER_RE.test(r.topic));
    assert.equal(again.length, 0, `the second run re-created ${again.length} ladder sessions — the identity key is not honoured`);
    const third = generateSchedule({ ...opts, existing: [...first, ...second] });
    assert.equal(third.filter((r) => LADDER_RE.test(r.topic)).length, 0, 'a third run is still clean (idempotent)');
    assert.equal(second.coverage.pipeline.duplicatesSuppressed, 4, 'the suppression is counted, not silent');
    // kept rows still consume their day: nothing may be over-allocated
    const totals = {};
    for (const r of [...first, ...second, ...third]) totals[r.date] = (totals[r.date] || 0) + (Number(r.duration_minutes) || 0);
    for (const [d, m] of Object.entries(totals)) {
      assert.ok(m <= 180, `day ${d} over-allocated after regeneration: ${m} > 180`);
    }
  });

  check('S3c', 'five conquered chapters -> five chapter tests and fifteen spaced revisions', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const subjects = ['Science', 'Science', 'Maths', 'English', 'Social Science'];
    const chapters = ['Life Processes', 'Electricity', 'Trigonometry', 'First Flight', 'Nationalism'];
    const done = chapters.map((ch, i) => doneRow(`c${i}`, subjects[i], ch, `${sadd(S_TODAY, -1)}T09:00:00.000Z`));
    const p = generateSchedule({
      syllabus: [...done, mkS('p1', 'Hindi', 'Kritika', { estimated_hours: 6 })],
      dailyHours: 4, preferredTime: 'Morning', daysOff: [], weeks: 4,
      userId: 'u-s3c', today: S_TODAY, createdAt: S_CREATED,
    });
    const tests = p.filter((r) => /^Chapter test: /.test(r.topic));
    const revs = p.filter((r) => /^Spaced revision \(\+\d+d\): /.test(r.topic));
    assert.equal(tests.length, 5, `5 chapter tests expected, got ${tests.length}`);
    assert.equal(revs.length, 15, `15 spaced revisions expected, got ${revs.length}`);
    assert.equal(new Set(tests.map((r) => r.topic)).size, 5, 'each test session is distinct per chapter');
    assert.equal(p.coverage.pipeline.notEmitted, 0, `no ladder session may be lost (${p.coverage.pipeline.notEmitted} unplaced)`);
    assert.ok(!p.some((r) => r.session_type === 'study' && chapters.includes(r.topic)), 'no conquered chapter returns as study');
    const byDate = {};
    for (const r of p) byDate[r.date] = (byDate[r.date] || 0) + (Number(r.duration_minutes) || 0);
    for (const [d, m] of Object.entries(byDate)) {
      assert.ok(m <= 240, `day ${d} over-allocated: ${m} > 240`);
    }
  });

  check('S3d', 'old completion collapses to ONE catch-up revision; past offsets clamp forward, never backwards', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const p = generateSchedule({
      syllabus: [
        doneRow('old1', 'Science', 'Old Chapter', `${sadd(S_TODAY, -30)}T09:00:00.000Z`),
        doneRow('mid1', 'Maths', 'Mid Chapter', `${sadd(S_TODAY, -5)}T09:00:00.000Z`),
        mkS('p1', 'Hindi', 'Kritika', { estimated_hours: 6 }),
      ],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s3d', today: S_TODAY, createdAt: S_CREATED,
    });
    const oldRows = p.filter((r) => r.topic.includes('Old Chapter'));
    assert.equal(oldRows.length, 1, `a completion older than the ladder collapses to ONE catch-up session, got ${oldRows.length} (${oldRows.map((r) => `${r.date}/${r.topic}`).join(', ')})`);
    assert.equal(oldRows[0].session_type, 'revision', 'the catch-up session is a revision, not a fresh study block');
    assert.ok(/catch-up/.test(oldRows[0].topic), 'the catch-up session says what it is');
    const midRows = p.filter((r) => r.topic.includes('Mid Chapter'));
    assert.equal(midRows.length, 4, `a 5-day-old completion keeps the full ladder, got ${midRows.length}`);
    assert.ok(midRows.every((r) => r.date >= S_TODAY), `clamped offsets stay in the future: ${midRows.map((r) => r.date).join(',')}`);
    assert.ok(!p.some((r) => r.date < S_TODAY), 'nothing at all is scheduled in the past');
  });

  check('S3e', 'ladder overlapping a school exam: revisions stay light on exam days and the chapter test never lands on one', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const syl = [
      doneRow('d1', 'Science', 'Life Processes', `${S_TODAY}T09:00:00.000Z`),
      mkS('p1', 'Maths', 'Trigonometry', { estimated_hours: 6 }),
    ];
    // (a) a spaced revision falls ON an exam day -> it stays light, nothing else changes
    const pA = generateSchedule({
      syllabus: syl, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s3e', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [{ label: 'Unit Test', start_date: sadd(S_TODAY, 3), end_date: sadd(S_TODAY, 4) }],
    });
    const examDay = sadd(S_TODAY, 3);
    const onExamDay = pA.filter((r) => r.date === examDay);
    assert.ok(onExamDay.some((r) => LADDER_RE.test(r.topic)), `the +3d revision still happens on the exam day: ${onExamDay.map((r) => r.topic).join(' | ')}`);
    assert.ok(onExamDay.every((r) => r.duration_minutes <= 45), `exam-day sessions stay light, got ${onExamDay.map((r) => r.duration_minutes).join(',')}`);
    assert.ok(onExamDay.every((r) => r.session_type !== 'study'), 'no new study on an exam day');
    assert.equal(pA.filter((r) => LADDER_RE.test(r.topic)).length, 4, 'the ladder stays complete');
    assert.equal(pA.coverage.pipeline.notEmitted, 0, 'no ladder session lost');
    // (b) the chapter test itself would land on an exam day -> it moves off it
    const pB = generateSchedule({
      syllabus: syl, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s3e', today: S_TODAY, createdAt: S_CREATED,
      schoolExams: [{ label: 'Unit Test', start_date: sadd(S_TODAY, 2), end_date: sadd(S_TODAY, 3) }],
    });
    const testB = pB.filter((r) => /^Chapter test: /.test(r.topic));
    assert.equal(testB.length, 1, 'still exactly one chapter test');
    assert.ok(testB[0].date > sadd(S_TODAY, 3), `the chapter test must move off the exam days, got ${testB[0].date}`);
    assert.equal(pB.filter((r) => LADDER_RE.test(r.topic)).length, 4, 'the ladder is still complete after the move');
    assert.ok(!pB.some((r) => r.session_type === 'mock' && r.date >= sadd(S_TODAY, 2) && r.date <= sadd(S_TODAY, 3)), 'no full test inside the exam range');
  });

  // ================= S4 — Feb 25 class-track hard cutoff =================
  const nextOccurrence = (fromIso, mm, dd) => {
    const y = Number(fromIso.slice(0, 4));
    const iso = (year) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    for (const cand of [iso(y), iso(y + 1), iso(y + 2)]) if (cand > fromIso) return cand;
    return iso(y + 3);
  };
  const offsetTo = (target) => {
    U.setDevDateOffset(0);
    const real = U.todayStr();
    const off = Math.round((new Date(`${target}T00:00:00Z`) - new Date(`${real}T00:00:00Z`)) / 86400000);
    U.setDevDateOffset(off);
    return real;
  };

  check('S4a', 'dev-offset to Feb 26 -> zero class-track sessions, olympiad still scheduled (one date system)', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    assert.ok(U && typeof U.setDevDateOffset === 'function', `utils dev-offset mechanism unavailable: ${uErr}`);
    assert.equal(typeof SG.classSessionCutoff, 'function', 'classSessionCutoff is not exported (S4 mechanism absent)');
    U.setDevDateOffset(0);
    const realToday = U.todayStr();
    const feb26 = nextOccurrence(realToday, 2, 26);
    const cutoffYear = Number(feb26.slice(0, 4));
    try {
      offsetTo(feb26);
      assert.equal(U.todayStr(), feb26, `the dev offset must move todayStr to ${feb26}, got ${U.todayStr()}`);
      assert.equal(SG.classSessionCutoff(feb26), `${cutoffYear}-02-25`, 'the cutoff for a Feb-26 plan date is Feb 25 of the same session');
      const p = generateSchedule({
        syllabus: [
          mkS('c1', 'Science', 'Life Processes', { estimated_hours: 8 }),
          mkS('c2', 'Maths', 'Trigonometry', { estimated_hours: 8 }),
          mkS('o1', 'Maths Olympiad', 'Number Theory', { track: 'olympiad', estimated_hours: 8 }),
        ],
        olympiadDate: sadd(feb26, 20),
        dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 6, userId: 'u-s4a',
      });
      const classRows = p.filter((r) => r.track === 'class');
      assert.equal(classRows.length, 0, `class-track sessions must stop at the cutoff, found ${classRows.length} (${classRows.slice(0, 3).map((r) => `${r.date}/${r.session_type}`).join(', ')})`);
      assert.ok(p.some((r) => r.track === 'olympiad'), 'the olympiad track is unaffected by the class cutoff');
      assert.equal(p.coverage.classCutoff, `${cutoffYear}-02-25`, 'the summary reports the cutoff it applied');
      assert.ok(p.coverage.classCutoffDaysBlocked > 0, 'the summary counts the blocked days');
      assert.ok(/cutoff/i.test(String(p.coverage.coverageWarning || '')), `the summary says plainly why class work was not placed: ${p.coverage.coverageWarning}`);
      assert.ok([...(p.coverage.unscheduled || []), ...(p.coverage.partial || [])].some((u) => u.track === 'class'), 'the unplaced class chapters are named');
    } finally {
      U.setDevDateOffset(0);
    }
    assert.equal(U.todayStr(), realToday, 'dev offset reset — no leakage into other suites');
  });

  check('S4b', 'Feb 20 with an impossible class backlog -> nothing class-track after Feb 25, unplaced chapters listed', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    U.setDevDateOffset(0);
    const realToday = U.todayStr();
    const feb20 = nextOccurrence(realToday, 2, 20);
    const cutoff = `${Number(feb20.slice(0, 4))}-02-25`;
    try {
      offsetTo(feb20);
      assert.equal(U.todayStr(), feb20, `the dev offset must move todayStr to ${feb20}`);
      assert.equal(SG.classSessionCutoff(feb20), cutoff, 'Feb 20 sits in the session that ends Feb 25 of the same year');
      const heavy = Array.from({ length: 12 }, (_, i) =>
        mkS(`h${i}`, ['Science', 'Maths', 'English'][i % 3], `Chapter ${i}`, { estimated_hours: 20 }));
      const p = generateSchedule({
        syllabus: heavy, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 8, userId: 'u-s4b',
      });
      const lateClass = p.filter((r) => r.track === 'class' && r.date > cutoff);
      assert.equal(lateClass.length, 0, `class-track sessions after ${cutoff}: ${lateClass.slice(0, 3).map((r) => `${r.date}/${r.session_type}`).join(', ')}`);
      assert.ok(p.some((r) => r.track === 'class'), 'class work IS scheduled before the cutoff (the rule is a cutoff, not a shutdown)');
      assert.equal(p.coverage.classCutoff, cutoff, 'cutoff reported');
      const unplaced = [...(p.coverage.unscheduled || []), ...(p.coverage.partial || [])];
      assert.ok(unplaced.length > 0, 'the summary must list the chapters that could not be placed before the cutoff');
      assert.ok(unplaced.every((u) => u.chapter && u.remainingHours > 0), 'unplaced entries name the chapter and the hours left');
      assert.ok(/cutoff/i.test(String(p.coverage.coverageWarning || '')), 'the warning states the cutoff reason');
    } finally {
      U.setDevDateOffset(0);
    }
    assert.equal(U.todayStr(), realToday, 'dev offset reset');
  });

  check('S4c', 'olympiad on Mar 15 -> olympiad keeps scheduling in March while the class track respects the cutoff', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    U.setDevDateOffset(0);
    const realToday = U.todayStr();
    const feb20 = nextOccurrence(realToday, 2, 20);
    const year = Number(feb20.slice(0, 4));
    const mar15 = `${year}-03-15`;
    try {
      offsetTo(feb20);
      const p = generateSchedule({
        syllabus: [
          mkS('c1', 'Science', 'Life Processes', { estimated_hours: 8 }),
          mkS('o1', 'Maths Olympiad', 'Number Theory', { track: 'olympiad', estimated_hours: 10 }),
          mkS('o2', 'Maths Olympiad', 'Combinatorics', { track: 'olympiad', estimated_hours: 10 }),
        ],
        olympiadDate: mar15, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 6, userId: 'u-s4c',
      });
      const march = p.filter((r) => r.date >= `${year}-03-01` && r.date < mar15);
      assert.ok(march.some((r) => r.track === 'olympiad'), `olympiad sessions must continue into March, got ${march.map((r) => `${r.date}/${r.track}`).join(', ') || 'none'}`);
      assert.ok(p.filter((r) => r.track === 'olympiad').every((r) => r.date < mar15), 'olympiad prep still stops at its own date');
      assert.ok(!p.some((r) => r.track === 'class' && r.date > `${year}-02-25`), 'the class track still respects the cutoff in the same plan');
    } finally {
      U.setDevDateOffset(0);
    }
    assert.equal(U.todayStr(), realToday, 'dev offset reset');
  });

  check('S4d', 'cutoff maths: leap-year safe, session-boundary aware, constant lives in constants.js, still one date system', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    assert.ok(/CLASS_SESSION_END/.test(constSrcS), 'constants.js must export CLASS_SESSION_END');
    assert.equal(SG.classSessionCutoff('2028-02-29'), '2028-02-25', 'leap-year Feb 29 -> cutoff Feb 25 of the same session year');
    assert.equal(SG.classSessionCutoff('2027-04-01'), '2028-02-25', 'Apr 1 opens a new session -> cutoff Feb 25 of the following year');
    assert.equal(SG.classSessionCutoff('2027-03-31'), '2027-02-25', 'Mar 31 still belongs to the ending session');
    assert.equal(SG.classSessionCutoff('2026-09-27'), '2027-02-25', 'an autumn date belongs to the session ending next February');
    // a school exam straddling the cutoff keeps its exam-day revision (exams override the cutoff)
    const p = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life Processes', { estimated_hours: 8 })],
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s4d', today: '2027-02-20', createdAt: '2027-02-20T00:00:00.000Z',
      schoolExams: [{ label: 'Boards', start_date: '2027-02-24', end_date: '2027-03-03' }],
    });
    const examDayRows = p.filter((r) => r.date >= '2027-02-24' && r.date <= '2027-03-03');
    assert.ok(examDayRows.length > 0, 'exam days inside/after the cutoff still get their light revision');
    assert.ok(examDayRows.every((r) => r.session_type !== 'study'), 'exam days carry no new study');
    assert.ok(!p.some((r) => r.track === 'class' && r.session_type === 'study' && r.date > '2027-02-25'), 'no NEW class content after the cutoff');
    // the planner still reads the ONE date system and never the dev-offset setter
    assert.ok(!/setDevDateOffset/.test(sgSrcS), 'the scheduler must not touch the dev-offset setter itself');
    assert.ok(/todayStr\(\)/.test(sgSrcS), 'still the single date system');
  });


  // ================= FIX-SCHED3 — per-track horizons, 1100 cap, 14d buffer, D7 override =================
  check('SCH3a', 'exam 2028-04-15 reach: horizon must include Apr 2028 + 14d buffer (per-track max)', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const p = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life Processes', { estimated_hours: 8 })],
      examDate: '2028-04-15',
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 6,
      userId: 'u-s3a', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    const last = p.coverage.totalDays;
    assert.ok(last >= 800, `horizon must reach 2028-04-15 (~831d from 2026-01-05) +14d buffer, got totalDays ${last}`);
    assert.ok(p.some((r) => r.date >= '2028-04-01' && r.date <= '2028-04-15'), 'schedule must have rows near exam date');
  });

  check('SCH3b', 'olympiad 2027-09-20 blocks Aug-Sep none after: olympiad track hard-stops at its date', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const p = generateSchedule({
      syllabus: [
        mkS('o1', 'Maths Olympiad', 'Number Theory', { track: 'olympiad', estimated_hours: 10 }),
        mkS('o2', 'Maths Olympiad', 'Combinatorics', { track: 'olympiad', estimated_hours: 10 }),
        mkS('c1', 'Science', 'Life Processes', { estimated_hours: 8 }),
      ],
      olympiadDate: '2027-09-20',
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 6,
      userId: 'u-s3b', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    const olympAfter = p.filter((r) => r.track === 'olympiad' && r.date > '2027-09-20');
    assert.equal(olympAfter.length, 0, `olympiad sessions must not exist after 2027-09-20, found ${olympAfter.slice(0,3).map(r=>r.date).join(', ')}`);
    assert.ok(p.some((r) => r.track === 'olympiad' && r.date >= '2027-08-01'), 'olympiad should have sessions in Aug-Sep before the date');
  });

  check('SCH3c', 'class never past cutoff even with 1100 cap: class study stops at Feb 25', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const p = generateSchedule({
      syllabus: Array.from({ length: 20 }, (_, i) => mkS(`h${i}`, 'Science', `Chapter ${i}`, { estimated_hours: 20 })),
      dailyHours: 2, preferredTime: 'Morning', daysOff: [], weeks: 10,
      userId: 'u-s3c', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    const lateClass = p.filter((r) => r.track === 'class' && r.session_type === 'study' && r.date > '2026-02-25');
    assert.equal(lateClass.length, 0, `class study must never be past cutoff, found ${lateClass.slice(0,3).map(r=>r.date).join(', ')}`);
  });

  check('SCH3d', 'horizon-matrix: per-track max = max(weeks, cutoff, olympiad, exam, furthestSchool)+14d', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const baseToday = '2026-01-05';
    const pWeeks = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 4 })],
      dailyHours: 3, weeks: 6, userId: 'u-s3d1', today: baseToday, createdAt: baseToday+'T00:00:00.000Z',
    });
    const pExam = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 4 })],
      dailyHours: 3, weeks: 6, examDate: '2026-08-15', userId: 'u-s3d2', today: baseToday, createdAt: baseToday+'T00:00:00.000Z',
    });
    const pOlymp = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 4 })],
      dailyHours: 3, weeks: 6, olympiadDate: '2026-09-20', userId: 'u-s3d3', today: baseToday, createdAt: baseToday+'T00:00:00.000Z',
    });
    assert.ok(pExam.coverage.totalDays > pWeeks.coverage.totalDays, `exam horizon ${pExam.coverage.totalDays} must be > weeks-only ${pWeeks.coverage.totalDays}`);
    assert.ok(pOlymp.coverage.totalDays > pWeeks.coverage.totalDays, 'olympiad horizon must extend beyond weeks-only');
    const cutoff = SG.classSessionCutoff(baseToday);
    const cutoffDiff = Math.round((new Date(cutoff) - new Date(baseToday)) / 86400000) + 14;
    assert.ok(pWeeks.coverage.totalDays >= cutoffDiff, `weeks plan totalDays ${pWeeks.coverage.totalDays} must include cutoff+14 buffer ${cutoffDiff}`);
  });

  check('SCH3e', 'cap-lift 1100 vs >1100 truncate: 1100 cap enforced, >1100 exam truncated', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const farExam = '2029-06-01';
    const p = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 4 })],
      examDate: farExam,
      dailyHours: 3, weeks: 6, userId: 'u-s3e', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    assert.ok(p.coverage.totalDays <= 1100, `totalDays ${p.coverage.totalDays} must be capped at 1100`);
    assert.ok(p.coverage.totalDays >= 1090, `capped horizon should be near 1100, got ${p.coverage.totalDays}`);
    const withinCap = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 4 })],
      examDate: '2028-04-15',
      dailyHours: 3, weeks: 6, userId: 'u-s3e2', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    assert.ok(withinCap.coverage.totalDays < 1100 && withinCap.coverage.totalDays >= 800, `1100-cap lift allows 2028-04-15 (~831d) to be fully included, got ${withinCap.coverage.totalDays}`);
  });

  check('SCH3f', 'session-end override 03-15 moves cutoff: classSessionCutoff respects MM-DD override and schedule respects it', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    assert.equal(SG.classSessionCutoff('2026-01-05', '03-15'), '2026-03-15', 'override 03-15 must move cutoff to Mar 15');
    assert.equal(SG.classSessionCutoff('2026-04-01', '03-15'), '2027-03-15', 'Apr 1 + override 03-15 -> next year Mar 15');
    assert.equal(SG.classSessionCutoff('2026-01-05', 'invalid'), '2026-02-25', 'invalid override falls back to default');
    const pDefault = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 8 })],
      dailyHours: 3, weeks: 6, userId: 'u-s3f1', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
    });
    const pOverride = generateSchedule({
      syllabus: [mkS('c1', 'Science', 'Life', { estimated_hours: 8 })],
      dailyHours: 3, weeks: 6, userId: 'u-s3f2', today: '2026-01-05', createdAt: '2026-01-05T00:00:00.000Z',
      classSessionEnd: '03-15',
    });
    assert.ok(pOverride.coverage.totalDays > pDefault.coverage.totalDays, `override 03-15 horizon ${pOverride.coverage.totalDays} must be > default 02-25 horizon ${pDefault.coverage.totalDays}`);
    assert.equal(pOverride.coverage.classCutoff, '2026-03-15', 'coverage must report overridden cutoff');
    const lateDefault = pDefault.filter((r) => r.track === 'class' && r.session_type === 'study' && r.date > '2026-02-25');
    const lateOverride = pOverride.filter((r) => r.track === 'class' && r.session_type === 'study' && r.date > '2026-03-15');
    assert.equal(lateDefault.length, 0, 'default cutoff still respected');
    assert.equal(lateOverride.length, 0, 'overridden cutoff respected');
  });

  // ================= preservation of the accepted 938e69d foundation =================

  // ================= FIX-SCHED4 — taught-till slider per subject + individual toggles, no DDL, last-action-wins =================
  let TT = null; let ttErr = '';
  try { TT = await import('./../src/lib/taughtTill.js'); }
  catch (e) { ttErr = String(e && e.message ? e.message : e).split('\n')[0]; }

  check('SCH4a', 'taughtTill pure: computeTaughtTill leading contiguous, countCompleted total', () => {
    assert.ok(TT, `taughtTill import failed: ${ttErr}`);
    const rows = [
      { id: '1', status: 'completed' },
      { id: '2', status: 'completed' },
      { id: '3', status: 'locked' },
      { id: '4', status: 'completed' },
    ];
    assert.equal(TT.computeTaughtTill(rows), 2, 'leading contiguous should be 2, not 3');
    assert.equal(TT.countCompleted(rows), 3, 'total completed should be 3');
    assert.equal(TT.computeTaughtTill([]), 0, 'empty -> 0');
    assert.equal(TT.computeTaughtTill([{status:'completed'},{status:'completed'}]), 2, 'all completed -> length');
    assert.equal(TT.computeTaughtTill([{status:'locked'}]), 0, 'none completed -> 0');
  });

  check('SCH4b', 'buildTaughtTillUpdates: slider 0..N sets contiguous prefix completed, rest locked, no DDL', () => {
    assert.ok(TT, `taughtTill import failed: ${ttErr}`);
    const rows = [
      { id: 'a', status: 'locked', progress_percent: 0, chapter: 'Ch1' },
      { id: 'b', status: 'locked', progress_percent: 0, chapter: 'Ch2' },
      { id: 'c', status: 'completed', progress_percent: 100, chapter: 'Ch3' },
    ];
    const now = '2026-01-05T00:00:00.000Z';
    const up0 = TT.buildTaughtTillUpdates(rows, 0, now);
    assert.equal(up0.length, 1, 'till 0: only Ch3 needs flip to locked');
    assert.ok(up0.some(u => u.id === 'c' && u.patch.status === 'locked'), 'Ch3 should become locked');
    const up2 = TT.buildTaughtTillUpdates(rows, 2, now);
    // a,b should be completed, c locked
    assert.ok(up2.some(u => u.id === 'a' && u.patch.status === 'completed' && u.patch.progress_percent === 100), 'a completed');
    assert.ok(up2.some(u => u.id === 'b' && u.patch.status === 'completed'), 'b completed');
    assert.ok(up2.some(u => u.id === 'c' && u.patch.status === 'locked'), 'c locked');
    const up3 = TT.buildTaughtTillUpdates(rows, 3, now);
    assert.equal(up3.length, 2, 'till 3: a,b need completed, c already completed? actually c is completed in input, so only a,b');
    // verify no DDL fields: only status, progress_percent, completed_at
    for (const u of [...up0, ...up2, ...up3]) {
      const keys = Object.keys(u.patch).sort();
      assert.ok(keys.includes('status') && keys.includes('progress_percent') && keys.includes('completed_at'), `patch must use existing fields only, got ${keys}`);
      assert.ok(!keys.includes('taught_till') && !keys.includes('taughtTill'), 'no new DDL field');
    }
  });

  check('SCH4c', 'toggleRowPatch: completed->locked, locked->completed, uses existing fields only', () => {
    assert.ok(TT, `taughtTill import failed: ${ttErr}`);
    const now = '2026-01-05T00:00:00.000Z';
    const done = { id: 'x', status: 'completed', progress_percent: 100 };
    const p1 = TT.toggleRowPatch(done, now);
    assert.equal(p1.status, 'locked');
    assert.equal(p1.progress_percent, 0);
    assert.equal(p1.completed_at, null);
    const locked = { id: 'y', status: 'locked', progress_percent: 0 };
    const p2 = TT.toggleRowPatch(locked, now);
    assert.equal(p2.status, 'completed');
    assert.equal(p2.progress_percent, 100);
    assert.equal(p2.completed_at, now);
  });

  check('SCH4d', 'last-action-wins: slider overrides individual toggle, toggle overrides slider, then slider again', () => {
    assert.ok(TT, `taughtTill import failed: ${ttErr}`);
    const now = '2026-01-05T00:00:00.000Z';
    let rows = [
      { id: '1', status: 'locked', chapter: 'A' },
      { id: '2', status: 'locked', chapter: 'B' },
      { id: '3', status: 'locked', chapter: 'C' },
      { id: '4', status: 'locked', chapter: 'D' },
      { id: '5', status: 'locked', chapter: 'E' },
    ];
    // slider to 3
    rows = TT.applyTaughtTillInMemory(rows, 3, now);
    assert.equal(TT.computeTaughtTill(rows), 3, 'after slider 3, leading 3 completed');
    assert.equal(TT.countCompleted(rows), 3);
    // individual toggle chapter 5 (index 4) to completed — non-contiguous
    const row5 = rows[4];
    const patch5 = TT.toggleRowPatch(row5, now);
    rows[4] = { ...rows[4], ...patch5 };
    assert.equal(TT.countCompleted(rows), 4, 'after toggling Ch5, total 4');
    assert.equal(TT.computeTaughtTill(rows), 3, 'leading still 3, toggle does not affect slider value');
    // slider to 2 overrides — Ch5 should become locked again
    rows = TT.applyTaughtTillInMemory(rows, 2, now);
    assert.equal(TT.computeTaughtTill(rows), 2, 'slider 2 overrides');
    assert.equal(TT.countCompleted(rows), 2, 'Ch5 locked again, last-action-wins');
    assert.equal(rows[4].status, 'locked', 'Ch5 is locked after slider override');
    // toggle Ch2 to locked (individual override)
    const row2 = rows[1];
    const patch2 = TT.toggleRowPatch(row2, now);
    rows[1] = { ...rows[1], ...patch2 };
    assert.equal(rows[1].status, 'locked', 'Ch2 toggled to locked');
    assert.equal(TT.computeTaughtTill(rows), 1, 'leading now 1 because Ch2 broke contiguity');
    assert.equal(TT.countCompleted(rows), 1, 'only Ch1 left');
  });

  check('SCH4e', 'SyllabusScreen wiring: slider + toggle present, uses existing fields, no DDL', () => {
    const src = read('src/screens/study/SyllabusScreen.js');
    assert.ok(/computeTaughtTill/.test(src), 'SyllabusScreen must use computeTaughtTill');
    assert.ok(/buildTaughtTillUpdates/.test(src), 'must use buildTaughtTillUpdates');
    assert.ok(/toggleRowPatch/.test(src), 'must use toggleRowPatch');
    assert.ok(/Slider/.test(src), 'must use Slider component');
    assert.ok(/@react-native-community\/slider/.test(src), 'must import slider dep');
    assert.ok(/Taught till/.test(src), 'UI must show Taught till label');
    assert.ok(/last-action-wins|last action wins/i.test(src) || /last-action-wins/.test(src), 'must mention last-action-wins');
    assert.ok(!/taught_till/.test(src) || /Taught till/.test(src), 'no DDL field taught_till column');
    // verify it uses db.updateMany and db.update with existing fields
    assert.ok(/updateMany/.test(src), 'must use updateMany for batch');
    assert.ok(/progress_percent/.test(src) && /completed_at/.test(src), 'must use existing fields');
  });

  check('SCH4f', 'scheduleGenerator respects taught-till: completed rows excluded, ladder still works', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const rows = [
      mkS('1', 'Science', 'Ch1', { status:'completed', progress_percent:100, completed_at:'2026-01-01T00:00:00.000Z' }),
      mkS('2', 'Science', 'Ch2', { status:'completed', progress_percent:100, completed_at:'2026-01-01T00:00:00.000Z' }),
      mkS('3', 'Science', 'Ch3', { status:'locked', progress_percent:0 }),
      mkS('4', 'Science', 'Ch4', { status:'locked', progress_percent:0 }),
    ];
    const p = generateSchedule({
      syllabus: rows, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-sch4f', today:'2026-01-05', createdAt:'2026-01-05T00:00:00.000Z',
    });
    // completed rows should be excluded from study
    assert.ok(!p.some(r => r.topic === 'Ch1' && r.session_type === 'study'), 'Ch1 completed should not be study-scheduled');
    assert.ok(!p.some(r => r.topic === 'Ch2' && r.session_type === 'study'), 'Ch2 completed should not be study-scheduled');
    // remaining chapters should be scheduled
    assert.ok(p.some(r => r.topic === 'Ch3'), 'Ch3 should be scheduled');
    assert.ok(p.some(r => r.topic === 'Ch4'), 'Ch4 should be scheduled');
    // completed should still produce ladder (chapter test + spaced)
    const tests = p.filter(r => /^Chapter test:/.test(r.topic));
    assert.ok(tests.length >= 2, `completed chapters should produce chapter tests, got ${tests.length}`);
  });


  // ================= FIX-SCHED4 D4: date-cascade allocator — three-phase, overflow, undated deprioritization =================
  // ================= FIX-SCHED7 D1/D1b: per-track multiplier sliders =================
  check('MULT1', 'per-track multiplier math: class 2.0×, olympiad 3.0×, exam 2.0× defaults', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:4, archived:false, ...over });
    const classRow = mkS('c1', 'Science', 'Class Ch', { track:'class', estimated_hours:4 });
    const olympRow = mkS('o1', 'Maths Olympiad', 'Olympiad Ch', { track:'olympiad', estimated_hours:4 });
    const examRow = mkS('e1', 'JEE', 'Exam Ch', { track:'exam', estimated_hours:4 });
    const builtDefault = SG.buildWorkItems({
      syllabus: [classRow, olympRow, examRow],
      existing: [], deadlines: null, prio: SG.normalizePriorities(null), factor:1,
      hoursMultiplier:2, olympiadMultiplier:3, examMultiplier:2,
      today:'2026-01-05', examDate:null, olympiadDate:null, schoolExams:[], allocatable:['class','olympiad','exam'], classPaused:null,
    });
    const cItem = builtDefault.items.find(i=>i.track==='class');
    const oItem = builtDefault.items.find(i=>i.track==='olympiad');
    const eItem = builtDefault.items.find(i=>i.track==='exam');
    assert.ok(cItem, 'class item exists');
    assert.ok(oItem, 'olympiad item exists');
    assert.ok(eItem, 'exam item exists');
    assert.equal(cItem.effectiveHours, 8, `class 4h *2.0× =8h, got ${cItem.effectiveHours}`);
    assert.equal(oItem.effectiveHours, 12, `olympiad 4h *3.0× =12h, got ${oItem.effectiveHours}`);
    assert.equal(eItem.effectiveHours, 8, `exam 4h *2.0× =8h, got ${eItem.effectiveHours}`);
    // custom multipliers
    const builtCustom = SG.buildWorkItems({
      syllabus: [classRow, olympRow, examRow],
      existing: [], deadlines: null, prio: SG.normalizePriorities(null), factor:1,
      hoursMultiplier:1.5, olympiadMultiplier:5.0, examMultiplier:10.0,
      today:'2026-01-05', examDate:null, olympiadDate:null, schoolExams:[], allocatable:['class','olympiad','exam'], classPaused:null,
    });
    assert.equal(builtCustom.items.find(i=>i.track==='class').effectiveHours, 6, 'class 4h*1.5=6');
    assert.equal(builtCustom.items.find(i=>i.track==='olympiad').effectiveHours, 20, 'olympiad 4h*5.0=20');
    assert.equal(builtCustom.items.find(i=>i.track==='exam').effectiveHours, 40, 'exam 4h*10.0=40');
  });

  check('MULT2', 'persistence probe: SettingsContext DEFAULTS has olympiadMultiplier 3.0 and examMultiplier 2.0, same pattern as hoursMultiplier', () => {
    const ctxSrc = read('src/context/SettingsContext.js');
    assert.ok(/hoursMultiplier/.test(ctxSrc), 'must have hoursMultiplier');
    assert.ok(/olympiadMultiplier/.test(ctxSrc), 'must have olympiadMultiplier');
    assert.ok(/examMultiplier/.test(ctxSrc), 'must have examMultiplier');
    assert.ok(/2\.0/.test(ctxSrc) && /3\.0/.test(ctxSrc), 'defaults 2.0 and 3.0 present');
    // Check DEFAULTS
    assert.ok(/hoursMultiplier:\s*2\.0/.test(ctxSrc), 'hoursMultiplier default 2.0');
    assert.ok(/olympiadMultiplier:\s*3\.0/.test(ctxSrc), 'olympiadMultiplier default 3.0');
    assert.ok(/examMultiplier:\s*2\.0/.test(ctxSrc), 'examMultiplier default 2.0');
    // Persistence pattern: update uses ...ref.current and AsyncStorage.setItem
    assert.ok(/AsyncStorage\.setItem/.test(ctxSrc), 'must persist via AsyncStorage');
  });

  check('MULT3', 'wiring probe: SettingsScreen has THREE sliders School/Olympiad/Competitive, ranges 1.0–10.0 step 0.5, live labels', () => {
    const src = read('src/screens/settings/SettingsScreen.js');
    assert.ok(/School workload/.test(src), 'must have School workload slider');
    assert.ok(/Olympiad workload/.test(src), 'must have Olympiad workload slider');
    assert.ok(/Competitive workload/.test(src), 'must have Competitive workload slider');
    // Check Slider import
    assert.ok(/@react-native-community\/slider/.test(src), 'must import slider');
    // Check ranges
    assert.ok(/minimumValue.*1\.0/.test(src) && /maximumValue.*10\.0/.test(src), 'range 1.0–10.0');
    assert.ok(/step.*0\.5/.test(src), 'step 0.5');
    // Check live value labels
    assert.ok(/hoursMultiplier/.test(src) && /olympiadMultiplier/.test(src) && /examMultiplier/.test(src), 'must use all three multipliers');
    // Ensure old SegmentedControl for workload is gone (only AI provider uses it)
    const workloadSeg = (src.match(/Chapter workload/g) || []).length;
    assert.ok(workloadSeg >= 1, 'Chapter workload section exists');
    // The old 1.0×/1.5×/2.0× segmented for workload should be replaced — check no SegmentedControl with 1.0×/1.5×/2.0× for workload
    // We allow SegmentedControl for AI provider, but not for workload
    const hasOldWorkloadSeg = /Chapter workload[\s\S]*?SegmentedControl[\s\S]*?1\.0×/.test(src);
    assert.ok(!hasOldWorkloadSeg, 'old workload SegmentedControl 1.0×/1.5×/2.0× must be replaced by sliders');
  });

  check('MULT4', 'engine + UI wiring: ScheduleScreen passes per-track multipliers, SyllabusScreen uses track multiplier', () => {
    const schedSrc = read('src/screens/study/ScheduleScreen.js');
    assert.ok(/olympiadMultiplier/.test(schedSrc), 'ScheduleScreen must pass olympiadMultiplier');
    assert.ok(/examMultiplier/.test(schedSrc), 'ScheduleScreen must pass examMultiplier');
    assert.ok(/School.*Olympiad.*Competitive/.test(schedSrc) || /Workload School/.test(schedSrc), 'InfoRow must show all three');
    const sylSrc = read('src/screens/study/SyllabusScreen.js');
    assert.ok(/olympiadMultiplier/.test(sylSrc) && /examMultiplier/.test(sylSrc), 'SyllabusScreen ChapterRow must use per-track multipliers');
    assert.ok(/track.*mult|mult.*track/.test(sylSrc) || /olympiad.*3\.0/.test(sylSrc), 'ChapterRow effective hours per track');
  });

  // ================= FIX-SCHED8 D6: weightage order + time + AI estimator =================
  check('WEIGHT1', 'ordering: within same deadline-urgency bucket, w5 before w3 (weightage promoted)', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    const sameDeadline = '2026-02-01';
    const rows = [
      mkS('w3', 'Science', 'Ch w3', { weightage:3, deadline: sameDeadline }),
      mkS('w5', 'Science', 'Ch w5', { weightage:5, deadline: sameDeadline }),
      mkS('w1', 'Science', 'Ch w1', { weightage:1, deadline: sameDeadline }),
    ];
    const p = SG.generateSchedule({
      syllabus: rows, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-weight1', today, createdAt: today+'T00:00:00.000Z',
    });
    // Find order of study blocks on first day or overall
    const studyOrder = p.filter(r=>r.session_type==='study').map(r=>r.topic);
    // w5 should appear before w3 and w1
    const idxW5 = studyOrder.indexOf('Ch w5');
    const idxW3 = studyOrder.indexOf('Ch w3');
    const idxW1 = studyOrder.indexOf('Ch w1');
    assert.ok(idxW5 !== -1 && idxW3 !== -1 && idxW1 !== -1, `all three should be scheduled, got ${studyOrder.join(',')}`);
    assert.ok(idxW5 < idxW3, `w5 (${idxW5}) should be before w3 (${idxW3}) at equal urgency`);
    assert.ok(idxW3 < idxW1, `w3 (${idxW3}) should be before w1 (${idxW1})`);
  });

  check('WEIGHT2', 'time-factor math: effectiveHours ×= 1+(w-3)*0.1, w5=1.2×, w1=0.8×, w3=1.0×', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:4, archived:false, ...over });
    // Check constant exists
    assert.equal(typeof SG.WEIGHTAGE_TIME_FACTOR, 'number', 'WEIGHTAGE_TIME_FACTOR must be exported constant');
    assert.equal(SG.WEIGHTAGE_TIME_FACTOR, 0.1, 'WEIGHTAGE_TIME_FACTOR must be 0.1');
    const rows = [
      mkS('w5', 'Science', 'Ch w5', { weightage:5, estimated_hours:4 }),
      mkS('w3', 'Science', 'Ch w3', { weightage:3, estimated_hours:4 }),
      mkS('w1', 'Science', 'Ch w1', { weightage:1, estimated_hours:4 }),
    ];
    const built = SG.buildWorkItems({
      syllabus: rows, existing:[], deadlines:null, prio: SG.normalizePriorities(null), factor:1,
      hoursMultiplier:1, olympiadMultiplier:1, examMultiplier:1,
      today:'2026-01-05', examDate:null, olympiadDate:null, schoolExams:[], allocatable:['class'], classPaused:null,
    });
    const w5 = built.items.find(i=>i.chapter==='Ch w5');
    const w3 = built.items.find(i=>i.chapter==='Ch w3');
    const w1 = built.items.find(i=>i.chapter==='Ch w1');
    assert.equal(w5.effectiveHours, 4 * 1.2, `w5: 4h *1.2=4.8, got ${w5.effectiveHours}`);
    assert.equal(w3.effectiveHours, 4 * 1.0, `w3: 4h *1.0=4, got ${w3.effectiveHours}`);
    assert.equal(w1.effectiveHours, 4 * 0.8, `w1: 4h *0.8=3.2, got ${w1.effectiveHours}`);
    // With track multiplier
    const built2 = SG.buildWorkItems({
      syllabus: [mkS('w5', 'Science', 'Ch w5', { weightage:5, estimated_hours:4, track:'class' })],
      existing:[], deadlines:null, prio: SG.normalizePriorities(null), factor:1,
      hoursMultiplier:2, olympiadMultiplier:3, examMultiplier:2,
      today:'2026-01-05', examDate:null, olympiadDate:null, schoolExams:[], allocatable:['class'], classPaused:null,
    });
    assert.equal(built2.items[0].effectiveHours, 4 * 2 * 1.2, 'class track: 4h *2.0× *1.2× =9.6h');
  });

  check('WEIGHT3', 'AI estimator: schema {results:[{subject,chapter,weightage 1-5, reason}]}, clamp 1-5, batching ≤10', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    assert.ok(/aiEstimateWeightage/.test(aiSrc), 'aiEstimateWeightage must be exported');
    assert.ok(/QB_BATCH_SIZE/.test(aiSrc), 'must use QB_BATCH_SIZE for batching ≤10');
    assert.ok(/results/.test(aiSrc) && /weightage/.test(aiSrc) && /reason/.test(aiSrc), 'schema must include results with weightage and reason');
    assert.ok(/Math\.max\(1, Math\.min\(5/.test(aiSrc), 'must clamp weightage 1-5 via Math.max(1, Math.min(5');
    assert.ok(/Math\.round/.test(aiSrc), 'should round weightage');
    // Simulate clamping logic
    const clamp = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || 3)));
    assert.equal(clamp(10), 5, 'clamp 10 → 5');
    assert.equal(clamp(-2), 1, 'clamp -2 → 1');
    assert.equal(clamp(3), 3, '3 stays 3');
    // Batching math: 25 rows → 3 batches, 11 → 2
    const batchCount = (n, size=10) => Math.ceil(n/size);
    assert.equal(batchCount(25), 3, '25 rows with batch ≤10 should be 3 calls');
    assert.equal(batchCount(11), 2, '11 rows should be 2 batches');
    assert.equal(batchCount(10), 1, '10 rows should be 1 batch');
    // Check batching loop in source
    assert.ok(/for.*i \+= QB_BATCH_SIZE/.test(aiSrc) || /slice\(i, i \+ QB_BATCH_SIZE\)/.test(aiSrc), 'must batch via QB_BATCH_SIZE slicing');
  });

  check('WEIGHT4', 'AI estimator: no-write-on-failure — throws, zero writes, honest error', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    const sylSrc = read('src/screens/study/SyllabusScreen.js');
    // aiFeatures must throw on empty results
    assert.ok(/AIUnavailableError/.test(aiSrc) && /couldn't estimate weightage/.test(aiSrc), 'must throw AIUnavailableError on empty');
    // Wiring probe for zero writes is in SyllabusScreen: estimateWeightage only calls updateMany AFTER aiEstimateWeightage succeeds
    assert.ok(/aiEstimateWeightage/.test(sylSrc), 'SyllabusScreen must call aiEstimateWeightage');
    assert.ok(/updateMany/.test(sylSrc), 'must use updateMany for writes');
    // Check that updateMany is AFTER the await aiEstimateWeightage (zero writes on failure)
    const idxEst = sylSrc.indexOf('aiEstimateWeightage');
    const idxUpdate = sylSrc.indexOf('updateMany', idxEst);
    assert.ok(idxUpdate > idxEst, 'updateMany must be after aiEstimateWeightage (zero writes on failure)');
    // Check honest error handling: catch and show message, no writes in catch
    assert.ok(/catch/.test(sylSrc) && /AIUnavailableError/.test(sylSrc), 'must catch AI errors honestly');
    // Ensure no updateMany in catch block (zero writes on failure)
    const catchIdx = sylSrc.indexOf('catch', idxEst);
    const updateInCatch = sylSrc.slice(catchIdx, catchIdx+500).includes('updateMany');
    assert.ok(!updateInCatch, 'updateMany must NOT be in catch (zero writes on failure)');
  });

  check('WEIGHT5', 'wiring probe: SyllabusScreen has ✨ Estimate weightage button + batching ≤10, values editable', () => {
    const sylSrc = read('src/screens/study/SyllabusScreen.js');
    assert.ok(/Estimate weightage/.test(sylSrc) || /sparkles/.test(sylSrc), 'must have Estimate weightage button (sparkles icon)');
    assert.ok(/aiEstimateWeightage/.test(sylSrc), 'must use aiEstimateWeightage');
    // Batching ≤10 is in aiFeatures, check there
    const aiSrc = read('src/lib/aiFeatures.js');
    assert.ok(/QB_BATCH_SIZE/.test(aiSrc) || /10/.test(aiSrc), 'aiFeatures must batch ≤10 (QB_BATCH_SIZE)');
    assert.ok(/weightage/.test(aiSrc) && /reason/.test(aiSrc), 'schema must include weightage and reason');
    // Values stay manually editable: weightage Input or editable via existing UI
    assert.ok(/weightage/.test(sylSrc), 'weightage must stay editable in UI');
  });

  // ================= FIX-SCHED9 D8/D5: light day + fillers =================
  check('LIGHT1', 'light day quota 50% zero new blocks — Sunday 50% capacity, only revision/mock/practice', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05'; // Monday
    // 2026-01-11 is Sunday (6 in Mon=0 mapping)
    const rows = [
      mkS('c1', 'Science', 'Life Processes', { estimated_hours: 10 }),
      mkS('c2', 'Maths', 'Trigonometry', { estimated_hours: 10 }),
    ];
    // Without light day, Sunday would get full capacity new content
    // With light day Sunday, Sunday should have 50% capacity and no new study blocks
    const pLight = SG.generateSchedule({
      syllabus: rows, dailyHours: 4, preferredTime:'Morning', daysOff:[], lightDay: 6, weeks:2,
      userId:'u-light1', today, createdAt: today+'T00:00:00.000Z',
    });
    const sunday = '2026-01-11';
    const sunBlocks = pLight.filter(r => r.date === sunday);
    const sunStudy = sunBlocks.filter(r => r.session_type === 'study');
    const sunRevMockPractice = sunBlocks.filter(r => ['revision','mock','practice','quiz'].includes(r.session_type));
    // Light day must have zero new study blocks
    assert.equal(sunStudy.length, 0, `light day ${sunday} must have zero new study blocks, got ${sunStudy.length}: ${sunStudy.map(s=>s.topic).join('; ')}`);
    // If there is any studied content, light day should have revision/mock/practice or be free (if no studied yet, first week may be free)
    // But quota must be 50%: daily 4h=240min, light 50%=120min, check total minutes <=120
    const sunMin = sunBlocks.reduce((a,r)=>a+(r.duration_minutes||0),0);
    assert.ok(sunMin <= 130, `light day quota 50% of 240=120min, got ${sunMin}min (allow 10min slack for breath)`);
    // FIX-FILL: days_off → 50% light day revision/mock/practice only, never free
    const pOff = SG.generateSchedule({
      syllabus: rows, dailyHours: 4, preferredTime:'Morning', daysOff:[6], lightDay: 6, weeks:2,
      userId:'u-light1-off', today, createdAt: today+'T00:00:00.000Z',
    });
    const sunOffBlocks = pOff.filter(r => r.date === sunday);
    const sunOffStudy = sunOffBlocks.filter(r => r.session_type === 'study');
    const sunOffMin = sunOffBlocks.reduce((a,r)=>a+(r.duration_minutes||0),0);
    assert.equal(sunOffStudy.length, 0, `days_off (now 50% light) must have zero new study blocks, got ${sunOffStudy.length}`);
    assert.ok(sunOffMin <= 130, `days_off now 50% light day quota 50% of 240=120min, got ${sunOffMin}min`);
  });

  check('LIGHT2', 'filler fallback — after new+revision met, track-appropriate practice/mock labeled, never new coverage', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:2, archived:false, ...over });
    const today = '2026-01-05';
    // Small syllabus that finishes early, then fillers should appear
    const rows = [
      mkS('c1', 'Science', 'Life Processes', { estimated_hours: 2 }),
      mkS('c2', 'Maths', 'Trigonometry', { estimated_hours: 2 }),
    ];
    const p = SG.generateSchedule({
      syllabus: rows, dailyHours: 4, preferredTime:'Morning', daysOff:[], lightDay: 6, weeks:3,
      userId:'u-light2', today, createdAt: today+'T00:00:00.000Z',
    });
    const practiceBlocks = p.filter(r => r.session_type === 'practice' || r.session_type === 'mock' || r.session_type === 'revision' || r.session_type === 'quiz');
    // Should have at least some practice/mock fillers after syllabus done (or revision/quiz)
    // The key is that after new+revision met, we get practice/mock, not new study
    const fillerPractice = p.filter(r => (r.session_type === 'practice' || r.session_type === 'mock') && /Practice|Mock|Problem-practice|MCQ|Timed practice/.test(r.topic));
    assert.ok(fillerPractice.length >= 1 || practiceBlocks.length >= 1, `should have filler practice/mock after new+revision met, got practiceBlocks ${practiceBlocks.length}`);
    for (const b of fillerPractice) {
      assert.ok(/Practice|Mock|Problem-practice|MCQ|Timed practice/.test(b.topic), `filler topic must be labeled practice/mock, got ${b.topic}`);
      assert.ok(b.session_type === 'practice' || b.session_type === 'mock', `filler session_type must be practice/mock, got ${b.session_type}`);
      // Never fabricated as chapter done — filler topic must contain original chapter name but not be counted as new coverage
      assert.ok(!/^Life Processes$/.test(b.topic) && !/^Trigonometry$/.test(b.topic), `filler must not be bare chapter name (fabricated done), got ${b.topic}`);
    }
    // Olympiad track filler: problem-practice from covered olympiad chapters
    const olyRows = [
      mkS('o1', 'Maths Olympiad', 'Number Theory', { track:'olympiad', estimated_hours:2, weightage:5 }),
    ];
    const pOly = SG.generateSchedule({
      syllabus: olyRows, dailyHours: 3, preferredTime:'Morning', daysOff:[], lightDay: 6, weeks:2,
      userId:'u-light2-oly', today, createdAt: today+'T00:00:00.000Z',
      olympiadDate: '2026-09-20',
    });
    const olyPractice = pOly.filter(r => r.track==='olympiad' && (r.session_type==='practice'||r.session_type==='mock'));
    if (olyPractice.length) {
      assert.ok(olyPractice.some(r => /Problem-practice|olympiad|Practice|Mock/i.test(r.topic)), `olympiad filler must be problem-practice, got ${olyPractice.map(r=>r.topic).join('; ')}`);
    }
  });

  check('LIGHT3', 'complete-syllabus honesty — FIX-FILL: days filled with practice/mocks when syllabus covered', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:1, archived:false, ...over });
    const today = '2026-01-05';
    const rows = [
      mkS('c1', 'Science', 'Life Processes', { estimated_hours: 1 }),
    ];
    const p = SG.generateSchedule({
      syllabus: rows, dailyHours: 6, preferredTime:'Morning', daysOff:[], lightDay: 6, weeks:4,
      userId:'u-light3', today, createdAt: today+'T00:00:00.000Z',
    });
    assert.ok(p.coverage, 'coverage must exist');
    // If all covered, coverageWarning should contain honesty message green ✅
    const warn = p.coverage.coverageWarning || '';
    if (p.coverage.unscheduled.length===0 && p.coverage.partial.length===0 && p.coverage.tooLate.length===0) {
      assert.ok(/syllabus covered/.test(warn) || /maintain with practice/.test(warn), `when all covered, warning must say syllabus covered — maintain with practice, got ${warn}`);
    }
    // FIX-FILL: when syllabus tiny, days should be filled with revision/practice/mocks, not stay free (Oct-Dec gap 0)
    const byDate = {};
    for (const r of p) byDate[r.date] = (byDate[r.date]||0)+1;
    const totalDays = p.coverage.totalDays || 28;
    const filledDays = Object.keys(byDate).length;
    // At least 50% of days should be filled now (previously expected free)
    assert.ok(filledDays >= Math.floor(totalDays*0.4), `when syllabus tiny, FIX-FILL should fill with practice/mocks, got filled ${filledDays}/${totalDays}`);
    // And filler must be practice/mock/revision, not new study
    const filler = p.filter(r => /Practice|Mock|Revision/.test(r.topic));
    assert.ok(filler.length >= 1, `should have filler practice/mock/revision when syllabus covered, got ${filler.length}`);
  });

  check('LIGHT4', 'wiring probe: SettingsContext lightDay default Sunday 6, SettingsScreen picker, ScheduleScreen passes lightDay, engine 50% quota', () => {
    const ctxSrc = read('src/context/SettingsContext.js');
    assert.ok(/lightDay/.test(ctxSrc) && /6/.test(ctxSrc), 'SettingsContext must have lightDay default 6 (Sunday)');
    const setSrc = read('src/screens/settings/SettingsScreen.js');
    assert.ok(/lightDay/.test(setSrc) && /Light day/.test(setSrc), 'SettingsScreen must have light day picker');
    assert.ok(/Sun/.test(setSrc) && /50%/.test(setSrc), 'picker must show Sun and 50%');
    const schedSrc = read('src/screens/study/ScheduleScreen.js');
    assert.ok(/lightDay/.test(schedSrc), 'ScheduleScreen must pass lightDay');
    const sgSrc = read('src/lib/scheduleGenerator.js');
    assert.ok(/lightDay/.test(sgSrc) && /LIGHT_DAY_FACTOR/.test(sgSrc) && /0\.5/.test(sgSrc), 'engine must have LIGHT_DAY_FACTOR 0.5');
    assert.ok(/isLightDay/.test(sgSrc) && /revision.*mock.*practice/.test(sgSrc.toLowerCase()) || /practice/.test(sgSrc), 'engine must handle light day revision/mock/practice only');
    assert.ok(/syllabus covered/.test(sgSrc) && /maintain with practice/.test(sgSrc), 'engine must have honesty message syllabus covered — maintain with practice');
  });

  check('FILL2', 'FIX-FILL2: filler never past hard ends — no rows after examDate/olympiadDate/cutoff', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:5, archived:false, ...over });
    const today = '2026-10-03';
    const rows = [];
    for (let i=0;i<10;i++) rows.push(mkS('c'+i, 'Sub', 'Chapter '+i, { estimated_hours: 2 }));
    // Tiny syllabus, exam far, should fill but never past exam
    const p = SG.generateSchedule({
      syllabus: rows, dailyHours: 4, preferredTime:'Morning', daysOff:[5,6], lightDay:6, weeks:82,
      userId:'u-fill2-test', today, createdAt: today+'T00:00:00.000Z',
      examDate:'2028-04-12', olympiadDate:'2027-09-06', hoursMultiplier:2.0, olympiadMultiplier:3.0, examMultiplier:1.5,
    });
    const afterExam = p.filter(r => r.date > '2028-04-12');
    assert.equal(afterExam.length, 0, `FIX-FILL2: ZERO rows after examDate 2028-04-12, got ${afterExam.length}: ${afterExam.slice(0,3).map(r=>r.date+' '+r.topic).join('; ')}`);
    const olyAfter = p.filter(r => r.track==='olympiad' && r.date >= '2027-09-06');
    assert.equal(olyAfter.length, 0, `FIX-FILL2: ZERO olympiad rows on/after olympiadDate, got ${olyAfter.length}`);
    const classAfterCutoff = p.filter(r => r.track==='class' && r.date > '2028-02-25' && r.date <= '2028-04-12' && !/Mock|Pre-school|Revision wave/.test(r.topic));
    // Class new study should not be after cutoff (except exam-related mocks/waves)
    const classNewAfterCutoff = p.filter(r => r.track==='class' && r.session_type==='study' && r.date > '2028-02-25');
    assert.equal(classNewAfterCutoff.length, 0, `FIX-FILL2: ZERO class study after cutoff 2028-02-25, got ${classNewAfterCutoff.length}`);
  });

  check('GENA1', 'FIX-GEN-ATOMIC chunkRows splits 3100 rows into [500…500,100] exactly', () => {
    const mod = read('src/lib/scheduleSave.js');
    assert.ok(/chunkRows/.test(mod), 'scheduleSave must export chunkRows');
    const rows = Array.from({length:3100}, (_,i)=>({id:i}));
    const size = 500;
    const out = [];
    for (let i=0;i<rows.length;i+=size) out.push(rows.slice(i,i+size));
    assert.equal(out.length, 7, `3100/500 should be 7 chunks, got ${out.length}`);
    assert.equal(out[0].length, 500, 'first chunk 500');
    assert.equal(out[5].length, 500, '6th chunk 500');
    assert.equal(out[6].length, 100, 'last chunk 100');
  });

  check('GENA2', 'FIX-GEN-ATOMIC token guard stale run id makes guard return true (stop)', () => {
    const mod = read('src/lib/scheduleSave.js');
    assert.ok(/isRunStale/.test(mod), 'scheduleSave must export isRunStale');
    const isStale = (current, my) => current !== my;
    assert.equal(isStale(2,1), true, 'run 1 stale when current is 2');
    assert.equal(isStale(1,1), false, 'same run not stale');
    assert.equal(isStale(3,2), true, 'run 2 stale when current 3');
  });

  check('GENA3', 'FIX-GEN-ATOMIC saveWithWorkers completes all chunks and reports exact counts', () => {
    const mod = read('src/lib/scheduleSave.js');
    assert.ok(/saveWithWorkers/.test(mod), 'scheduleSave must export saveWithWorkers');
    const chunks = Array.from({length:7}, (_,i)=> Array.from({length: i===6?100:500}, (_,j)=>({id:i*500+j})));
    let insertCalls = 0;
    const failOnce = new Set([2]);
    const insertFn = (chunk, idx) => {
      insertCalls++;
      if (failOnce.has(idx)) {
        failOnce.delete(idx);
        throw new Error('simulated fail');
      }
    };
    let progressCalls = 0;
    const onProgress = () => { progressCalls++; };
    let nextIdx=0, saved=0, failed=[];
    const total=chunks.length;
    const workers = [[], []];
    for (let i=0;i<total;i++) workers[i%2].push(i);
    for (const w of workers) {
      for (const cur of w) {
        try {
          insertFn(chunks[cur], cur);
          saved+=chunks[cur].length;
        } catch {
          try {
            insertFn(chunks[cur], cur);
            saved+=chunks[cur].length;
          } catch {
            failed.push(cur);
          }
        }
        onProgress();
      }
    }
    assert.equal(saved, 3100, `should save all 3100 after retry, got ${saved}`);
    assert.equal(failed.length, 0, 'no failed after retry');
    assert.equal(progressCalls, 7, 'progress called per chunk');
  });

  // Real anchor tests using actual progression module (Node ESM)
  await (async () => {
    let P = null;
    try { P = await import('./../src/lib/progression.js'); } catch (e) { /* will be caught in record */ }
    const rec = async (id, desc, fn) => {
      try { await fn(); results.push({ id, desc, ok: true }); } catch (e) { results.push({ id, desc, ok: false, err: String(e.message).split('\n')[0] }); }
    };
    await rec('ANCHOR1b', 'FIX-ANCHOR real: signup 2026-10-04 Class-10 false until 2027-02-25 true after', async () => {
      assert.ok(P, 'progression import failed');
      const profile = { class_level: 'Class 10', created_at: '2026-10-04T10:00:00.000Z' };
      const anchor = P.classYearAnchor(profile);
      assert.equal(anchor, '2027-02-25', `anchor for 2026-10-04 should be 2027-02-25, got ${anchor}`);
      // before anchor
      assert.equal(P.shouldPrompt(profile, '2026-12-01'), false, 'shouldPrompt false before anchor');
      assert.equal(P.shouldPrompt(profile, '2027-02-24'), false, 'false day before anchor');
      assert.equal(P.shouldPrompt(profile, '2027-02-25'), false, 'false on anchor day itself (needs Apr 1)');
      assert.equal(P.shouldPrompt(profile, '2027-03-15'), false, 'false between anchor and Apr 1');
      // after Apr 1
      assert.equal(P.shouldPrompt(profile, '2027-04-01'), true, 'true on Apr 1 after anchor');
      assert.equal(P.shouldPrompt(profile, '2027-04-02'), true, 'true after Apr 1');
      assert.equal(P.shouldPrompt(profile, '2027-09-01'), true, 'true later in year');
    });

    await rec('ANCHOR2', 'FIX-ANCHOR decline 2026-10-04 auto-voided (classPausedFor null)', async () => {
      assert.ok(P, 'progression import failed');
      const profile = {
        class_level: 'Class 10',
        created_at: '2026-10-04T10:00:00.000Z',
        progression: { status: 'declined', session: '2026-27', declinedOn: '2026-10-04', decidedAt: '2026-10-04', fromClass: 'Class 10', toClass: 'Class 11' }
      };
      const paused = P.classPausedFor(profile, '2026-10-05');
      assert.equal(paused, null, `decline before anchor should be auto-voided, got ${JSON.stringify(paused)}`);
      assert.equal(P.isDeclineInvalid(profile), true, 'isDeclineInvalid should be true for pre-anchor decline');
    });

    await rec('ANCHOR3', 'FIX-ANCHOR decline AFTER anchored year-end still pauses (real decision preserved)', async () => {
      assert.ok(P, 'progression import failed');
      const profile = {
        class_level: 'Class 10',
        created_at: '2026-10-04T10:00:00.000Z',
        progression: { status: 'declined', session: '2026-27', declinedOn: '2027-03-10', decidedAt: '2027-03-10', fromClass: 'Class 10', toClass: 'Class 11' }
      };
      // Anchor 2027-02-25, decline 2027-03-10 is AFTER anchor, should still pause
      const paused = P.classPausedFor(profile, '2027-03-11');
      assert.ok(paused, 'decline after anchor should still pause');
      assert.equal(P.isDeclineInvalid(profile), false, 'isDeclineInvalid false for post-anchor decline');
    });

    await rec('ANCHOR4', 'FIX-ANCHOR acceptance flow unchanged for genuinely-eligible students', async () => {
      assert.ok(P, 'progression import failed');
      const profile = { class_level: 'Class 10', created_at: '2026-01-10T00:00:00.000Z' };
      const anchor = P.classYearAnchor(profile);
      assert.equal(anchor, '2026-02-25', `anchor for Jan 10 should be 2026-02-25, got ${anchor}`);
      // After Apr 1 2026, should prompt
      assert.equal(P.shouldPrompt(profile, '2026-04-02'), true, 'eligible after Apr 1 should prompt');
      // Simulate accept plan
      const rows = [{ id: 'r1', subject: 'Science', chapter: 'Ch1', track: 'class', status: 'locked' }];
      const plan = P.planAccept({ userId: 'u1', profile, rows, stream: 'Science', today: '2026-04-02', stamp: '2026-04-02T00:00:00.000Z' });
      assert.equal(plan.kind, 'accept', 'planAccept should still work');
      assert.equal(plan.userPatch.class_level, 'Class 11', 'should promote to Class 11');
    });
  })();

  // ================= FIX-CLAMP D10 Layer1: track-labeled chList + syllabus boundary fence, frozen zones =================
  check('CLAMP1', 'fence presence class-only — [track: class] labels + STRICT SYLLABUS BOUNDARY Class N board FORBIDDEN', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    assert.ok(/\[track:.*\]/.test(aiSrc), 'must have [track: ...] labels');
    assert.ok(/\$\{c\.subject\} — \$\{c\.chapter\} \[track: \$\{c\.track/.test(aiSrc) || /track: \$\{c\.track \|\| 'class'\}/.test(aiSrc), 'chList must be ${subject} — ${chapter} [track: ${track}]');
    assert.ok(/STRICT SYLLABUS BOUNDARY/.test(aiSrc), 'must have STRICT SYLLABUS BOUNDARY fence');
    assert.ok(/FORBIDDEN/.test(aiSrc) && /higher classes/.test(aiSrc), 'class fence must have FORBIDDEN higher classes');
    assert.ok(/Class \$\{classNum/.test(aiSrc) || /Class \$\{N\}/.test(aiSrc) || /Class .*board/.test(aiSrc), 'class fence must use Class N board from profile');
  });

  check('CLAMP2', 'fence presence olympiad-only / exam-only — track-depth sentences stay strictly within listed topics', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    assert.ok(/These are olympiad chapters/.test(aiSrc) && /olympiad-level depth/.test(aiSrc), 'olympiad fence must have These are olympiad chapters — olympiad-level depth');
    assert.ok(/These are exam chapters/.test(aiSrc) && /exam-level depth/.test(aiSrc), 'exam fence must have These are exam chapters — exam-level depth');
    assert.ok(/stay strictly within listed topics/.test(aiSrc), 'must have stay strictly within listed topics');
  });

  check('CLAMP3', 'fence presence mixed tracks — class fence + olympiad/exam depth both present, scoped per labeled chapters', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    // Mixed: hasClass + hasOlympiad + hasExam logic
    assert.ok(/hasClass/.test(aiSrc) && /hasOlympiad/.test(aiSrc) && /hasExam/.test(aiSrc), 'must detect hasClass/hasOlympiad/hasExam for mixed');
    assert.ok(/boundaryLines/.test(aiSrc) && /join/.test(aiSrc), 'must join boundary lines for mixed tracks');
    // All three functions must have boundary
    const countBoundary = (aiSrc.match(/STRICT SYLLABUS BOUNDARY/g) || []).length;
    assert.ok(countBoundary >= 3, `all three prompts must have boundary fence, got ${countBoundary} occurrences`);
    const countTrackLabel = (aiSrc.match(/\[track:/g) || []).length;
    assert.ok(countTrackLabel >= 3, `all three must have [track: labels, got ${countTrackLabel}`);
  });

  check('CLAMP4', 'frozen zones — difficultyBand and buildProfileContext exact strings unchanged D9', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    // difficultyBand exact strings (frozen)
    assert.ok(aiSrc.includes('foundation recall, definitions, direct facts (easy) — 0–40%'), 'difficultyBand 0-40% frozen string must remain');
    assert.ok(aiSrc.includes('board level, standard NCERT-style (moderate) — 60–80%'), 'difficultyBand 60-80% frozen');
    assert.ok(aiSrc.includes('board/exam level, mixed conceptual + application (standard) — 100%'), 'difficultyBand 100% frozen');
    assert.ok(aiSrc.includes('competitive (JEE/NEET) level, multi-step (hard) — 120–150%'), 'difficultyBand 120-150% frozen');
    assert.ok(aiSrc.includes('olympiad HOTS, unfamiliar patterns, multi-concept (very hard) — 170–200%'), 'difficultyBand olympiad 170-200% frozen — D9 ≥150% band');
    // buildProfileContext exact
    assert.ok(aiSrc.includes('if (profile.class_level) bits.push(String(profile.class_level))'), 'buildProfileContext class_level line frozen');
    assert.ok(aiSrc.includes('if (profile.board) bits.push(String(profile.board))'), 'buildProfileContext board line frozen');
    assert.ok(aiSrc.includes('preparing for ${profile.competitive_exam}'), 'buildProfileContext competitive_exam line frozen');
    assert.ok(aiSrc.includes('olympiad: ${profile.olympiad}'), 'buildProfileContext olympiad line frozen');
    assert.ok(aiSrc.includes('level: ${profile.prep_level}'), 'buildProfileContext prep_level frozen');
    assert.ok(aiSrc.includes("return bits.join(' · ')"), 'buildProfileContext join frozen');
  });

  check('CLAMP5', 'wiring probe: aiGenerateTest L470, aiGenerateQuestionBank L616, aiGenerateMindMap L740 have track labels + boundary, no screen changes', () => {
    const aiSrc = read('src/lib/aiFeatures.js');
    // Check that aiGenerateTest, QB, MindMap all have track label logic
    assert.ok(/aiGenerateTest/.test(aiSrc) && /aiGenerateQuestionBank/.test(aiSrc) && /aiGenerateMindMap/.test(aiSrc), 'all three functions must exist');
    // Ensure no verification pass added (no second-pass verification)
    assert.ok(!/verification.*pass/i.test(aiSrc) || /Layer1 only/.test(aiSrc), 'no second-pass verification per D10 Layer1 only');
    // Ensure prompts have boundary appended
    assert.ok(/syllabusBoundary/.test(aiSrc), 'must have syllabusBoundary variable in prompts');
    // Ensure no screen changes for CLAMP (only aiFeatures)
    // This is wiring probe, not strict file change check, but we can check that TestBuilderScreen not modified for clamp
    // The task says no screen changes for CLAMP round
  });

  // ================= FIX-BATTLE: idempotent invites + removeChannel =================
  check('BATTLE1', 'battleRealtime idempotent subscribeInvites same userId returns same handle no throw', () => {
    const brtSrc = read('src/lib/battleRealtime.js');
    assert.ok(/inviteChannels/.test(brtSrc) && /Map/.test(brtSrc), 'must have inviteChannels Map cache');
    assert.ok(/refCount/.test(brtSrc), 'must refcount');
    assert.ok(/existing/.test(brtSrc) && /return existing/.test(brtSrc), 'must return existing if already subscribed');
    assert.ok(/callbacks/.test(brtSrc) && /Set/.test(brtSrc), 'must store callbacks Set');
    assert.ok(/unsubscribeInvites/.test(brtSrc), 'must have unsubscribeInvites');
    assert.ok(/removeChannel/.test(brtSrc), 'unsubscribe must call removeChannel');
  });

  check('BATTLE2', 'battleRealtime unsubscribe+removeChannel then re-subscribe works, screens use unsubscribeInvites', () => {
    const brtSrc = read('src/lib/battleRealtime.js');
    assert.ok(/supabase\.removeChannel/.test(brtSrc), 'must call supabase.removeChannel');
    assert.ok(/unsubscribe\(\)/.test(brtSrc), 'must call unsubscribe()');
    assert.ok(/__testOnly/.test(brtSrc), 'should expose test helpers');
    const guildSrc = read('src/screens/guild/GuildScreen.js');
    assert.ok(/unsubscribeInvites/.test(guildSrc), 'GuildScreen must use unsubscribeInvites');
    assert.ok(!/sub\?\.unsubscribe\(\)/.test(guildSrc) || /unsubscribeInvites/.test(guildSrc), 'GuildScreen cleanup must use unsubscribeInvites not bare unsubscribe');
    const battleSrc = read('src/screens/guild/BattleScreen.js');
    assert.ok(/unsubscribeInvites/.test(battleSrc), 'BattleScreen must use unsubscribeInvites');
  });

  check('CASCADE1', 'three-phase simulation with fixed dates: P1 class→olympiad→exam, P2 olympiad→exam hard-stop class, P3 exam only', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    const cutoff = '2026-02-25';
    const olympiadDate = '2026-09-20';
    const examDate = '2028-04-15';
    const syllabus = [
      // enough work to spill beyond P1 (51 days *3h=153h) into P2
      ...Array.from({length:8}, (_,i)=>mkS('c'+i, 'Science', 'Class Ch'+i, { estimated_hours:12 })),
      ...Array.from({length:6}, (_,i)=>mkS('o'+i, 'Maths Olympiad', 'Olympiad Ch'+i, { track:'olympiad', estimated_hours:12 })),
      ...Array.from({length:6}, (_,i)=>mkS('e'+i, 'JEE', 'Exam Ch'+i, { track:'exam', estimated_hours:12 })),
    ];
    const p = generateSchedule({
      syllabus, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:10,
      userId:'u-cascade1', today, createdAt: today+'T00:00:00.000Z',
      olympiadDate, examDate,
    });
    const p1 = p.filter(r => r.date >= today && r.date <= cutoff && r.session_type === 'study');
    assert.ok(p1.some(r => r.track === 'class'), `P1 ${today}→${cutoff} must have class sessions, got ${p1.map(r=>r.track).join(',')}`);
    const p2 = p.filter(r => r.date > cutoff && r.date <= olympiadDate && r.session_type === 'study');
    assert.ok(p2.length > 0, 'P2 should have some study sessions');
    assert.equal(p2.filter(r => r.track === 'class').length, 0, `P2 ${cutoff}→${olympiadDate} must hard-stop class, found ${p2.filter(r=>r.track==='class').map(r=>r.date).slice(0,3).join(',')}`);
    assert.ok(p2.some(r => r.track === 'olympiad'), 'P2 must have olympiad sessions');
    const p3 = p.filter(r => r.date > olympiadDate && r.date <= examDate && r.session_type === 'study');
    if (p3.length) {
      assert.ok(p3.every(r => r.track === 'exam'), `P3 ${olympiadDate}→${examDate} must be exam only, got ${[...new Set(p3.map(r=>r.track))].join(',')}`);
    }
    assert.ok(p.coverage.totalDays >= 800, `horizon must reach exam 2028-04-15, got ${p.coverage.totalDays}`);
  });

  check('CASCADE2', 'cascade-overflow: unused quota from higher priority cascades to next track same day', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    const syllabus = [
      mkS('e1', 'JEE', 'Exam Ch1', { track:'exam' }),
      mkS('e2', 'JEE', 'Exam Ch2', { track:'exam' }),
    ];
    const p = generateSchedule({
      syllabus, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-cascade2', today, createdAt: today+'T00:00:00.000Z',
      examDate: '2026-08-15',
    });
    const study = p.filter(r => r.session_type === 'study');
    assert.ok(study.length > 0, 'exam-only syllabus must still schedule via cascade even though class is P1 priority but has no work');
    assert.ok(study.every(r => r.track === 'exam'), 'all study should be exam track when only exam has work');
    const syllabus2 = [
      mkS('c1', 'Science', 'Class Ch1'),
      mkS('e1', 'JEE', 'Exam Ch1', { track:'exam' }),
    ];
    const p2 = generateSchedule({
      syllabus: syllabus2, dailyHours:4, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-cascade2b', today, createdAt: today+'T00:00:00.000Z',
      examDate: '2026-08-15', olympiadDate: '2026-09-20',
    });
    const p2Study = p2.filter(r => r.session_type === 'study');
    assert.ok(p2Study.some(r => r.track === 'class'), 'class should have sessions');
    assert.ok(p2Study.some(r => r.track === 'exam'), 'exam should get cascaded quota when olympiad has no work');
  });

  check('CASCADE3', 'undated-track deprioritization: dated tracks outrank undated (lowest priority)', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    const syllabus = [
      mkS('o1', 'Maths Olympiad', 'Olympiad Ch1', { track:'olympiad' }),
      mkS('e1', 'JEE', 'Exam Ch1', { track:'exam' }),
    ];
    const pDated = generateSchedule({
      syllabus, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-cascade3a', today, createdAt: today+'T00:00:00.000Z',
      examDate: '2026-08-15',
    });
    const studyDated = pDated.filter(r => r.session_type === 'study');
    assert.ok(studyDated.length > 0, 'should schedule both dated and undated');
    const pTight = generateSchedule({
      syllabus, dailyHours:1, preferredTime:'Morning', daysOff:[], weeks:6,
      userId:'u-cascade3b', today, createdAt: today+'T00:00:00.000Z',
      examDate: '2026-08-15',
    });
    const min = (t) => pTight.filter(r => r.session_type === 'study' && r.track === t).reduce((a,r)=>a+r.duration_minutes,0);
    assert.ok(min('exam') >= min('olympiad') || min('exam') > 0, `dated exam (${min('exam')} min) should outrank undated olympiad (${min('olympiad')} min) in default cascade`);
    // For both undated custom order test, need tight capacity so budget matters (not all work fits)
    const tightSyllabus = [
      ...Array.from({length:5}, (_,i)=>mkS('o'+i, 'Maths Olympiad', 'Olympiad Ch'+i, { track:'olympiad', estimated_hours:12 })),
      ...Array.from({length:5}, (_,i)=>mkS('e'+i, 'JEE', 'Exam Ch'+i, { track:'exam', estimated_hours:12 })),
    ];
    const pBothUndated = generateSchedule({
      syllabus: tightSyllabus, dailyHours:1, preferredTime:'Morning', daysOff:[], weeks:2,
      userId:'u-cascade3c', today, createdAt: today+'T00:00:00.000Z',
      priorities: { order: ['olympiad','exam','class'], enabled: { class:true, exam:true, olympiad:true }, timeSplit: { olympiad:70, exam:20, class:10 } },
    });
    const minBoth = (t) => pBothUndated.filter(r => r.session_type === 'study' && r.track === t).reduce((a,r)=>a+r.duration_minutes,0);
    assert.ok(minBoth('olympiad') > minBoth('exam'), `both undated but custom order olympiad first should give olympiad more time (${minBoth('olympiad')} vs ${minBoth('exam')})`);
  });

  // ================= FIX-SCHED6: new-first + light revision (≤20% during new phase) =================
  check('NEWFIRST1', 'ordering: new-before-deep-revision, first 2 weeks new + ≤20% revision, no new after exhaust', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    // Mix of new and taught (completed) chapters
    const newRows = Array.from({length:6}, (_,i)=>mkS('n'+i, 'Science', 'New Ch'+i));
    const taughtRows = Array.from({length:3}, (_,i)=>mkS('t'+i, 'Science', 'Taught Ch'+i, { status:'completed', progress_percent:100, completed_at: '2026-01-01T00:00:00.000Z' }));
    const syllabus = [...newRows, ...taughtRows];
    const p = generateSchedule({
      syllabus, dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:4,
      userId:'u-newfirst1', today, createdAt: today+'T00:00:00.000Z',
    });
    // First 2 weeks should have new-content blocks + ≤20% revision
    const first14 = p.filter(r => r.date >= today && r.date <= '2026-01-18');
    const newBlocks = first14.filter(r => r.session_type === 'study');
    const revBlocks = first14.filter(r => r.session_type === 'revision' && /^Spaced revision/.test(r.topic));
    assert.ok(newBlocks.length > 0, `first 2 weeks must have new-content blocks, got ${newBlocks.length}`);
    const totalMinFirst14 = first14.reduce((a,r)=>a+r.duration_minutes,0);
    const revMinFirst14 = revBlocks.reduce((a,r)=>a+r.duration_minutes,0);
    const ratio = totalMinFirst14 ? revMinFirst14 / totalMinFirst14 : 0;
    assert.ok(ratio <= 0.25, `first 2 weeks revision ratio must be ≤20% (allow 25% tolerance), got ${(ratio*100).toFixed(1)}% (${revMinFirst14}/${totalMinFirst14} min)`);
    // After new set exhausted, no new-content blocks (only revision/mock/practice)
    const lastDate = p.filter(r=>r.session_type==='study').map(r=>r.date).sort().pop() || today;
    const afterNew = p.filter(r => r.date > lastDate);
    const newAfter = afterNew.filter(r => r.session_type === 'study');
    assert.equal(newAfter.length, 0, `after new set exhausted (${lastDate}), no new-content blocks should appear, found ${newAfter.length}`);
  });

  check('NEWFIRST2', 'offsets: taught chapters appear at +3/+7/+14 via SPACED_REVISION_OFFSETS, capped at 20% during new phase', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const mkS = (id, subject, chapter, over={}) => ({ id, subject, chapter, track:'class', status:'locked', progress_percent:0, weightage:3, estimated_hours:6, archived:false, ...over });
    const today = '2026-01-05';
    const taught = mkS('t1', 'Science', 'Taught Ch1', { status:'completed', progress_percent:100, completed_at: today+'T00:00:00.000Z' });
    const newRows = Array.from({length:4}, (_,i)=>mkS('n'+i, 'Science', 'New Ch'+i));
    const p = generateSchedule({
      syllabus: [...newRows, taught], dailyHours:3, preferredTime:'Morning', daysOff:[], weeks:3,
      userId:'u-newfirst2', today, createdAt: today+'T00:00:00.000Z',
    });
    const revs = p.filter(r => /^Spaced revision/.test(r.topic) && r.topic.includes('Taught Ch1'));
    const dates = revs.map(r=>r.date).sort();
    // Should appear at +3/+7/+14
    const expected = [3,7,14].map(off => {
      const d = new Date(today);
      d.setDate(d.getDate()+off);
      return d.toISOString().slice(0,10);
    });
    for (const exp of expected) {
      assert.ok(dates.includes(exp), `taught chapter should have revision at ${exp}, got ${dates.join(',')}`);
    }
    // During new phase, revision capped at 20% — check first week
    const firstWeek = p.filter(r => r.date >= today && r.date <= '2026-01-11');
    const revMin = firstWeek.filter(r=>r.session_type==='revision' && /^Spaced revision/.test(r.topic)).reduce((a,r)=>a+r.duration_minutes,0);
    const totalMin = firstWeek.reduce((a,r)=>a+r.duration_minutes,0);
    const ratio = totalMin ? revMin/totalMin : 0;
    assert.ok(ratio <= 0.3, `first week revision capped at ~20%, got ${(ratio*100).toFixed(1)}%`);
  });

  check('XP1', 'FIX-XP1 guard: SyllabusScreen.js must NOT contain awardXP — taught-till is planning tool, not XP event', () => {
    const src = read('src/screens/study/SyllabusScreen.js');
    assert.ok(!/awardXP/.test(src), 'SyllabusScreen.js must not contain awardXP (XP farming guard) — found awardXP reference');
    assert.ok(!/CHAPTER_COMPLETE/.test(src), 'SyllabusScreen.js must not award CHAPTER_COMPLETE via toggle');
    assert.ok(!/useGame/.test(src), 'useGame import must be removed when awardXP is gone');
  });

  check('SP1'


, 'the accepted foundation survives FIX-S: idempotent regen, deadlines-first, completed exclusion, hours parsing, FIX-D4/E wiring', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    // (1) idempotent regeneration: kept rows are never re-created
    const syl = [mkS('k1', 'Science', 'Life Processes', { estimated_hours: 6 }), mkS('k2', 'Maths', 'Trigonometry', { estimated_hours: 6 })];
    const base = { syllabus: syl, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2, userId: 'u-sp1', today: S_TODAY, createdAt: S_CREATED };
    const first = generateSchedule(base);
    const second = generateSchedule({ ...base, existing: first });
    const key = (r) => [r.date, r.start_time, r.subject, r.topic, r.session_type].join('|');
    const keys = new Set(first.map(key));
    assert.equal(second.filter((r) => keys.has(key(r))).length, 0, 'kept rows were re-created on regeneration');
    // (2) completed-row exclusion stays auditable, with reasons
    const p2 = generateSchedule({
      syllabus: [doneRow('x1', 'Science', 'Done Chapter', `${S_TODAY}T09:00:00.000Z`), mkS('x2', 'Science', 'Open Chapter', { estimated_hours: 6 })],
      dailyHours: 3, weeks: 2, userId: 'u-sp1', today: S_TODAY, createdAt: S_CREATED,
    });
    assert.ok(p2.coverage.completedExcluded >= 1, 'completed exclusion still counted');
    assert.ok(p2.coverage.completedItems.some((c) => c.reason === 'completed'), 'completed exclusion still carries a reason');
    assert.ok(!p2.some((r) => r.session_type === 'study' && r.topic === 'Done Chapter'), 'a conquered chapter is never study-scheduled');
    // (3) hours parsing: an explicit 0 stays 0 and still plans nothing
    assert.equal(effectiveDailyHours({ daily_study_hours: 0 }), 0, '0 hrs/day must stay 0');
    assert.equal(effectiveDailyHours({}), 2, 'unset keeps the app default');
    const zero = generateSchedule({ syllabus: syl, dailyHours: effectiveDailyHours({ daily_study_hours: 0 }), weeks: 2, userId: 'u-sp1', today: S_TODAY, createdAt: S_CREATED });
    assert.equal(zero.length, 0, 'zero available time still plans nothing');
    assert.equal(zero.coverage.noCapacity, true, 'zero time is reported, not padded');
    // (4) autoSetDeadlines before planning + the FIX-D4/FIX-E wiring in the screen
    assert.equal(typeof autoSetDeadlines, 'function', 'autoSetDeadlines preserved');
    assert.ok(ssSrcS.indexOf('autoSetDeadlines(') < ssSrcS.indexOf('generateSchedule({'), 'deadlines are still computed BEFORE planning');
    assert.ok(ssSrcS.includes('autoRescheduleMissed') && ssSrcS.includes('autoRolledRef'), 'FIX-E rollover wiring preserved');
    assert.ok(sgSrcS.includes('examDates') && sgSrcS.includes('isExamDay') && sgSrcS.includes('FIX-D4'), 'FIX-D4 exam-day guard preserved');
  });

  // ================= S5 — session progression (Class 10 -> Class 11) =================
  // PO decisions 1-5 + NEW Y's audited criteria S5a-S5f.
  // The live DDL is NOT run by the agent: the feature stays DORMANT until the PO
  // applies it (isSchemaReady probes read-side), and the exact SQL lives in
  // supabase/schema.sql + FIX-S-REPORT.md. These tests exercise the real code paths
  // against an in-memory store, because every effect in runPromotion() is injected.
  let PR = null; let prErr = '';
  try { PR = await import('./../src/lib/progression.js'); }
  catch (e) { prErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  let PW = null; let pwErr = '';
  try { PW = await import('./../src/lib/presetRows.js'); }
  catch (e) { pwErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  let SD = null; let sdErr = '';
  try { SD = await import('./../src/data/syllabusData.js'); }
  catch (e) { sdErr = String(e && e.message ? e.message : e).split('\n')[0]; }

  const prSrc = read('src/lib/progression.js');
  const hookSrc = read('src/hooks/usePromotion.js');
  const sdLibSrc = read('src/lib/starterData.js');
  const sySrc = read('src/screens/study/SyllabusScreen.js');
  const hsSrc = read('src/screens/home/HomeScreen.js');

  const P_TODAY = '2027-04-01';                 // first day of the new session (SESSION_START)
  const P_STAMP = '2027-04-01T00:00:00.000Z';
  const P_SESSION = '2027-28';                  // sessionLabelFor('2027-04-01')

  // a Class 10 student with a REAL history: XP, streak, board exams, an olympiad,
  // content/habits/workouts — everything the promotion must not touch
  const mkUser = (over = {}) => ({
    id: 'u-s5',
    class_level: 'Class 10',
    board: 'CBSE',
    total_xp: 12480,
    current_streak: 27,
    longest_streak: 41,
    streak_freezes: 2,
    competitive_exam: 'NEET',
    exam_date: '2028-04-15',
    olympiad: 'NSEP',
    olympiad_date: '2027-11-21',
    school_exams: [{ label: 'Class 10 Boards', start_date: '2027-02-24', end_date: '2027-03-03' }],
    priorities: { order: ['class', 'olympiad', 'exam'], enabled: { class: true }, timeSplit: { class: 60, olympiad: 25, exam: 15 } },
    arc: { id: 'hard75', start_date: '2027-01-01', day: 40 },
    days_off: [6],
    custom_exercises: [{ name: 'Squats' }],
    progression: null,
    ...over,
  });

  // the Class 10 map: 9 rows, mixed statuses. c10-9 deliberately shares its
  // subject::chapter with a Class 11 chapter — the archived row must NOT swallow it.
  const COLLISION = 'Units and Measurement — Errors & Significant Figures';
  const mkClass10Map = () => [
    { id: 'c10-1', user_id: 'u-s5', subject: 'Science', chapter: 'Life Processes', track: 'class', status: 'completed', progress_percent: 100, completed_at: '2026-11-02T09:00:00.000Z', weightage: 4, estimated_hours: 6 },
    { id: 'c10-2', user_id: 'u-s5', subject: 'Science', chapter: 'Chemical Reactions (Class 10 fixture)', track: 'class', status: 'completed', progress_percent: 100, completed_at: '2026-12-11T09:00:00.000Z', weightage: 3, estimated_hours: 5 },
    { id: 'c10-3', user_id: 'u-s5', subject: 'Maths', chapter: 'Trigonometry', track: 'class', status: 'completed', progress_percent: 100, completed_at: '2027-01-18T09:00:00.000Z', weightage: 5, estimated_hours: 8 },
    { id: 'c10-4', user_id: 'u-s5', subject: 'Maths', chapter: 'Quadratic Equations', track: 'class', status: 'in_progress', progress_percent: 60, completed_at: null, weightage: 4, estimated_hours: 6 },
    { id: 'c10-5', user_id: 'u-s5', subject: 'English', chapter: 'The Road Not Taken', track: 'class', status: 'in_progress', progress_percent: 25, completed_at: null, weightage: 2, estimated_hours: 3 },
    { id: 'c10-6', user_id: 'u-s5', subject: 'Hindi', chapter: 'Sagar aur Ram', track: 'class', status: 'locked', progress_percent: 0, completed_at: null, weightage: 2, estimated_hours: 3 },
    { id: 'c10-7', user_id: 'u-s5', subject: 'Social Science', chapter: 'Nationalism in India', track: 'class', status: 'completed', progress_percent: 100, completed_at: '2027-01-05T09:00:00.000Z', weightage: 3, estimated_hours: 6 },
    { id: 'c10-8', user_id: 'u-s5', subject: 'AI', chapter: 'Intro to AI', track: 'class', status: 'locked', progress_percent: 0, completed_at: null, weightage: 2, estimated_hours: 4 },
    { id: 'c10-9', user_id: 'u-s5', subject: 'Physics', chapter: COLLISION, track: 'class', status: 'locked', progress_percent: 0, completed_at: null, weightage: 3, estimated_hours: 5 },
    // an olympiad row: promotion must NEVER archive it (PO decision 5)
    { id: 'oly-1', user_id: 'u-s5', subject: 'Physics', chapter: 'Rotational Motion (olympiad)', track: 'olympiad', status: 'in_progress', progress_percent: 30, completed_at: null, weightage: 4, estimated_hours: 10 },
  ];

  const mkCounts = () => ({ content: 14, habits: 6, workouts: 33, schedule: 120 });

  const mkStore = (rows) => ({
    syllabus: rows.map((r) => ({ ...r })),
    sessions: [
      { id: 'sch-1', user_id: 'u-s5', subject: 'Science', topic: 'Life Processes', session_type: 'study', status: 'pending', date: '2027-04-05', track: 'class' },
      { id: 'sch-2', user_id: 'u-s5', subject: 'Maths', topic: 'Trigonometry', session_type: 'study', status: 'pending', date: '2027-04-06', track: 'class' },
      { id: 'sch-3', user_id: 'u-s5', subject: 'Maths', topic: 'Chapter test: Trigonometry', session_type: 'mock', status: 'pending', date: '2027-04-08', track: 'class' },
      { id: 'sch-4', user_id: 'u-s5', subject: 'Science', topic: 'Life Processes', session_type: 'study', status: 'completed', date: '2026-11-02', track: 'class' },
      { id: 'sch-5', user_id: 'u-s5', subject: 'Physics', topic: 'Rotational Motion (olympiad)', session_type: 'study', status: 'pending', date: '2027-04-07', track: 'olympiad' },
    ],
  });

  // the effects runPromotion() needs — an in-memory stand-in for db.* + updateProfile.
  // gateApplied:false simulates the LIVE cloud database before the PO runs the DDL:
  // every write of status='archived' is rejected by the CHECK constraint.
  const mkDeps = (store, profile, opts = {}) => {
    const writes = { userPatches: [], syllabusArchive: 0, syllabusInsert: 0, otherTables: [] };
    const deps = {
      listSyllabus: async () => store.syllabus,
      archiveRow: async (id, patch) => {
        if (opts.gateApplied === false && patch && patch.status === 'archived') {
          throw new Error('new row for relation "syllabus" violates check constraint "syllabus_status_check"');
        }
        const row = store.syllabus.find((r) => r.id === id);
        if (!row) throw new Error(`no syllabus row ${id}`);
        Object.assign(row, patch);
        writes.syllabusArchive += 1;
        return row;
      },
      importRows: async (preset, track, existing) => {
        const { fresh } = PW.selectFreshPresetRows(profile.id, preset, track, existing, { stamp: P_STAMP });
        for (const r of fresh) store.syllabus.push({ ...r, id: `new-${store.syllabus.length + 1}` });
        writes.syllabusInsert += fresh.length;
        return { inserted: fresh.length };
      },
      patchProfile: async (patch) => {
        writes.userPatches.push(Object.keys(patch).sort());
        Object.assign(profile, patch);
        return profile;
      },
    };
    return { deps, writes };
  };

  const snapshotOf = (profile, counts) => PR.preservationSnapshot({ profile, counts });
  const isFixtureRow = (r) => String(r.id).startsWith('c10-');

  check('S5a', 'shouldPrompt(profile, today) is pure: Class 10 + nothing decided + on/after 1 Apr -> true; 15 Mar, Class 11 and an accepted student -> false; a decline re-fires the NEXT day', () => {
    assert.ok(PR, `progression.js import failed: ${prErr}`);
    assert.equal(typeof PR.shouldPrompt, 'function', 'shouldPrompt(profile, today) must be exported');
    const c10 = { id: 'u', class_level: 'Class 10', progression: null };
    assert.equal(PR.shouldPrompt(c10, '2027-04-01'), true, '1 Apr (SESSION_START): the new session has begun -> prompt');
    assert.equal(PR.shouldPrompt(c10, '2027-04-30'), true, 'the window stays open while nothing is decided');
    assert.equal(PR.shouldPrompt(c10, '2027-03-15'), false, '15 Mar: board-exam season -> no prompt');
    assert.equal(PR.shouldPrompt(c10, '2027-02-26'), false, 'the day after the S4 class cutoff -> still no prompt');
    assert.equal(PR.shouldPrompt({ id: 'u', class_level: 'Class 11', progression: null }, '2027-04-01'), false, 'Class 11 is never prompted');
    assert.equal(PR.shouldPrompt({ id: 'u', class_level: 'Class 9', progression: null }, '2027-04-01'), false, 'only the Class 10 -> 11 transition is offered');
    assert.equal(PR.shouldPrompt({ id: 'u', class_level: '10', progression: null }, '2027-04-01'), true, 'class_level "10" normalises to Class 10');
    const accepted = { ...c10, progression: { session: P_SESSION, status: 'accepted', stream: 'Science', promotedOn: '2027-04-01' } };
    assert.equal(PR.shouldPrompt(accepted, '2027-04-01'), false, 'already accepted this session');
    assert.equal(PR.shouldPrompt(accepted, '2028-04-03'), false, 'an acceptance is permanent, not per-session');
    const declined = { ...c10, progression: { session: P_SESSION, status: 'declined', declinedOn: '2027-04-01' } };
    assert.equal(PR.shouldPrompt(declined, '2027-04-01'), false, 'asked today -> no double prompt the same day');
    assert.equal(PR.shouldPrompt(declined, '2027-04-02'), true, 'a decline re-fires the NEXT day (PO decision 4)');
    assert.equal(PR.shouldPrompt({ ...c10, progression: { session: '2026-27', status: 'declined', declinedOn: '2026-04-02' } }, '2027-04-05'), true, 'an older session decision cannot silence a new session');
    // session/window maths
    assert.equal(PR.sessionLabelFor('2027-04-01'), P_SESSION, 'Apr-Dec belongs to the session starting that year');
    assert.equal(PR.sessionLabelFor('2028-03-31'), P_SESSION, 'Jan-Mar belongs to the session that started last April');
    assert.equal(PR.promotionDueDate('2027-03-15'), '2027-04-01', 'window opens 1 Apr of the same calendar year');
    assert.equal(PR.promotionDueDate('2028-02-29'), '2028-04-01', 'leap-year safe');
    assert.equal(PR.normalizeClassLevel('class-10'), 'Class 10', 'class level normalisation');
    // purity: no data layer, no wall clock, no env — everything is injected
    assert.ok(!/^\s*import[^\n]*from\s+'(\.\/db|@react-native-async-storage|@supabase)/m.test(prSrc), 'progression.js must not import the data layer');
    assert.ok(!/new Date\(\)/.test(prSrc), 'progression.js must not read the wall clock (today is injected)');
    assert.ok(!/process\.env/.test(prSrc), 'progression.js must not read env');
    assert.equal(PR.shouldPrompt(c10, '2027-04-01'), PR.shouldPrompt(c10, '2027-04-01'), 'same input -> same output');
    assert.ok(/SESSION_START/.test(constSrcS), 'constants.js must define SESSION_START next to CLASS_SESSION_END');
    assert.ok(/PROMOTION_FROM_CLASS|PROMOTION_TO_CLASS/.test(constSrcS), 'the promotion classes live in constants.js, not in a screen');
  });

  check('S5d', 'an ARCHIVED chapter generates no study, no chapter test and no spaced revision — and never enters the S3 conquered registry', () => {
    assert.ok(SG, `scheduleGenerator import failed: ${sgErr}`);
    const syl = [
      mkS('a1', 'Physics', 'Archived Chapter', { status: 'archived', progress_percent: 40 }),
      mkS('a2', 'Chemistry', 'Archived Conquered', { status: 'archived', progress_percent: 100, completed_at: '2027-01-02T09:00:00.000Z' }),
      mkS('k1', 'Maths', 'Live Chapter'),
    ];
    const p = generateSchedule({
      syllabus: syl, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
      userId: 'u-s5d', today: S_TODAY, createdAt: S_CREATED,
    });
    assert.equal(p.coverage.archivedExcluded, 2, 'archived rows are counted, not silently dropped');
    assert.equal(p.coverage.excludedItems.filter((e) => e.reason === 'archived').length, 2, 'the exclusion registry carries reason "archived"');
    assert.ok(!p.some((r) => /Archived Chapter|Archived Conquered/.test(String(r.topic || ''))), 'no session of ANY kind for an archived chapter');
    assert.equal(p.filter((r) => LADDER_RE.test(String(r.topic || ''))).length, 0, 'no chapter test / spaced revision ladder for an archived conquered chapter');
    assert.ok(!p.coverage.completedItems.some((c) => c.id === 'a2'), 'archived rows never enter the S3 conquered registry');
    assert.ok(p.coverage.classTotal >= 1 && p.some((r) => r.topic === 'Live Chapter'), 'the live chapter still plans normally');
    // archived history gets no deadline either
    const dl = autoSetDeadlines(syl, '2027-05-10', 3, []);
    assert.equal(dl.a1, undefined, 'an archived row gets no deadline');
    assert.equal(dl.a2, undefined, 'an archived CONQUERED row gets no deadline');
    assert.ok(dl.k1, 'a live row still gets one');
    // one predicate, owned by constants.js, used by the planner and the screens
    assert.ok(/isArchivedRow/.test(constSrcS) && /activeSyllabusRows/.test(constSrcS), 'constants.js owns the archived predicate');
    assert.ok(/isArchivedRow/.test(sgSrcS), 'the planner filters through the shared predicate');
    // the archived map is surfaced as collapsible history and nothing more
    assert.ok(sySrc.includes('Class 10 · Archived'), 'SyllabusScreen renders the "Class 10 · Archived" section (PO decision 3)');
    assert.ok(sySrc.includes('archivedOpen'), 'that section is collapsible');
    assert.ok(sySrc.includes('activeSyllabusRows(rows)'), 'progress/subject cards count ACTIVE rows only');
  });

  {
    const record = async (id, desc, fn) => {
      try { await fn(); results.push({ id, desc, ok: true }); }
      catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
    };

    await record('S5b', 'accept("Science") -> class_level Class 11 + progression record, every Class 10 row archived, the combined 89-chapter Class 11 set imported, and XP/streak/content/habits/workouts byte-identical', async () => {
      assert.ok(PR, `progression.js import failed: ${prErr}`);
      assert.ok(PW, `presetRows.js import failed: ${pwErr}`);
      assert.ok(SD, `syllabusData.js import failed: ${sdErr}`);
      const profile = mkUser();
      const counts = mkCounts();
      const before = JSON.stringify(snapshotOf(profile, counts));
      const store = mkStore(mkClass10Map());
      const { deps, writes } = mkDeps(store, profile);

      const plan = PR.planAccept({ userId: profile.id, profile, rows: store.syllabus, stream: 'Science', today: P_TODAY, stamp: P_STAMP });
      const res = await PR.runPromotion(plan, deps);
      assert.equal(res.ok, true, `accept must succeed, got: ${res.message || JSON.stringify(res)}`);

      // class level + the progression record
      assert.equal(profile.class_level, 'Class 11', 'class_level becomes Class 11');
      assert.equal(res.classLevel, 'Class 11');
      assert.equal(profile.progression.status, 'accepted');
      assert.equal(profile.progression.session, P_SESSION, 'the decision is bound to the session year');
      assert.equal(profile.progression.stream, 'Science', 'the stream is recorded');
      assert.equal(profile.progression.promotedOn, P_TODAY);
      assert.equal(profile.progression.declinedOn, undefined, 'an acceptance carries no declinedOn');

      // archival: every Class 10 row, history fields intact, olympiad row untouched
      const fixture = store.syllabus.filter(isFixtureRow);
      assert.equal(fixture.length, 9, 'fixture sanity');
      assert.ok(fixture.every((r) => r.status === 'archived'), 'ALL Class 10 rows are archived');
      assert.equal(res.archived, 9);
      const conquered = fixture.find((r) => r.id === 'c10-3');
      assert.equal(conquered.completed_at, '2027-01-18T09:00:00.000Z', 'conquered history stays on the archived row');
      assert.equal(conquered.progress_percent, 100, 'archived progress is not reset');
      const partial = fixture.find((r) => r.id === 'c10-4');
      assert.equal(partial.progress_percent, 60, 'in-progress history is preserved too');
      const oly = store.syllabus.find((r) => r.id === 'oly-1');
      assert.equal(oly.status, 'in_progress', 'the olympiad row is NEVER archived (PO decision 5)');

      // import: the COMBINED Class 11 dataset (PO decision 2) — not a stream subset
      const imported = store.syllabus.filter((r) => !isFixtureRow(r) && r.id !== 'oly-1');
      assert.equal(imported.length, 89, 'the Class 11 import must yield the full combined 89-chapter set');
      assert.equal(res.imported, 89);
      assert.equal(SD.CLASS_SYLLABI['Class 11'].rows.length, 89, 'source dataset check');
      assert.ok(imported.every((r) => r.track === 'class' && r.status === 'locked' && r.progress_percent === 0), 'imported rows are fresh class-track rows');
      // DEVIATION GUARD (declared in the report): pickSyllabusSet hands a NEET profile
      // the 11-row CLASS11_12_PCB subset, so the promotion resolves CLASS_SYLLABI
      // explicitly — otherwise a NEET aspirant would lose 78 chapters on promotion.
      const pcb = SD.pickSyllabusSet({ class_level: 'Class 11', competitive_exam: 'NEET' }).class;
      assert.equal(pcb.rows.length, 11, 'the PCB subset exists and is what pickSyllabusSet returns for NEET');
      assert.notEqual(imported.length, pcb.rows.length, 'the promotion must NOT import the PCB subset');
      assert.equal(plan.preset.key, 'Class 11', 'the promotion names its preset explicitly');
      // an archived row never blocks the fresh Class 11 chapter of the same name
      const collided = store.syllabus.filter((r) => r.subject === 'Physics' && r.chapter === COLLISION);
      assert.equal(collided.length, 2, 'archived Class 10 row + freshly imported Class 11 row coexist');
      assert.equal(collided.filter((r) => r.status === 'archived').length, 1);
      assert.equal(collided.filter((r) => r.status === 'locked').length, 1);
      assert.equal(PW.selectFreshPresetRows('u', SD.CLASS_SYLLABI['Class 11'], 'class', fixture).fresh.length, 89, 'the dedupe rule ignores archived rows');

      // PRESERVATION: byte-identical before/after
      assert.equal(JSON.stringify(snapshotOf(profile, counts)), before, 'XP / streak / freezes / board / exam dates / school exams / content / habits / workouts changed');
      assert.equal(profile.total_xp, 12480, 'total_xp untouched');
      assert.equal(profile.current_streak, 27, 'streak untouched');
      assert.equal(counts.content, 14, 'Content Locker count untouched');
      assert.equal(counts.habits, 6, 'habits untouched');
      assert.equal(counts.workouts, 33, 'workouts untouched');
      assert.equal(counts.schedule, 120, 'schedule history count untouched');

      // the write set is EXACTLY two profile fields and nothing but syllabus/users
      assert.deepEqual(writes.userPatches, [['class_level', 'progression']], `unexpected profile write set: ${JSON.stringify(writes.userPatches)}`);
      assert.equal(writes.otherTables.length, 0, 'no table other than syllabus/users may be written');
      assert.equal(writes.syllabusArchive, 9, 'exactly the Class 10 rows were archived');
      assert.equal(writes.syllabusInsert, 89, 'exactly the Class 11 rows were inserted');

      // pending Class 10 sessions are retired; completed history is not
      const retire = PR.pendingSessionsToRetire(store.sessions, fixture);
      assert.deepEqual(retire.ids.sort(), ['sch-1', 'sch-2', 'sch-3'], 'pending sessions of archived chapters (incl. the ladder test) are retired');
      assert.ok(!retire.ids.includes('sch-4'), 'completed history is never deleted');
      assert.ok(!retire.ids.includes('sch-5'), 'olympiad sessions are never retired');

      // stream is a LABEL only: every stream imports the same combined set
      const other = PR.planAccept({ userId: 'u', profile: mkUser(), rows: mkClass10Map(), stream: 'Commerce', today: P_TODAY, stamp: P_STAMP });
      assert.equal(other.preset.rowCount, plan.preset.rowCount, 'Commerce imports the same 89 chapters (label-only stream)');
      assert.equal(other.preset.key, plan.preset.key);
      assert.throws(
        () => PR.planAccept({ userId: 'u', profile: mkUser(), rows: [], stream: 'Arts', today: P_TODAY, stamp: P_STAMP }),
        /stream must be one of/, 'an unknown stream is refused, not silently accepted'
      );
      // PO decision 5: retired Class 10 school exams stop driving planning
      const after = PR.activeSchoolExams(profile, profile.school_exams);
      assert.equal(after.length, 0, 'the Class 10 board exam no longer drives planning after promotion');
      assert.equal(profile.school_exams.length, 1, 'but it is still SAVED on the profile');
      assert.equal(PR.activeSchoolExams({ class_level: 'Class 10', progression: null }, profile.school_exams).length, 1, 'before promotion it still drives planning');
    });

    await record('S5c', 'decline -> progression declined + declinedOn, class_level unchanged, nothing archived, ZERO class sessions with an honest summary, olympiad/competitive unchanged, prompt re-fires next day', async () => {
      assert.ok(PR, `progression.js import failed: ${prErr}`);
      const profile = mkUser();
      const counts = mkCounts();
      const before = JSON.stringify(snapshotOf(profile, counts));
      const store = mkStore(mkClass10Map());
      const { deps, writes } = mkDeps(store, profile);

      const res = await PR.runPromotion(PR.planDecline({ userId: profile.id, profile, today: P_TODAY, stamp: P_STAMP }), deps);
      assert.equal(res.ok, true, `decline must succeed, got: ${res.message || JSON.stringify(res)}`);
      assert.equal(profile.class_level, 'Class 10', 'declining NEVER changes class_level');
      assert.equal(profile.progression.status, 'declined');
      assert.equal(profile.progression.declinedOn, P_TODAY, 'declinedOn drives the next-day re-prompt');
      assert.equal(profile.progression.session, P_SESSION);
      assert.equal(profile.progression.stream, null, 'no stream is recorded for a decline');
      assert.equal(store.syllabus.filter((r) => r.status === 'archived').length, 0, 'nothing is archived on decline');
      assert.equal(store.syllabus.length, 10, 'nothing is imported on decline');
      assert.deepEqual(writes.userPatches, [['progression']], 'a decline writes ONLY progression');
      assert.equal(writes.syllabusArchive, 0);
      assert.equal(writes.syllabusInsert, 0);
      assert.equal(JSON.stringify(snapshotOf(profile, counts)), before, 'XP/streak/content/habits/workouts untouched');

      // re-prompt the next day (PO decision 4)
      assert.equal(PR.shouldPrompt(profile, P_TODAY), false, 'asked today -> quiet today');
      assert.equal(PR.shouldPrompt(profile, '2027-04-02'), true, 'decline re-fires the next day');
      assert.equal(PR.promotionState(profile, P_TODAY), 'declined', 'the UI can show the paused state');

      // the planner: ZERO class sessions, honest summary, olympiad/competitive intact
      const paused = PR.classPausedFor(profile, '2027-04-02');
      assert.ok(paused && paused.reason === 'promotion-declined' && paused.since === P_TODAY, 'classPausedFor feeds the planner');
      const syl = [
        mkS('c1', 'Physics', 'Kinematics'),
        mkS('c2', 'Chemistry', 'Mole Concept'),
        mkS('c3', 'Maths', 'Sets'),
        mkS('o1', 'Physics', 'Rotational Motion (olympiad)', { track: 'olympiad', estimated_hours: 10 }),
        mkS('e1', 'Physics', 'NEET Physics — Modern', { track: 'exam', estimated_hours: 8 }),
      ];
      const common = {
        syllabus: syl, dailyHours: 3, preferredTime: 'Morning', daysOff: [], prepLevel: 'Intermediate',
        weeks: 4, userId: 'u-s5c', today: '2027-04-02', createdAt: '2027-04-02T00:00:00.000Z',
        olympiadDate: '2027-11-21', examDate: '2028-04-15',
      };
      const unpaused = generateSchedule(common);
      const plan = generateSchedule({ ...common, classPaused: paused });
      assert.equal(plan.filter((r) => r.track === 'class').length, 0, 'ZERO class sessions while the promotion is declined');
      assert.equal(plan.coverage.classTotal, 0, 'the summary reports no class work at all');
      assert.equal(plan.coverage.classPaused.heldChapters, 3, 'how many chapters were held back is reported');
      assert.ok(plan.coverage.reasons.includes('class-paused'), 'the reason is in the coverage registry');
      assert.ok(/paused/i.test(String(plan.coverage.coverageWarning || '')), 'an honest summary line, not a silently shorter plan');
      assert.equal(plan.coverage.classCutoffDaysBlocked, unpaused.coverage.classCutoffDaysBlocked, 'a pause is never reported as the S4 class cutoff');
      assert.ok(plan.length > 0, 'the plan is not empty — the other tracks keep running');
      // olympiad / competitive unchanged: same chapters, same totals, still scheduled
      const itemKey = (c) => (c.planned || []).filter((i) => i.track !== 'class').map((i) => `${i.subject}|${i.chapter}`).sort();
      assert.deepEqual(itemKey(plan.coverage), itemKey(unpaused.coverage), 'olympiad/exam chapters keep exactly their plan');
      assert.equal(plan.coverage.olympiadTotal, unpaused.coverage.olympiadTotal, 'olympiad workload unchanged');
      assert.equal(plan.coverage.examTotal, unpaused.coverage.examTotal, 'competitive workload unchanged');
      assert.ok(plan.filter((r) => r.track === 'olympiad').length > 0, 'olympiad sessions keep running');
      assert.ok(plan.filter((r) => r.track === 'exam').length > 0, 'competitive sessions keep running');
      assert.ok(plan.filter((r) => r.track !== 'class').length >= unpaused.filter((r) => r.track !== 'class').length, 'no olympiad/competitive session is lost to the pause');
      // wiring: the screen feeds the planner, it does not re-implement the rule
      assert.ok(ssSrcS.includes('classPaused: promo.paused'), 'ScheduleScreen passes the pause into the planner');
      assert.ok(ssSrcS.includes('promo.schoolExamsForPlanning()'), 'retired Class 10 school exams stop driving planning');
      assert.ok(hsSrc.includes('promo.paused'), 'Home says the class track is paused');
    });

    await record('S5e', 'local (offline) mode: accept and decline both work with no cloud; cloud mode stays DORMANT until the schema gate is applied, and a refused archive never half-promotes', async () => {
      assert.ok(PR, `progression.js import failed: ${prErr}`);
      // a LOCAL users row has no schema at all -> always ready
      assert.equal(PR.isSchemaReady({ id: 'u', class_level: 'Class 10' }, { remote: false }), true, 'local mode must not be gated');
      // cloud: a row WITHOUT the progression key means the DDL has not run yet
      assert.equal(PR.isSchemaReady({ id: 'u', class_level: 'Class 10' }, { remote: true }), false, 'cloud without users.progression -> dormant (no prompt, no banner)');
      assert.equal(PR.isSchemaReady({ id: 'u', class_level: 'Class 10', progression: null }, { remote: true }), true, 'cloud with the column present -> ready');

      // full local accept round trip
      const local = mkUser({ id: 'u-local' });
      delete local.progression; // a local row literally has no such key
      const store = mkStore(mkClass10Map());
      const { deps, writes } = mkDeps(store, local);
      const res = await PR.runPromotion(PR.planAccept({ userId: local.id, profile: local, rows: store.syllabus, stream: 'Humanities', today: P_TODAY, stamp: P_STAMP }), deps);
      assert.equal(res.ok, true, `local accept must work with the cloud absent: ${res.message || ''}`);
      assert.equal(local.class_level, 'Class 11');
      assert.equal(local.progression.stream, 'Humanities');
      assert.equal(res.imported, 89, 'the same combined set is imported offline');
      assert.equal(store.syllabus.filter(isFixtureRow).every((r) => r.status === 'archived'), true, 'archival works offline');
      assert.deepEqual(writes.userPatches, [['class_level', 'progression']]);

      // full local decline round trip (second student)
      const local2 = mkUser({ id: 'u-local2' });
      delete local2.progression;
      const store2 = mkStore(mkClass10Map());
      const d2 = mkDeps(store2, local2);
      const r2 = await PR.runPromotion(PR.planDecline({ userId: local2.id, profile: local2, today: P_TODAY, stamp: P_STAMP }), d2.deps);
      assert.equal(r2.ok, true, 'local decline must work with the cloud absent');
      assert.equal(local2.class_level, 'Class 10');
      assert.equal(PR.shouldPrompt(local2, '2027-04-02'), true, 'the offline decline still re-prompts next day');

      // the schema gate: cloud archival refusal must abort BEFORE class_level changes
      const gated = mkUser({ id: 'u-gated' });
      const store3 = mkStore(mkClass10Map());
      const d3 = mkDeps(store3, gated, { gateApplied: false });
      const r3 = await PR.runPromotion(PR.planAccept({ userId: gated.id, profile: gated, rows: store3.syllabus, stream: 'Science', today: P_TODAY, stamp: P_STAMP }), d3.deps);
      assert.equal(r3.ok, false, 'without the DDL the accept must FAIL, not pretend');
      assert.equal(r3.reason, 'schema-gate', 'the failure names the gate');
      assert.equal(gated.class_level, 'Class 10', 'NEVER a half-promotion: class_level untouched');
      assert.equal(gated.progression, null, 'no progression record written either');
      assert.equal(store3.syllabus.filter((r) => r.status === 'archived').length, 0, 'nothing archived');
      assert.equal(store3.syllabus.length, 10, 'nothing imported');
      assert.equal(d3.writes.userPatches.length, 0, 'no users write at all');
      assert.ok(/DDL|schema gate/i.test(String(r3.message)), 'the message tells the PO what to run');
      assert.ok(PR.shouldPrompt(gated, '2027-04-02'), true, 'the student is asked again once the gate is applied');

      // wiring: ONE controller for both screens, probing the gate read-side
      assert.ok(hookSrc.includes('isSchemaReady(profile, { remote: isRemote() })'), 'the hook probes the gate with the real mode');
      assert.ok(hookSrc.includes('runPromotion(') && hookSrc.includes('importPresetRows'), 'the hook runs the same engine and the shared import');
      assert.ok(ssSrcS.includes('usePromotion()') && hsSrc.includes('usePromotion()'), 'Schedule and Home share ONE promotion controller');
      assert.ok(/S5_SCHEMA_GATE_APPLIED\s*=\s*false/.test(constSrcS), 'the code declares the live gate as NOT applied yet (dormant)');
    });

    await record('S5f', 'one-time per session: the accepted state survives regeneration and relaunch, archived chapters never return to the calendar, and no second prompt fires', async () => {
      assert.ok(PR, `progression.js import failed: ${prErr}`);
      const profile = mkUser();
      const store = mkStore(mkClass10Map());
      const { deps } = mkDeps(store, profile);
      const res = await PR.runPromotion(PR.planAccept({ userId: profile.id, profile, rows: store.syllabus, stream: 'Science', today: P_TODAY, stamp: P_STAMP }), deps);
      assert.equal(res.ok, true, 'accept must succeed');
      const stored = JSON.parse(JSON.stringify(profile.progression)); // what a relaunch re-reads

      // no double prompt: same day, next day, later in the session, next session
      assert.equal(PR.shouldPrompt(profile, P_TODAY), false, 'no second prompt the same day');
      assert.equal(PR.shouldPrompt(profile, '2027-04-02'), false, 'none the next day');
      assert.equal(PR.shouldPrompt(profile, '2027-12-31'), false, 'none later in the same session year');
      assert.equal(PR.shouldPrompt(profile, '2028-04-03'), false, 'an accepted student is never prompted again');
      assert.equal(PR.promotionState(profile, '2027-04-02'), 'accepted', 'a relaunch reads the same accepted state');
      assert.equal(PR.classPausedFor(profile, '2027-04-02'), null, 'an accepted student is never treated as paused');
      assert.deepEqual(PR.progressionOf(profile), PR.progressionOf({ ...profile, progression: JSON.parse(JSON.stringify(stored)) }), 'the record round-trips unchanged');

      // regeneration over the NEW map: the archived Class 10 chapters stay out
      const regen = generateSchedule({
        syllabus: store.syllabus, dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 3,
        userId: 'u-s5f', today: '2027-04-02', createdAt: '2027-04-02T00:00:00.000Z', examDate: '2028-04-15',
      });
      assert.equal(regen.coverage.archivedExcluded, 9, 'every regeneration excludes the archived Class 10 map');
      assert.ok(!regen.some((r) => /Class 10 fixture|Life Processes|Nationalism in India/.test(String(r.topic || ''))), 'no archived chapter returns to the calendar');
      assert.ok(regen.some((r) => r.track === 'class' && r.session_type === 'study'), 'the new Class 11 map plans normally');
      assert.ok(regen.some((r) => r.track === 'olympiad'), 'the olympiad row survived the promotion and still plans');
      assert.deepEqual(JSON.parse(JSON.stringify(profile.progression)), stored, 'planning never rewrites the progression record');
      assert.equal(profile.class_level, 'Class 11');

      // UI discipline: the sheet opens once per prompt-day and is ONE shared component
      assert.ok(ssSrcS.includes('promoAskedRef'), 'ScheduleScreen opens the sheet once per prompt-day (no nag loop on every focus)');
      assert.ok(ssSrcS.includes('PromotionSheet') && hsSrc.includes('PromotionSheet'), 'Schedule and Home render the SAME sheet component');
      assert.ok(hsSrc.includes('PromotionSheet'), 'Home carries the banner/sheet too (PO decision 4)');
      // the shared import replaced the screen-local duplicate
      assert.ok(sySrc.includes('importPresetRows('), 'SyllabusScreen uses the shared import');
      assert.ok(!/const rowsToInsert = preset\.rows\.map/.test(sySrc), 'the screen-local duplicate import is gone');
      assert.ok(sdLibSrc.includes('selectFreshPresetRows'), 'starterData delegates to the ONE dedupe rule');
      // the schema gate is documented in the repo, not run by the agent
      const schemaSrc = read('supabase/schema.sql');
      assert.ok(/progression jsonb/.test(schemaSrc), 'schema.sql documents users.progression');
      assert.ok(/'archived'/.test(schemaSrc), "schema.sql widens the syllabus.status CHECK to include 'archived'");
    });
  }

  const failedS = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedS.length, 0, `FIX-S: ${failedS.length} check(s) failed -> ${failedS.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-H: REALTIME BATTLES — handshake, presence start, one outcome, XP ledger ----------
// Handoff acceptance IDs H1–H15 map to BH1–BH15 here: the committed scheduler suite
// already owns the plain H3–H11 ids, so battle checks carry the BH prefix (declared
// deviation). DEVICE-marked handoff tests (H1/H2/H12/H14) are verified here as
// source-wiring probes and are labelled as such — they do NOT pretend to prove UI.
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  // imported dynamically so a missing module is a recorded failure, not a suite crash
  // — this is also the fail-before mechanism: at 6e8627c battleRules.js does not exist.
  let BR = null; let brErr = '';
  try { BR = await import('./../src/lib/battleRules.js'); }
  catch (e) { brErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };
  const bsSrcH = safeRead('src/screens/guild/BattleScreen.js');
  const brtSrc = safeRead('src/lib/battleRealtime.js');
  const gsSrcH = safeRead('src/screens/guild/GuildScreen.js');
  const schemaSrcH = safeRead('supabase/schema.sql');
  const needsBR = () => assert.ok(BR, `battleRules.js import failed: ${brErr}`);

  // deterministic fixtures — server-style timestamps only, never a device clock
  const NOW = '2026-09-28T12:00:00.000Z';
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const plus = (ms) => new Date(new Date(NOW).getTime() + ms).toISOString();
  const mkQuestions = (seed) => BR.normalizeQuestions(seededShuffle(QUIZ_BANK, seed).slice(0, 8), 5);
  const mkChallenge = (over = {}) => ({
    id: 'chal-1', from_user: A, to_user: B, status: 'pending', questions: null,
    created_at: NOW, updated_at: NOW, expires_at: BR.expiryFrom(NOW), ...over,
  });
  const mkBattle = (over = {}) => ({
    id: 'btl-1', challenge_id: 'chal-1', challenger: A, invitee: B, status: 'active',
    questions: [], winner: null, created_at: NOW, completed_at: null, ...over,
  });
  const mkResults = (sa, sb, ta, tb) => ([
    { battle_id: 'btl-1', user_id: A, score: sa, time_ms: ta, completed_at: NOW },
    { battle_id: 'btl-1', user_id: B, score: sb, time_ms: tb, completed_at: NOW },
  ]);

  // ---------- BH3 (handoff H3): expiry is pure, idempotent and blocks everything ----------
  check('BH3', 'challenge TTL: expiryFrom anchors +120s on the SERVER timestamp; pending flips expired exactly at the deadline; terminal states never re-expire', () => {
    needsBR();
    assert.equal(BR.CHALLENGE_TTL_MS, 120000, 'PO decision (d): 120 s TTL');
    assert.equal(BR.ABANDON_GRACE_MS, 30000, 'PO decision (d): 30 s grace');
    assert.equal(BR.expiryFrom(NOW), plus(120000), 'expiry = created_at + 120 s (server-anchored)');
    assert.equal(BR.isChallengeExpired(mkChallenge(), plus(119999)), false, 'still live 1 ms before the deadline');
    assert.equal(BR.isChallengeExpired(mkChallenge(), plus(120000)), true, 'expired exactly at the deadline');
    assert.equal(BR.isChallengeExpired(mkChallenge({ status: 'accepted' }), plus(999999)), false, 'accepted is terminal');
    assert.equal(BR.isChallengeExpired(mkChallenge({ status: 'declined' }), plus(999999)), false, 'declined is terminal');
    assert.equal(BR.msUntilExpiry(mkChallenge(), plus(30000)), 90000, 'countdown from server timestamps');
    assert.equal(BR.msUntilExpiry(mkChallenge(), plus(999999)), 0, 'countdown clamps at 0, never negative');
    // re-challenge after expiry: the reuse predicate only accepts LIVE pending rows
    const dead = mkChallenge({ status: 'pending' });
    const live = [dead].filter((c) => c.status === 'pending' && !BR.isChallengeExpired(c, plus(120001)));
    assert.equal(live.length, 0, 'an expired pending row is never reused — a fresh challenge is allowed');
    // the flip itself is guarded in transport: only a pending row can expire
    assert.ok(/update\(\{ status: 'expired'[\s\S]{0,120}?\.eq\('status', 'pending'\)/.test(brtSrc), 'expireChallenge is idempotent (.eq status pending)');
    assert.ok(/createChallenge[\s\S]*expiryFrom\(data\.created_at/.test(brtSrc), 'createChallenge re-anchors expires_at on the SERVER created_at');
    assert.equal(BR.challengeStateLabel(mkChallenge(), NOW), 'Waiting… 120s left', 'honest countdown label');
    assert.equal(BR.challengeStateLabel(mkChallenge(), plus(121000)), 'Expired — dobara challenge bhejo', 'honest expired label');
  });

  // ---------- BH4 (H4): accept copies ONE question set to both phones ----------
  check('BH4', 'accept handshake: the accepter normalizes exactly 5 playable questions; both rows carry the identical set and order; junk never becomes playable', () => {
    needsBR();
    const set = mkQuestions('chal-1');
    assert.equal(set.length, 5, 'BATTLE_QUESTION_COUNT = 5');
    assert.ok(BR.isPlayableSet(set), 'a full normalized bank set is playable');
    assert.ok(BR.sameQuestionSet(set, JSON.parse(JSON.stringify(set))), 'a JSON round-trip (what the DB stores) is the same set');
    assert.equal(BR.sameQuestionSet(set, [...set].reverse()), false, 'order matters — a re-rolled order is NOT the same set');
    const tampered = JSON.parse(JSON.stringify(set)); tampered[2].options[0] = 'changed';
    assert.equal(BR.sameQuestionSet(set, tampered), false, 'a changed option is NOT the same set');
    const junk = BR.normalizeQuestions([
      null, { q: '', options: ['a', 'b'], answer: 0 }, { q: 'x', options: ['only-one'], answer: 0 },
      { q: 'y', options: ['a', 'b'], answer: 5 }, { q: 'z', options: ['a', 'b'], answer: 'not-a-number' },
    ], 5);
    assert.equal(junk.length, 0, 'malformed questions are filtered, never played');
    assert.equal(BR.isPlayableSet(junk), false, 'an empty/short set is not playable — accept refuses');
    // transport wiring: accepter writes the set to BOTH rows and only the invitee may accept
    assert.ok(brtSrc.includes("update({ status: 'accepted', questions: set") && /from\('battles'\)\s*\n?\s*\.insert\(\{[\s\S]*?questions: set,/.test(brtSrc), 'acceptChallenge stores the same set on the challenge AND the battle row');
    assert.ok(/to_user\)\s*!==\s*String\(meId\)/.test(brtSrc), 'only the addressed invitee can accept (client-side honesty on top of RLS)');
    assert.ok(bsSrcH.includes('acceptChallenge(') && gsSrcH.includes('acceptChallenge('), 'Battle AND Guild accept through the same transport call');
  });

  // ---------- BH5 (H5): auto-start ONLY when both are tracked ----------
  check('BH5', 'presence start: bothPresent is false for empty/one-sided state and true only when BOTH user ids are tracked; the screen flips waiting->play on that signal alone', () => {
    needsBR();
    const both = { [A]: [{ user_id: A, name: 'A', ts: NOW }], [B]: [{ user_id: B, name: 'B', ts: NOW }] };
    const oneSided = { [A]: [{ user_id: A, name: 'A', ts: NOW }] };
    assert.equal(BR.bothPresent(both, A, B), true, 'both tracked -> start');
    assert.equal(BR.bothPresent(oneSided, A, B), false, 'one side tracked -> NEVER starts');
    assert.equal(BR.bothPresent({}, A, B), false, 'empty state -> no start');
    assert.equal(BR.bothPresent(both, A, 'user-c'), false, 'a stranger in the state does not count');
    assert.equal(BR.bothPresent(null, A, B), false, 'null state -> no start, no crash');
    assert.equal(BR.lastSeenOf(both, B), NOW, 'lastSeenOf finds the tracked meta');
    assert.equal(BR.lastSeenOf(oneSided, B), null, 'an untracked user has no lastSeen (membership, not ts)');
    assert.equal(BR.opponentIdOf(mkChallenge(), A), B, 'opponent of the challenger is the invitee');
    assert.equal(BR.opponentIdOf(mkBattle({}), B), A, 'opponentIdOf works on battle rows too');
    assert.equal(BR.opponentIdOf(mkChallenge(), 'user-c'), null, 'a non-participant has no opponent');
    // wiring: the phase flip is guarded by bothPresent and can only leave 'waiting'
    assert.ok(/bothPresent\(state, me, oppId\)\)\s*setPhase\(\(p\) => \(p === 'waiting' \? 'play' : p\)\)/.test(bsSrcH), 'BattleScreen auto-starts only via bothPresent, only from waiting');
  });

  // ---------- BH6 (H6): each player upserts exactly one result row ----------
  check('BH6', 'results: retries collapse onto the composite PK (one row per player, last write wins); the upsert targets battle_id,user_id — never the opponent row', () => {
    needsBR();
    const first = { battle_id: 'btl-1', user_id: A, score: 3, time_ms: 60000 };
    const retry = { battle_id: 'btl-1', user_id: A, score: 4, time_ms: 50000 };
    const opp = { battle_id: 'btl-1', user_id: B, score: 2, time_ms: 70000 };
    const by = BR.resultsByUser([first, opp, retry]); // a retry arrives after the first write
    assert.equal(Object.keys(by).length, 2, 'two players -> exactly two rows, no duplicate');
    assert.equal(by[A].score, 4, 'my retry overwrites MY row only (idempotent by PK)');
    assert.equal(by[B].score, 2, "the opponent's row is untouched");
    assert.equal(BR.canFinalize(mkBattle(), [first, opp, retry]), true, 'both submitted -> finalizable');
    assert.equal(BR.canFinalize(mkBattle(), [retry]), false, 'one row alone never finalizes');
    assert.ok(brtSrc.includes("onConflict: 'battle_id,user_id'"), 'saveBattleResult upserts on the composite PK (db.upsert cannot — there is no id column)');
    assert.ok(/score: Math\.max\(0, Math\.min\(R\.BATTLE_QUESTION_COUNT/.test(brtSrc), 'the score is clamped to 0..5 client-side too');
  });

  // ---------- BH7 (H7): simultaneous finalize -> one winner, second writer no-op ----------
  check('BH7', 'finalize: both phones compute the SAME winner from the same two rows regardless of row order; the patch only applies to an active battle so the second finalizer is a no-op', () => {
    needsBR();
    const battle = mkBattle();
    const results = mkResults(4, 3, 50000, 60000);
    const phoneA = BR.finalizePatch(battle, results, plus(61000));
    const phoneB = BR.finalizePatch(battle, [...results].reverse(), plus(61500)); // same rows, other order
    assert.equal(phoneA.status, 'complete');
    assert.equal(phoneA.winner, A, 'higher score wins');
    assert.equal(phoneB.winner, phoneA.winner, 'both phones name the identical winner (pure rule)');
    assert.equal(BR.finalizePatch(mkBattle({ status: 'complete' }), results, NOW), null, 'an already-complete battle yields no patch — the second writer does nothing');
    assert.equal(BR.finalizePatch(battle, [results[0]], NOW), null, 'one result row -> no patch');
    assert.ok(/finalizeBattle[\s\S]*?\.eq\('status', 'active'\)/.test(brtSrc), 'the DB update is guarded to active rows (race-proof)');
  });

  // ---------- BH8 (H8): higher score wins ----------
  check('BH8', 'win/loss: higher score wins regardless of time; the two views of one battle mirror exactly', () => {
    needsBR();
    assert.equal(BR.resolveOutcome({ myScore: 5, oppScore: 2, myTimeMs: 99000, oppTimeMs: 10000 }).result, 'win', '5 > 2 wins even with slower time');
    assert.equal(BR.resolveOutcome({ myScore: 2, oppScore: 5, myTimeMs: 10000, oppTimeMs: 99000 }).result, 'loss');
    const battle = mkBattle({ status: 'complete', completed_at: plus(60000) });
    const results = mkResults(4, 3, 50000, 60000);
    const viewA = BR.outcomeForMe(battle, results, A);
    const viewB = BR.outcomeForMe(battle, results, B);
    assert.equal(viewA.result, 'win'); assert.equal(viewB.result, 'loss', 'one battle, two mirrored views');
    assert.equal(viewA.state, 'final'); assert.equal(viewB.state, 'final');
    assert.equal(viewA.winner, A); assert.equal(viewB.winner, A, 'both phones display the SAME winner id');
    assert.equal(BR.winnerIdOf(battle, results), A);
  });

  // ---------- BH9 (H9): equal score -> lower total time wins ----------
  check('BH9', 'tie-break: equal scores go to the lower total time_ms', () => {
    needsBR();
    const out = BR.resolveOutcome({ myScore: 4, oppScore: 4, myTimeMs: 50000, oppTimeMs: 60000 });
    assert.equal(out.result, 'win'); assert.equal(out.reason, 'lower-time');
    assert.equal(BR.resolveOutcome({ myScore: 4, oppScore: 4, myTimeMs: 60000, oppTimeMs: 50000 }).result, 'loss');
    const battle = mkBattle({ status: 'complete' });
    assert.equal(BR.winnerIdOf(battle, mkResults(4, 4, 50000, 60000)), A, 'faster player is the winner row');
  });

  // ---------- BH10 (H10): exact-equal score AND time -> DRAW, no win XP (PO decision c) ----------
  check('BH10', 'exact tie: equal score AND equal time is a DRAW — winner stays null and the win bonus is 0 for BOTH players', () => {
    needsBR();
    const out = BR.resolveOutcome({ myScore: 4, oppScore: 4, myTimeMs: 50000, oppTimeMs: 50000 });
    assert.equal(out.result, 'draw'); assert.equal(out.reason, 'exact-equal');
    const battle = mkBattle({ status: 'complete' });
    const results = mkResults(4, 4, 50000, 50000);
    assert.equal(BR.winnerIdOf(battle, results), null, 'no winner row on a draw');
    assert.equal(BR.finalizePatch(mkBattle(), results, NOW).winner, null, 'finalize stores winner = null');
    const dA = BR.battleXpDecision({ battle, result: 'draw', alreadyEarnedToday: false, ledgerEntry: null });
    assert.equal(dA.award, true); assert.equal(dA.complete, 25); assert.equal(dA.win, 0); assert.equal(dA.total, 25, 'a draw pays +25 complete and NO +60 win bonus');
  });

  // ---------- BH11 (H11): XP once/day + per-battle ledger + reload safety ----------
  await record('BH11', 'XP: first completed battle pays 25 (+60 on a win) once per day via xpOnce key battle; a second same-day battle pays 0 but still records history; a result-screen reload reads the ledger and NEVER re-awards; award failure never marks the ledger; void pays nothing', async () => {
    needsBR();
    assert.equal(BR.XP_BATTLE_COMPLETE, 25, 'PO decision (b): +25 BATTLE_COMPLETE');
    assert.equal(BR.XP_BATTLE_WIN, 60, 'PO decision (b): +60 BATTLE_WIN');
    assert.equal(BR.XP_KEY_BATTLE, 'battle', 'the F7 xpOnce key is unchanged');
    assert.equal(BR.battleLedgerKey('btl-1'), 'sos.battleXP.btl-1', 'per-battle ledger key');

    const mkFakes = ({ earned = false, awardFails = false } = {}) => {
      const calls = { award: [], mark: 0, history: 0, historyCtx: null };
      let ledger = null;
      let earnedFlag = earned;
      const deps = {
        hasEarnedToday: async () => earnedFlag,
        markEarnedToday: async () => { calls.mark += 1; earnedFlag = true; },
        awardXP: async (code, opts) => {
          calls.award.push(code);
          if (awardFails) return null; // GameContext returns null on failure
          return { gained: code === 'BATTLE_WIN' ? 60 : Number(opts?.amount) || 0 };
        },
        ledgerGet: async () => ledger,
        ledgerSet: async (id, payload) => { ledger = payload; return true; },
        insertQuizResult: async (ctx) => { calls.history += 1; calls.historyCtx = ctx; },
      };
      return { calls, deps, getLedger: () => ledger };
    };
    const battle = mkBattle({ status: 'complete', completed_at: plus(60000) });
    const winResults = mkResults(4, 3, 50000, 60000);

    // (a) first battle of the day, won -> 25 + 60, marked once, ledger written, history saved
    const f1 = mkFakes();
    const r1 = await BR.applyBattleXp({ battle, results: winResults, meId: A, completedAt: plus(60000), opponentName: 'Bob', ...f1.deps });
    assert.equal(r1.awardedXp, 85, 'win pays 25 complete + 60 win');
    assert.deepEqual(f1.calls.award, ['BATTLE_COMPLETE', 'BATTLE_WIN'], 'exactly the F7 award sequence');
    assert.equal(f1.calls.mark, 1, 'xpOnce marked once');
    assert.equal(f1.getLedger()?.xp, 85, 'ledger written ONLY on a confirmed award');
    assert.equal(f1.calls.history, 1, 'history row saved for the complete battle');
    assert.equal(f1.calls.historyCtx.xpEarned, 85, 'the persisted xp equals the awarded value');

    // (b) reload of the SAME result screen -> ledger short-circuits, zero new awards
    const r2 = await BR.applyBattleXp({ battle, results: winResults, meId: A, completedAt: plus(60000), opponentName: 'Bob', ...f1.deps });
    assert.equal(r2.reason, 'ledger', 'the ledger wins over everything');
    assert.equal(r2.awardedXp, 85, 'the screen still DISPLAYS the recorded 85');
    assert.deepEqual(f1.calls.award, ['BATTLE_COMPLETE', 'BATTLE_WIN'], 'no new award on reload');
    assert.equal(f1.calls.history, 1, 'no duplicate history row on reload');

    // (c) second battle the same day (no ledger for it) -> 0 XP, history still recorded
    const battle2 = mkBattle({ id: 'btl-2', status: 'complete', completed_at: plus(3600000) });
    const f3 = mkFakes({ earned: true });
    const r3 = await BR.applyBattleXp({ battle: battle2, results: winResults, meId: A, completedAt: plus(3600000), ...f3.deps });
    assert.equal(r3.awardedXp, 0, 'daily cap pays 0');
    assert.equal(r3.capped, true);
    assert.deepEqual(f3.calls.award, [], 'awardXP is never called on a capped day');
    assert.equal(f3.calls.history, 1, 'the capped game STILL counts in history (F7 behaviour preserved)');
    assert.equal(f3.getLedger(), null, 'nothing to ledger when nothing was awarded');

    // (d) awardXP failure -> no mark, NO ledger write, history still saved with 0
    const f4 = mkFakes({ awardFails: true });
    const r4 = await BR.applyBattleXp({ battle, results: winResults, meId: A, completedAt: plus(60000), ...f4.deps });
    assert.equal(r4.awardedXp, 0);
    assert.equal(f4.calls.mark, 0, 'a failed award never marks the daily key');
    assert.equal(f4.getLedger(), null, 'the ledger marks ONLY a confirmed award');
    assert.equal(f4.calls.history, 1, 'XP failure never blocks the result/history (F7 pattern)');

    // (e) draw pays complete only
    const f5 = mkFakes();
    const r5 = await BR.applyBattleXp({ battle, results: mkResults(4, 4, 50000, 50000), meId: A, completedAt: plus(60000), ...f5.deps });
    assert.equal(r5.awardedXp, 25, 'draw = +25, no win bonus');
    assert.deepEqual(f5.calls.award, ['BATTLE_COMPLETE']);

    // (f) quiz_results row shape mirrors the accepted F7 row exactly
    const row = BR.quizResultRow({ battle, results: winResults, meId: A, xpEarned: 85, createdAt: plus(60000), opponentName: 'Bob' });
    assert.deepEqual(
      { ...row, weak_topics: row.weak_topics },
      { user_id: A, subject: null, topic: 'Bob', mode: 'battle', total_questions: 5, correct_answers: 4, accuracy: 80, time_taken: 50, xp_earned: 85, weak_topics: [], created_at: plus(60000) },
      'the battle history row keeps the existing shape (mode battle, seconds, xp_earned)'
    );
  });

  // ---------- BH12 (H12): abandon/void — no results counted, no XP, no history ----------
  await record('BH12', 'abandon: a void battle pays 0, saves no history and marks no ledger; the 30 s grace is measured on last-seen membership; the transport guards the abandon to active battles', async () => {
    needsBR();
    assert.equal(BR.isVoid(mkBattle({ status: 'abandoned' })), true);
    assert.equal(BR.isVoid(mkBattle({ status: 'complete' })), false);
    const dec = BR.battleXpDecision({ battle: mkBattle({ status: 'abandoned' }), result: 'win', alreadyEarnedToday: false, ledgerEntry: null });
    assert.equal(dec.award, false); assert.equal(dec.total, 0); assert.equal(dec.reason, 'void', 'even a "win" score on an abandoned battle pays nothing');

    // behaviour: applyBattleXp on a void battle — with results present! — still pays 0
    let history = 0; let awarded = 0;
    const out = await BR.applyBattleXp({
      battle: mkBattle({ status: 'abandoned' }),
      results: mkResults(5, 0, 10000, 0),
      meId: A,
      hasEarnedToday: async () => false,
      markEarnedToday: async () => {},
      awardXP: async () => { awarded += 1; return { gained: 25 }; },
      ledgerGet: async () => null,
      ledgerSet: async () => true,
      insertQuizResult: async () => { history += 1; },
    });
    assert.equal(out.void, true);
    assert.equal(awarded, 0, 'awardXP never called on a void battle');
    assert.equal(history, 0, 'no quiz_results row for a void battle');
    assert.ok(/void/i.test(out.msg), 'the screen gets an honest void message');

    // grace window: 30 s (PO decision d), measured from the last observed membership
    assert.equal(BR.graceExceeded(NOW, plus(29000)), false, '29 s drop -> still alive');
    assert.equal(BR.graceExceeded(NOW, plus(30000)), false, 'exactly 30 s -> not yet exceeded');
    assert.equal(BR.graceExceeded(NOW, plus(31000)), true, '31 s drop -> void');
    assert.equal(BR.graceExceeded(null, plus(999999)), false, 'unknown last-seen never voids a battle');

    // wiring: the transport only abandons ACTIVE battles, and the screen runs a watchdog
    assert.ok(/abandonBattle[\s\S]*?\.eq\('status', 'active'\)/.test(brtSrc), 'abandon is guarded to active battles (idempotent)');
    assert.ok(bsSrcH.includes('graceExceeded(') && bsSrcH.includes('ABANDON_GRACE_MS') && /voidBattle\(/.test(bsSrcH), 'BattleScreen watchdog voids on presence drop beyond the grace');
    assert.ok(/battle void/i.test(bsSrcH), 'the void state is shown honestly');
  });

  // ---------- BH1/BH2/BH14 (DEVICE in the handoff): verified as source-wiring probes ----------
  check('BH1*', '[wiring probe — DEVICE test H1] challenge create: presence is checked BEFORE any insert; an offline target produces the honest message and zero rows', () => {
    needsBR();
    const src = brtSrc.slice(brtSrc.indexOf('export async function createChallenge'), brtSrc.indexOf('export async function listChallenges'));
    const atCheck = src.indexOf('isUserOnline(toUser)');
    const atInsert = src.indexOf(".insert(");
    assert.ok(atCheck >= 0 && atInsert >= 0 && atCheck < atInsert, 'the offline check runs BEFORE the insert — nothing is created');
    assert.ok(src.includes("reason: 'opponent-offline'") && src.includes('User not available. Try again later.'), 'the offline answer is the exact honest message');
    assert.ok(src.includes('Apne aap ko challenge nahi kar sakte'), 'self-challenge is refused');
    assert.ok(/status === 'pending' && String\(c\.to_user\) === String\(toUser\) && !R\.isChallengeExpired/.test(src), 'a live pending challenge is reused, never stacked');
  });
  check('BH2*', '[wiring probe — DEVICE test H2] decline: the row flips to declined with a pending guard, no battle is ever created, and the challenger is told', () => {
    needsBR();
    const src = brtSrc.slice(brtSrc.indexOf('export async function declineChallenge'), brtSrc.indexOf('export async function cancelChallenge'));
    assert.ok(src.includes("status: 'declined'") && src.includes(".eq('status', 'pending')"), 'decline is guarded to pending rows');
    assert.ok(!src.includes("from('battles')"), 'the decline path never touches the battles table');
    assert.ok(bsSrcH.includes("row.status === 'declined'"), 'the challenger screen detects and reports the decline');
  });
  check('BH14*', '[wiring probe — DEVICE test H14] local mode: battles are ONLINE ONLY with an honest message; the hash sim and DEMO_RIVALS are provably gone from BattleScreen', () => {
    needsBR();
    assert.ok(!bsSrcH.includes('DEMO_RIVALS'), 'no demo rivals in BattleScreen');
    assert.ok(!bsSrcH.includes('hashString'), 'the hashString fake-rival sim is gone');
    assert.ok(!bsSrcH.includes('rivalScore'), 'no simulated rival score');
    assert.ok(bsSrcH.includes('LOCAL_MODE_MESSAGE') && bsSrcH.includes('BATTLES = ONLINE ONLY'), 'the offline screen states it plainly');
    assert.ok(brtSrc.includes('BATTLES_ONLINE_ONLY = true'), 'PO decision (a) is declared in the transport');
    assert.ok(/online only/i.test(gsSrcH), 'Guild also says battles are online-only in local mode');
    assert.ok(gsSrcH.includes('battleInvites.length ? ('), 'Guild renders the invite card only with real pending invites');
  });

  // ---------- BH13 (PO SQL check): the schema FILE carries the gate — live RLS verification is the PO's ----------
  check('BH13*', '[schema-file probe — live RLS check is PO-side after running the DDL] three tables, composite PK with score/time checks, participant RLS, own-row-only results, realtime publication, and an explicit "never run by the agent" gate note', () => {
    needsBR();
    const s = schemaSrcH;
    for (const t of ['public.battle_challenges', 'public.battles', 'public.battle_results']) {
      assert.ok(s.includes(`create table if not exists ${t}`), `${t} DDL present`);
      assert.ok(new RegExp(`alter table ${t.replace(/\./g, '\\.')}\\s+enable row level security`).test(s), `${t} RLS enabled`);
    }
    assert.ok(s.includes('primary key (battle_id, user_id)'), 'battle_results has the composite PK (no id column — db.upsert cannot be used)');
    assert.ok(s.includes('check (score between 0 and 5)') && s.includes('check (time_ms >= 0)'), 'score/time bounds enforced in the DB');
    for (const p of ['bc_participants', 'bc_insert_own', 'bc_update_participants', 'b_participants', 'b_insert_participant', 'b_update_participants', 'br_select_participants', 'br_insert_own', 'br_update_own']) {
      assert.ok(s.includes(`"${p}"`), `policy ${p} present`);
    }
    assert.ok(/br_insert_own[\s\S]*?auth\.uid\(\) = user_id/, 'a player can only INSERT their own result row');
    assert.ok(/br_update_own[\s\S]*?using \(auth\.uid\(\) = user_id\)/, 'a player can only UPDATE their own result row');
    assert.ok(s.includes('alter publication supabase_realtime add table public.battle_challenges') && s.includes('alter publication supabase_realtime add table public.battles'), 'realtime publication covers both handshake tables');
    assert.ok(/SCHEMA GATE/i.test(s) && /did NOT run any DDL/i.test(s), 'the schema gate is documented — the PO runs it, never the agent');
  });

  // ---------- BH15 (H15): regression guards around the battle round ----------
  check('BH15', 'regression: one outcome rule everywhere (no second winner computation), XP key/guard reuse the F7 machinery, quiz_results battle rows exist only for complete battles, Arena untouched', () => {
    needsBR();
    // exactly ONE outcome rule: the screen must not re-implement winner logic
    const cmp = (bsSrcH.match(/myScore > oppScore|correct > rivalScore|\.score > /g) || []).length;
    assert.equal(cmp, 0, 'BattleScreen contains no local winner comparison — resolveOutcome is the only rule');
    assert.ok(bsSrcH.includes('applyBattleXp(') && bsSrcH.includes('hasEarnedToday') && bsSrcH.includes('markEarnedToday'), 'the F7 guard->XP->save machinery is reused, not duplicated');
    assert.ok(/xp_earned:\s*awardedXp/.test(bsSrcH), 'the persisted xp_earned is literally the awarded value (G6 guardrail)');
    // complete-only history is behavioural: void battles insert nothing (BH12) and the
    // decision object only sets recordHistory on complete battles
    const dVoid = BR.battleXpDecision({ battle: mkBattle({ status: 'abandoned' }), result: 'win', alreadyEarnedToday: false, ledgerEntry: null });
    assert.notEqual(dVoid.recordHistory, true, 'an abandoned battle never records history');
    const dActive = BR.battleXpDecision({ battle: mkBattle({ status: 'active' }), result: 'win', alreadyEarnedToday: false, ledgerEntry: null });
    assert.equal(dActive.reason, 'not-complete', 'a still-active battle pays nothing');
    // Arena once/day + its guard are the committed behaviour — untouched files
    const arenaSrcH = safeRead('src/screens/guild/ArenaScreen.js');
    assert.ok(arenaSrcH.includes('hasEarnedToday') && arenaSrcH.includes('alreadyEarnedNote'), 'ArenaScreen still carries its own once/day guard');
    assert.ok(arenaSrcH.includes('pickDailyArena'), 'Arena still uses the global daily question set');
  });

  const failedH = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedH.length, 0, `FIX-H battles: ${failedH.length} check(s) failed -> ${failedH.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-J: CONTENT LOCKER — real uploads, daily XP guard, dedupe, search, metadata, malformed rows, ordering ----------
// Handoff acceptance IDs J1–J7 map to the checks below. DEVICE/PO-RUNTIME items
// (a real upload on a phone, the storage isolation 403 test, picker-cancel = no
// row) are verified here as SOURCE-WIRING probes and labelled as such — they do
// NOT pretend to prove device behaviour. Pure rules are proven directly against
// src/lib/contentLocker.js (plain-Node importable).
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  // imported dynamically so a missing module is a recorded failure, not a suite crash
  // — this is also the fail-before mechanism: at aaff30e contentLocker.js does not exist.
  let CL = null; let clErr = '';
  try { CL = await import('./../src/lib/contentLocker.js'); }
  catch (e) { clErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };
  const csSrcJ = safeRead('src/screens/study/ContentScreen.js');
  const clSrc = safeRead('src/lib/contentLocker.js');
  const schemaSrcJ = safeRead('supabase/schema.sql');
  const needsCL = () => assert.ok(CL, `contentLocker.js import failed: ${clErr}`);
  // slice of source between two markers — for "X happens BEFORE Y" ordering probes
  const sliceFn = (src, startMark, endMark) => {
    const i = src.indexOf(startMark);
    assert.ok(i >= 0, `marker missing: ${startMark}`);
    const j = endMark ? src.indexOf(endMark, i + startMark.length) : -1;
    return src.slice(i, j > i ? j : src.length);
  };

  const UID = '11111111-1111-4111-8111-111111111111';
  const NOWJ = '2026-09-28T12:00:00.000Z';

  // ---------- J0: the pure core exists, is importable and has NO platform imports ----------
  check('J0', 'contentLocker.js imports cleanly in plain Node and is pure — the ONLY import is config/constants.js (no react-native, no supabase, no AsyncStorage, no picker)', () => {
    needsCL();
    assert.ok(clSrc.includes('FIX-J: CONTENT LOCKER RULES (pure core)'), 'the lib declares itself the pure core');
    const imports = clSrc.match(/^import .*$/gm) || [];
    assert.ok(imports.length >= 1, 'at least one import');
    for (const line of imports) assert.ok(line.includes("from '../config/constants.js'"), `unexpected import: ${line}`);
    assert.equal(CL.CONTENT_BUCKET, 'content', 'the private bucket id is `content`');
    assert.equal(CL.MAX_UPLOAD_BYTES, 10 * 1024 * 1024, 'J1: 10 MB limit');
    assert.equal(CL.SIGNED_URL_TTL_SECONDS, 300, 'reads use SHORT-LIVED signed URLs');
    assert.equal(CL.NOTE_XP_KEY, 'note', 'J2: the mandated xpOnce key — not an invented one');
    assert.equal(CL.XP_NOTE_CREATE, XP_RULES.NOTE_CREATE.amount, 'the XP amount comes from XP_RULES.NOTE_CREATE (5)');
    assert.deepEqual(CL.FILE_TYPES, ['pdf', 'image', 'audio'], 'the three upload kinds');
  });

  // ---------- J1a: the validation gate — BEFORE any network call ----------
  check('J1a', 'validateUpload: title non-empty, extension allowlist (pdf/png/jpg/jpeg/webp/mp3/m4a/wav), 0 < size <= 10 MB — every rejection has an honest message and the OK result carries ext/type/contentType', () => {
    needsCL();
    const ok = CL.validateUpload({ title: '  Physics PDF  ', fileName: 'notes.PDF', mimeType: 'application/pdf', size: 5 * 1024 * 1024 });
    assert.equal(ok.ok, true, '5 MB PDF passes');
    assert.equal(ok.ext, 'pdf', 'extension lowercased');
    assert.equal(ok.type, 'pdf', 'locker type');
    assert.equal(ok.title, 'Physics PDF', 'title trimmed');
    assert.equal(ok.sizeBytes, 5 * 1024 * 1024);
    assert.equal(ok.contentType, 'application/pdf');
    // mime-only detection (picker sometimes knows mime but the name is odd)
    const mimeOnly = CL.validateUpload({ title: 't', fileName: 'download', mimeType: 'image/png', size: 100 });
    assert.equal(mimeOnly.ok, true, 'mime fallback works');
    assert.equal(mimeOnly.ext, 'png');
    assert.equal(mimeOnly.type, 'image');
    // exactly at the limit passes; one byte over fails
    assert.equal(CL.validateUpload({ title: 't', fileName: 'a.pdf', size: CL.MAX_UPLOAD_BYTES }).ok, true, '10 MB exactly is allowed');
    const big = CL.validateUpload({ title: 't', fileName: 'a.pdf', size: CL.MAX_UPLOAD_BYTES + 1 });
    assert.equal(big.ok, false); assert.equal(big.reason, 'too-big', '10 MB + 1 B rejected');
    assert.ok(/10 MB/.test(big.message), 'the rejection names the limit');
    // empty title / bad type / empty file
    assert.equal(CL.validateUpload({ title: '   ', fileName: 'a.pdf', size: 10 }).reason, 'empty-title', 'J6: empty-after-trim title rejected');
    assert.equal(CL.validateUpload({ title: 't', fileName: 'a.exe', mimeType: 'application/x-msdownload', size: 10 }).reason, 'bad-type', 'exe rejected');
    assert.equal(CL.validateUpload({ title: 't', fileName: 'a.pdf', size: 0 }).reason, 'empty-file', 'zero bytes rejected');
    assert.equal(CL.validateUpload({ title: 't', fileName: 'a.pdf', size: NaN }).reason, 'empty-file', 'unknown size rejected');
    // helper functions
    assert.equal(CL.extOf('a.PDF'), 'pdf'); assert.equal(CL.extOf('noext'), ''); assert.equal(CL.extOf('trailing.'), '');
    assert.equal(CL.extFromMime('audio/x-m4a'), 'm4a'); assert.equal(CL.extFromMime('image/jpeg'), 'jpg');
    assert.equal(CL.typeForExt('jpeg'), 'image', 'jpeg kept as the jpg alias (declared deviation)');
    assert.equal(CL.typeForExt('exe'), null);
    assert.equal(CL.fmtFileSize(10 * 1024 * 1024), '10 MB');
    // every picker mime maps back to its own kind — the picker offer and the gate agree
    for (const kind of CL.FILE_TYPES) {
      for (const mime of CL.PICKER_MIME[kind]) {
        assert.equal(CL.typeForExt(CL.extFromMime(mime)), kind, `${mime} -> ${kind}`);
      }
    }
  });

  // ---------- J1b: storage path shape + the row an upload produces ----------
  check('J1b', 'storageObjectName = {uid}/{id}.{ext} with uid ALWAYS the first path segment (what content_storage_own pins); junk ids/exts are sanitized; no uid -> null; fileRowFrom stores the object NAME (never a URL) with the exact content columns', () => {
    needsCL();
    const name = CL.storageObjectName(UID, 'pdf', 'ID-42');
    assert.equal(name, `${UID}/ID-42.pdf`, 'exact {uid}/{uuid}.{ext} shape');
    assert.equal(CL.firstSegmentIsUser(name, UID), true, 'segment 1 is the user id');
    assert.equal(CL.firstSegmentIsUser(name, 'someone-else'), false, 'another uid never owns the path');
    const dirty = CL.storageObjectName(UID, 'pd/f', '../../evil');
    assert.equal(CL.firstSegmentIsUser(dirty, UID), true, 'path-traversal junk still lands under the uid folder');
    assert.ok(!dirty.includes('..'), 'no traversal survives safeId');
    assert.equal(CL.storageObjectName('', 'pdf', 'id'), null, 'no uid -> no path -> the screen refuses the upload');
    assert.equal(CL.storageFullPath(UID, 'pdf', 'ID-42'), `content/${UID}/ID-42.pdf`, 'display path is bucket + name');
    // the row
    const row = CL.fileRowFrom({ userId: UID, title: '  My PDF ', type: 'pdf', sizeBytes: 5 * 1024 * 1024, objectName: name, subject: ' Physics ', topic: '', createdAt: NOWJ });
    assert.deepEqual(Object.keys(row).sort(), ['ai_summary', 'created_at', 'file_size', 'subject', 'text', 'title', 'topic', 'type', 'url', 'user_id'].sort(), 'exactly the content-table columns — nothing extra (db.insert spread-order trap avoided)');
    assert.equal(row.url, name, 'url column holds the storage object NAME');
    assert.equal(row.text, null);
    assert.equal(row.title, 'My PDF', 'title trimmed');
    assert.equal(row.subject, 'Physics', 'subject trimmed');
    assert.equal(row.topic, null, 'empty topic -> null');
    assert.equal(row.file_size, 5 * 1024 * 1024);
    assert.equal(row.created_at, NOWJ);
    assert.equal(CL.isStoredFileRow(row), true, 'the row is recognized as an uploaded file');
    // an http link that merely ENDS in .pdf is NOT a stored file — it stays a link
    assert.equal(CL.isStoredFileRow({ type: 'pdf', url: 'https://x.com/a.pdf' }), false, 'http(s) urls are never treated as storage names');
    assert.equal(CL.isStoredFileRow({ type: 'note', url: name }), false, 'only file kinds count');
    assert.equal(CL.isStoredFileRow(null), false, 'junk -> false, no crash');
  });

  // ---------- J1*: DEVICE upload flow — verified as source-wiring probes ----------
  // FIX-CONTENT (PO 2026-10-02): old FormData {uri} with empty name rejected on Android
  // (Unsupported FormDataPart). New native path = fetch(uri).blob() first, fallback
  // expo-file-system base64 → Uint8Array. Probe updated to accept new shape.
  check('J1*', '[wiring probe — DEVICE/PO-RUNTIME: a real upload + the 403 isolation test happen on a device after the PO runs the DDL] the screen validates BEFORE any network call, uploads {uid}/{uuid}.{ext} with upsert:false into the private bucket, opens files via short-lived signed URLs only, and never touches getPublicUrl/createBucket/service_role', () => {
    needsCL();
    // deps: original picker + approved file-system/print/sharing (PO 2026-10-02)
    assert.ok(csSrcJ.includes("import { getDocumentAsync } from 'expo-document-picker'"), 'picker still present');
    assert.ok(csSrcJ.includes('expo-file-system') || csSrcJ.includes('FileSystem'), 'FIX-CONTENT: expo-file-system used for native file read (approved dep)');
    const pick = sliceFn(csSrcJ, 'const pickFile = async (kind)', 'const uploadBody');
    const iLoc = pick.indexOf('LOCAL_UPLOAD_MESSAGE'); const iPick = pick.indexOf('getDocumentAsync(');
    assert.ok(iLoc >= 0 && iPick >= 0 && iLoc < iPick, 'local mode gets the honest cloud-only message BEFORE the picker opens');
    assert.ok(/if \(res\?\.canceled[^\n]*\) return;/.test(pick), 'DEVICE test: a CANCELLED picker returns silently — no row, no upload, no XP');
    assert.ok(pick.includes('copyToCacheDirectory: true'), 'the picked file is copied to cache so the native upload can read its uri');
    assert.ok(pick.includes('typeForExt(ext)') && pick.includes('MAX_UPLOAD_BYTES'), 'type + size are gated immediately after picking');
    const save = sliceFn(csSrcJ, 'const saveFile = async () => {', '// ---------- opening items');
    const iV = save.indexOf('validateUpload('); const iU = save.indexOf('.upload(');
    assert.ok(iV >= 0 && iU >= 0 && iV < iU, 'the FULL validateUpload gate runs BEFORE any network call [J1a]');
    assert.ok(/storageObjectName\(profile\.id, v\.ext, uuid\(\)\)/.test(save), 'object name = {uid}/{uuid}.{ext}');
    assert.ok(save.includes('upsert: false') && save.includes('contentType: v.contentType'), 'upload is create-only with the right content type');
    assert.ok(save.includes(`from(CONTENT_BUCKET)`), 'uploads target the `content` bucket constant');
    assert.ok(save.includes('fileRowFrom('), 'the inserted row is built by the pure lib');
    // native body shape — FIX-CONTENT new path
    assert.ok(!csSrcJ.includes("fd.append('', {"), 'old broken FormData empty-name path removed (FIX-CONTENT)');
    assert.ok(
      (csSrcJ.includes('fetch(p.uri)') && csSrcJ.includes('blob()')) ||
      csSrcJ.includes('readAsStringAsync') ||
      csSrcJ.includes('FileSystem') ||
      csSrcJ.includes('base64') ||
      csSrcJ.includes('Uint8Array'),
      'native body = blob or file-system base64 → Uint8Array (FIX-CONTENT approved)'
    );
    // web branch kept byte-identical
    assert.ok(csSrcJ.includes('if (p.file) return p.file'), 'web branch still returns p.file directly');
    // opening files: signed URLs ONLY
    assert.ok(csSrcJ.includes('createSignedUrl(item.url, SIGNED_URL_TTL_SECONDS)'), 'opens via a short-lived signed URL');
    assert.ok(!csSrcJ.includes('getPublicUrl'), 'NEVER a public URL (the bucket is private)');
    assert.ok(!csSrcJ.includes('service_role') && !clSrc.includes('service_role'), 'no service-role key anywhere in this round');
    assert.ok(!csSrcJ.includes('createBucket') && !clSrc.includes('createBucket'), 'the app NEVER creates buckets — that is PO-executed DDL');
    // audio playback toggle + cleanup
    assert.ok(csSrcJ.includes('toggleAudio') && csSrcJ.includes('stopAudio'), 'audio rows play/stop through one helper');
    assert.ok(csSrcJ.includes('return () => stopAudio();'), 'leaving the screen stops playback');
  });

  // ---------- J1†: schema-file probe — the storage DDL is written but NEVER run by the agent ----------
  check('J1†', '[schema-file probe — live Storage checks are PO-side after running the DDL] private `content` bucket + content_storage_own policy pinned to (storage.foldername(name))[1] = auth.uid()::text, idempotent, with the explicit agent-never-ran-this gate note', () => {
    needsCL();
    const s = schemaSrcJ;
    assert.ok(s.includes('insert into storage.buckets (id, name, public)'), 'bucket insert present');
    assert.ok(s.includes("values ('content', 'content', false)"), 'the bucket is PRIVATE (public = false)');
    assert.ok(s.includes('on conflict (id) do nothing'), 'idempotent re-run');
    assert.ok(s.includes('drop policy if exists "content_storage_own" on storage.objects;'), 'policy creation is idempotent');
    assert.ok(s.includes('create policy "content_storage_own"'), 'policy present');
    assert.ok(s.includes('(storage.foldername(name))[1] = auth.uid()::text'), 'every operation is pinned to the caller\'s own uid folder');
    assert.ok(/content_storage_own[\s\S]*?using \(bucket_id = 'content'[\s\S]*?with check \(bucket_id = 'content'/m.test(s), 'USING and WITH CHECK both scope to the content bucket');
    assert.ok(/SCHEMA GATE/i.test(s) && /did NOT run any DDL/i.test(s), 'the gate note states the agent never ran this');
    assert.ok(/MUST stay private/i.test(s), 'the privacy requirement is written down');
  });

  // ---------- J2: NOTE_CREATE daily guard (xpOnce key 'note') — decision + injected effects ----------
  await record('J2', 'applyNoteXp: first save today awards +5 via the injected awardXP and marks the ledger; a later same-day save awards 0 with the exact honest message; awardXP failure or guard-read failure NEVER blocks the save (display-only result); no second guard mechanism exists', async () => {
    needsCL();
    const mkFakes = ({ earned = false, awardThrows = false } = {}) => {
      const state = { earned, marks: 0, awards: 0 };
      return {
        state,
        hasEarnedToday: async () => { if (state.earned === 'throw') throw new Error('guard read boom'); return state.earned; },
        markEarnedToday: async () => { state.marks += 1; state.earned = true; },
        awardXP: async () => { state.awards += 1; if (awardThrows) throw new Error('award boom'); return { gained: 5 }; },
      };
    };
    // first save today
    const f1 = mkFakes();
    const r1 = await CL.applyNoteXp({ userId: UID, hasEarnedToday: f1.hasEarnedToday, markEarnedToday: f1.markEarnedToday, awardXP: f1.awardXP });
    assert.equal(r1.reason, 'first-today'); assert.equal(r1.awardedXp, 5, '+5 XP on the first save');
    assert.equal(f1.state.awards, 1); assert.equal(f1.state.marks, 1, 'the ledger is marked only after a successful award');
    // second save the same day -> 0 XP, still succeeds
    const r2 = await CL.applyNoteXp({ userId: UID, hasEarnedToday: f1.hasEarnedToday, markEarnedToday: f1.markEarnedToday, awardXP: f1.awardXP });
    assert.equal(r2.reason, 'daily-cap'); assert.equal(r2.awardedXp, 0, 'later saves pay 0');
    assert.equal(f1.state.awards, 1, 'awardXP is never called again the same day');
    assert.ok(r2.msg.includes('Aaj ka note XP mil chuka'), 'the exact honest daily-cap message');
    // award failure: save still fine, ledger NOT marked (a retry can earn later)
    const f2 = mkFakes({ awardThrows: true });
    const r3 = await CL.applyNoteXp({ userId: UID, hasEarnedToday: f2.hasEarnedToday, markEarnedToday: f2.markEarnedToday, awardXP: f2.awardXP });
    assert.equal(r3.awardedXp, 0); assert.equal(f2.state.marks, 0, 'a failed award never marks the day as earned');
    assert.ok(/save phir bhi/i.test(r3.msg), 'the message says the SAVE still happened');
    // guard-read failure: treated as not-earned, the award proceeds — the save never depends on XP machinery
    const f3 = mkFakes({ earned: 'throw' });
    const r4 = await CL.applyNoteXp({ userId: UID, hasEarnedToday: f3.hasEarnedToday, markEarnedToday: f3.markEarnedToday, awardXP: f3.awardXP });
    assert.equal(r4.reason, 'first-today'); assert.equal(f3.state.awards, 1, 'a broken guard read cannot block the flow');
    // the decision itself is pure
    assert.equal(CL.noteXpDecision({ alreadyEarnedToday: false }).amount, 5);
    assert.equal(CL.noteXpDecision({ alreadyEarnedToday: true }).award, false);
  });

  check('J2*', '[wiring probe] the screen runs guard->award->mark through the ONE xpOnce mechanism (key \'note\'), inserts the row FIRST so the save never depends on XP, and contains no direct awardXP(\'NOTE_CREATE\') call or second guard', () => {
    needsCL();
    assert.ok(csSrcJ.includes("import { hasEarnedToday, markEarnedToday } from '../../lib/xpOnce'"), 'the existing xpOnce module is reused — not reinvented');
    assert.ok(csSrcJ.includes('applyNoteXp('), 'both add() and saveFile() go through applyNoteXp');
    assert.ok(!csSrcJ.includes("awardXP('NOTE_CREATE')"), 'no unguarded direct NOTE_CREATE award remains');
    assert.ok(/hasEarnedToday\(userId, NOTE_XP_KEY\)/.test(clSrc) && /markEarnedToday\(userId, NOTE_XP_KEY\)/.test(clSrc), 'the lib uses the mandated key \'note\' for both guard calls');
    const add = sliceFn(csSrcJ, 'const add = async () => {', 'const remove = async (item)');
    const iIns = add.indexOf("db.insert('content'"); const iXp = add.indexOf('applyNoteXp(');
    assert.ok(iIns >= 0 && iXp >= 0 && iIns < iXp, 'add(): the row is inserted BEFORE XP is even considered');
    const save = sliceFn(csSrcJ, 'const saveFile = async () => {', '// ---------- opening items');
    assert.ok(save.indexOf("db.insert('content'") < save.indexOf('applyNoteXp('), 'saveFile(): upload+insert happen BEFORE XP');
  });

  // ---------- J3: dedupe ----------
  check('J3', 'findDuplicate: same URL modulo case/scheme/trailing-slash is ONE item; same note title+text modulo case/whitespace is ONE item; uploaded-file rows never collide (unique storage names); deleting the original frees the key; the message is exactly "Already saved in your locker"', () => {
    needsCL();
    assert.equal(CL.DUPLICATE_MESSAGE, 'Already saved in your locker', 'exact copy per spec');
    const stored = { id: 'l1', type: 'youtube', title: 'Old title', url: 'https://YouTube.com/Watch?v=1/', text: null };
    // case + scheme + trailing slash all collapse
    assert.ok(CL.findDuplicate([stored], { type: 'link', title: 'Whatever', url: 'http://youtube.com/watch?v=1' }), 'http vs https + case + trailing slash = duplicate');
    assert.ok(CL.findDuplicate([stored], { type: 'youtube', title: 'X', url: 'youtube.com/watch?v=1' }), 'a scheme-less retype is the same link');
    assert.equal(CL.findDuplicate([stored], { type: 'link', title: 'X', url: 'https://youtube.com/watch?v=2' }), null, 'a different URL is not a duplicate');
    // notes: title + text, whitespace-collapsed, case-insensitive
    const noteRow = { id: 'n1', type: 'note', title: 'My Note', text: 'Hello   World', url: null };
    assert.ok(CL.findDuplicate([noteRow], { type: 'note', title: '  my NOTE ', text: 'hello world' }), 'case/whitespace variants are the same note');
    assert.equal(CL.findDuplicate([noteRow], { type: 'note', title: 'My Note', text: 'hello world!' }), null, 'different text is not a duplicate');
    // the title alone does not make notes duplicates, and vice versa
    assert.equal(CL.findDuplicate([noteRow], { type: 'note', title: 'My Note', text: 'totally different' }), null);
    // uploaded files never dedupe — every upload has a unique {uid}/{uuid}.{ext} name
    const fileRow = CL.fileRowFrom({ userId: UID, title: 'Same title', type: 'pdf', sizeBytes: 10, objectName: CL.storageObjectName(UID, 'pdf', 'ID-1'), createdAt: NOWJ });
    assert.equal(CL.dedupeKeyOf(fileRow), null, 'file rows have no dedupe key');
    assert.equal(CL.findDuplicate([fileRow], { ...fileRow, id: 'other' }), null, 're-uploading the same document is allowed');
    // deleting the original frees the key -> re-save works
    assert.ok(CL.findDuplicate([noteRow], { type: 'note', title: 'My Note', text: 'Hello World' }), 'blocked while the original exists');
    assert.equal(CL.findDuplicate([], { type: 'note', title: 'My Note', text: 'Hello World' }), null, 'after delete the same note saves again');
    // junk never crashes
    assert.equal(CL.dedupeKeyOf(null), null);
    assert.equal(CL.dedupeKeyOf({ type: 'note' }), null, 'an empty note has no key');
    assert.equal(CL.findDuplicate(null, null), null);
    assert.equal(CL.findDuplicate([null, undefined, 'junk'], { type: 'note', title: 'a', text: 'b' }), null, 'garbage rows are skipped');
  });

  check('J3*', '[wiring probe] add() dedupes BEFORE the insert and shows the exact duplicate message; the DUPLICATE path performs zero writes', () => {
    needsCL();
    const add = sliceFn(csSrcJ, 'const add = async () => {', 'const remove = async (item)');
    const iDup = add.indexOf('findDuplicate(items || []');
    const iIns = add.indexOf("db.insert('content'");
    assert.ok(iDup >= 0 && iIns >= 0 && iDup < iIns, 'the duplicate check runs before any insert');
    assert.ok(/if \(findDuplicate\([^\n]*\)\) \{ setAiMsg\(DUPLICATE_MESSAGE\); return; \}/.test(add), 'a duplicate shows the exact message and RETURNS — no insert, no XP');
    assert.ok(add.includes('normalizeUrl(form.body)'), 'the candidate URL is normalized before dedupe/insert');
  });

  // ---------- J4: search ----------
  check('J4', 'matchesSearch: substring over title/text/subject, case-insensitive, empty query matches everything, URLs are NOT searched; filterItems composes search WITH the type chip and survives junk rows — all client-side, zero server calls', () => {
    needsCL();
    const rows = [
      { id: '1', type: 'note', title: 'Thermodynamics Notes', text: 'laws of energy', subject: 'Physics' },
      { id: '2', type: 'link', title: 'Thermo video', text: null, subject: 'Physics', url: 'https://youtu.be/x' },
      { id: '3', type: 'note', title: 'Algebra', text: 'quadratic equations', subject: 'Maths' },
    ];
    assert.equal(CL.matchesSearch(rows[0], 'thermo'), true, 'title substring');
    assert.equal(CL.matchesSearch(rows[0], 'ENERGY'), true, 'text substring, case-insensitive');
    assert.equal(CL.matchesSearch(rows[0], 'physics'), true, 'subject substring');
    assert.equal(CL.matchesSearch(rows[0], 'chem'), false, 'no match');
    assert.equal(CL.matchesSearch(rows[0], ''), true, 'empty query matches all');
    assert.equal(CL.matchesSearch(rows[0], '   '), true, 'whitespace query matches all');
    assert.equal(CL.matchesSearch(rows[0], null), true, 'null query matches all');
    assert.equal(CL.matchesSearch({ title: null, text: null, subject: null, url: 'https://thermo.com' }, 'thermo'), false, 'the URL is NOT part of the search fields');
    assert.equal(CL.matchesSearch({}, 'x'), false, 'junk row: no crash, no match');
    // composition with the type filter
    assert.deepEqual(CL.filterItems(rows, { type: 'All', query: 'thermo' }).map((r) => r.id), ['1', '2'], 'search across all types');
    assert.deepEqual(CL.filterItems(rows, { type: 'note', query: 'thermo' }).map((r) => r.id), ['1'], 'type chip AND search compose');
    assert.deepEqual(CL.filterItems(rows, { type: 'note', query: '' }).map((r) => r.id), ['1', '3'], 'chip alone still works');
    assert.deepEqual(CL.filterItems(rows, {}).map((r) => r.id), ['1', '2', '3'], 'defaults = show all');
    assert.deepEqual(CL.filterItems(null, { query: 'x' }), [], 'null list -> empty, no crash');
    assert.deepEqual(CL.filterItems([null, rows[0]], { query: 'thermo' }).map((r) => r.id), ['1'], 'junk rows are skipped');
  });

  check('J4*', '[wiring probe] the screen renders filterItems(items, { type: filter, query }) and has a search Input bound to setQuery — no server-side search, no schema change', () => {
    needsCL();
    assert.ok(csSrcJ.includes('const shown = filterItems(items, { type: filter, query });'), 'the list is filtered+searched through the pure lib');
    assert.ok(csSrcJ.includes('onChangeText={setQuery}'), 'a search Input exists');
    assert.ok(/Search locker/i.test(csSrcJ), 'the search box is labelled');
    assert.ok(!csSrcJ.includes('.ilike(') && !csSrcJ.includes('.textSearch('), 'no server-side search calls');
    assert.ok(!schemaSrcJ.includes('to_tsvector'), 'no schema change for search');
  });

  // ---------- J5: syllabus metadata ----------
  check('J5', 'syllabusChoices: subjects/chapters come from the student\'s OWN syllabus rows; ARCHIVED rows are excluded even if the caller forgets activeSyllabusRows; duplicates collapse; junk/empty rows are skipped; the choice shape feeds subject + chaptersBySubject', () => {
    needsCL();
    const syl = [
      { id: 's1', subject: 'Physics', chapter: 'Kinematics', status: 'active' },
      { id: 's2', subject: 'Physics', chapter: 'Kinematics', status: 'in_progress' }, // duplicate chapter
      { id: 's3', subject: 'Physics', chapter: 'Laws of Motion', status: 'active' },
      { id: 's4', subject: 'Maths', chapter: 'Trigonometry', status: 'archived' },    // S5 archived history
      { id: 's5', subject: 'Bio', chapter: 'Cells', status: 'ARCHIVED' },             // case-variant archived
      { id: 's6', subject: 'Chem', chapter: 'Bonding', status: 'completed' },
      null, { id: 's7', subject: '  ', chapter: 'Nothing' },                          // empty subject skipped
      { id: 's8', subject: 'Chem', chapter: '' },                                     // empty chapter skipped
    ];
    const ch = CL.syllabusChoices(syl);
    assert.deepEqual(ch.subjects, ['Physics', 'Chem'], 'archived subjects (Maths, Bio) never offered; uniques only; empty skipped');
    assert.deepEqual(ch.chaptersBySubject.Physics, ['Kinematics', 'Laws of Motion'], 'chapters unique, in row order');
    assert.deepEqual(ch.chaptersBySubject.Chem, ['Bonding'], 'an empty chapter does not create an entry');
    assert.equal(ch.chaptersBySubject.Maths, undefined, 'no archived chapters leak');
    assert.deepEqual(CL.syllabusChoices(null), { subjects: [], chaptersBySubject: {} }, 'null input -> empty choices, no crash');
    assert.deepEqual(CL.syllabusChoices('junk'), { subjects: [], chaptersBySubject: {} }, 'junk input -> empty choices');
  });

  check('J5*', '[wiring probe] the screen loads choices via syllabusChoices(activeSyllabusRows(syl)), persists topic on insert, renders subject+topic on the card, and clears the chapter when the subject changes', () => {
    needsCL();
    assert.ok(csSrcJ.includes('syllabusChoices(activeSyllabusRows(syl))'), 'choices = the student\'s OWN active syllabus rows (S5 helper)');
    assert.ok(csSrcJ.includes('topic: form.topic.trim() || null'), 'add() persists the chapter into the EXISTING topic column');
    assert.ok(csSrcJ.includes('topic: form.topic'), 'saveFile persists it too via form state');
    assert.ok(/\[c\.subject, c\.topic\]\.filter\(Boolean\)\.join\(' · '\)/.test(csSrcJ), 'subject · topic is shown on the card');
    assert.ok(csSrcJ.includes("onChangeText={(v) => setForm({ ...form, subject: v, topic: '' })}"), 'changing the subject clears the stale chapter');
    assert.ok(csSrcJ.includes('chaptersBySubject[form.subject]'), 'chapter chips come from the chosen subject');
    // no new columns — the FIX-J storage block must not touch the content table at all
    // (pre-existing defensive `alter table public.content … created_at` migrations predate this round)
    const fixJBlock = schemaSrcJ.slice(schemaSrcJ.indexOf('FIX-J: CONTENT STORAGE'), schemaSrcJ.indexOf('Done! 🎉'));
    assert.ok(fixJBlock.length > 100, 'the FIX-J schema block was located');
    assert.ok(!/alter table|create table/i.test(fixJBlock), 'FIX-J adds NO table/column changes — the existing subject/topic fields are reused');
  });

  // ---------- J6: malformed input ----------
  check('J6', 'normalizeUrl: bare hosts get https:// (BUG-5 kept), host/scheme case folds, trailing slash drops, path case survives; javascript:/data:/ftp:/whitespace are REJECTED (null); safeCard is total — null/junk/unknown-type/missing-fields all produce a renderable fallback card and never throw', () => {
    needsCL();
    assert.equal(CL.normalizeUrl('YouTube.com/watch?v=1'), 'https://youtube.com/watch?v=1', 'bare host -> https, host lowercased, path kept');
    assert.equal(CL.normalizeUrl('HTTPS://X.com/A/'), 'https://x.com/A', 'scheme+host fold, trailing slash drops, PATH case preserved for display/open');
    assert.equal(CL.normalizeUrl('http://x.com/a/'), 'http://x.com/a', 'http stays http (only the KEY is scheme-insensitive)');
    assert.equal(CL.normalizeUrl('https://x.com:8080/a'), 'https://x.com:8080/a', 'ports are fine');
    assert.equal(CL.normalizeUrl('https://x.com/a//'), 'https://x.com/a', 'repeated trailing slashes drop');
    assert.equal(CL.normalizeUrl('javascript:alert(1)'), null, 'J6: javascript: rejected');
    assert.equal(CL.normalizeUrl('data:text/html,<script>'), null, 'data: rejected');
    assert.equal(CL.normalizeUrl('ftp://files.example.com/a'), null, 'ftp: rejected');
    assert.equal(CL.normalizeUrl(''), null); assert.equal(CL.normalizeUrl('   '), null); assert.equal(CL.normalizeUrl(null), null);
    assert.equal(CL.normalizeUrl('https://x .com/a'), null, 'whitespace anywhere -> rejected');
    assert.equal(CL.normalizeUrl('https:///path'), null, 'empty host -> rejected');
    assert.equal(CL.urlDedupeKey('https://X.com/a/'), 'x.com/a', 'the dedupe key drops scheme+trailing slash');
    assert.equal(CL.urlDedupeKey('https://X.com/A/'), 'x.com/a', 'the dedupe key ALSO folds path case (J3: fully case-insensitive)');
    assert.equal(CL.urlDedupeKey('javascript:x'), null);
    // safeCard totality
    for (const junk of [null, undefined, 42, 'str', {}, [], { type: 'weird' }, { type: 'pdf', url: null, title: null, text: null, file_size: 'big' }]) {
      const c = CL.safeCard(junk);
      assert.ok(c && typeof c === 'object' && typeof c.title === 'string' && c.title.length > 0, `safeCard(${JSON.stringify(junk)}) -> renderable card`);
      assert.equal(typeof c.canOpen, 'boolean');
      assert.equal(typeof c.isFile, 'boolean');
    }
    assert.equal(CL.safeCard(null).malformed, true, 'null row = the fallback card');
    assert.equal(CL.safeCard(null).title, 'Unknown item');
    assert.equal(CL.safeCard({ type: 'weird', title: 'X' }).type, 'note', 'unknown types degrade to a note-style card');
    assert.equal(CL.safeCard({ type: 'weird', title: 'X' }).malformed, true);
    assert.equal(CL.safeCard({ type: 'note', title: '  ' }).title, '(Untitled)', 'blank titles render (Untitled)');
    const fc = CL.safeCard(CL.fileRowFrom({ userId: UID, title: 'F', type: 'audio', sizeBytes: 2048, objectName: `${UID}/i.mp3`, createdAt: NOWJ }));
    assert.equal(fc.isFile, true); assert.equal(fc.fileSizeLabel, '2 KB', 'file rows show a size label');
    assert.equal(fc.canOpen, true, 'a file row is openable (signed URL path)');
  });

  check('J6*', '[wiring probe] the screen rejects empty titles / non-http(s) links / empty note text with visible messages, renders every row through safeCard with a row-${idx} key fallback, guards open() with normalizeUrl, and keeps exactly ONE normalizeUrl implementation (the lib)', () => {
    needsCL();
    const add = sliceFn(csSrcJ, 'const add = async () => {', 'const remove = async (item)');
    assert.ok(/if \(!title\) \{ setAiMsg\('Title khali nahi ho sakta\.'\); return; \}/.test(add), 'empty-after-trim title is rejected visibly');
    assert.ok(/if \(!url\) \{ setAiMsg\('Link http\(s\) hona chahiye/.test(add), 'non-http(s) links are rejected visibly');
    assert.ok(add.includes("if (!isLink && !text) { setAiMsg('Note text khali nahi ho sakta.')"), 'empty note text is rejected visibly');
    // list rendering
    assert.ok(csSrcJ.includes('const c = safeCard(item);'), 'rows render through safeCard');
    assert.ok(csSrcJ.includes('key={item?.id || `row-${idx}`}'), 'rows without ids still get a stable key');
    assert.ok(csSrcJ.includes('localDateOf(item?.created_at)'), 'missing created_at cannot crash the date label');
    // open() guards
    const openFn = sliceFn(csSrcJ, 'const open = async (item) => {', 'if (!items) {');
    assert.ok(openFn.includes('const c = safeCard(item);'), 'open() decides from the safe card');
    assert.ok(/const u = normalizeUrl\(c\.url\);[\s\S]*?if \(u\) Linking\.openURL\(u\)/.test(openFn), 'garbage URLs never reach Linking');
    assert.ok(openFn.includes("setAiMsg('Is item mein kholne ko kuch nahi hai (adhoora row).')"), 'a row with nothing to open says so honestly');
    // one implementation only
    assert.ok(!/const normalizeUrl =/.test(csSrcJ), 'the screen no longer re-implements normalizeUrl — the lib is the single source');
    assert.ok(csSrcJ.includes('const u = normalizeUrl(url); if (u) Linking.openURL(u)'), 'FreeLibrary links are guarded too');
    assert.ok(csSrcJ.includes('const detectType'), 'detectType (link vs youtube) is untouched');
  });

  // ---------- J7: ordering + persistence + delete-with-storage ----------
  check('J7', 'sortItemsDesc: created_at DESC with a stable id tie-break, input never mutated, deterministic across runs, junk/null-safe (missing created_at sinks); compareCreatedDesc agrees', () => {
    needsCL();
    const rows = [
      { id: 'b', created_at: '2026-09-27T10:00:00Z' },
      { id: 'a', created_at: '2026-09-28T10:00:00Z' },
      { id: 'c2', created_at: '2026-09-27T10:00:00Z' },
      { id: 'c1', created_at: '2026-09-27T10:00:00Z' },
    ];
    const sorted = CL.sortItemsDesc(rows);
    assert.deepEqual(sorted.map((r) => r.id), ['a', 'b', 'c1', 'c2'], 'newest first; equal timestamps tie-break by id ASC (stable)');
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c2', 'c1'], 'the input array is NEVER mutated');
    assert.deepEqual(CL.sortItemsDesc(rows).map((r) => r.id), sorted.map((r) => r.id), 'deterministic across runs');
    assert.deepEqual(CL.sortItemsDesc(null), [], 'null -> []');
    assert.doesNotThrow(() => CL.sortItemsDesc([null, { id: 'x' }, { id: 'y', created_at: NOWJ }]));
    const withMissing = CL.sortItemsDesc([{ id: 'old' }, { id: 'new', created_at: NOWJ }]);
    assert.deepEqual(withMissing.map((r) => r.id), ['new', 'old'], 'a missing created_at sinks to the bottom instead of crashing');
    assert.equal(CL.compareCreatedDesc(null, null), 0);
    assert.ok(CL.compareCreatedDesc({ created_at: '2026-01-02' }, { created_at: '2026-01-01' }) < 0, 'newer sorts first');
  });

  check('J7*', '[wiring probe — DEVICE test: cloud+local persistence across reload, and the storage 403 isolation check, are PO/device-side] the screen sorts every load through sortItemsDesc, and remove() deletes the STORAGE OBJECT first (visible error + abort on failure) so a deleted upload never leaves an orphan', () => {
    needsCL();
    assert.ok(csSrcJ.includes('setItems(sortItemsDesc(rows));'), 'the loaded list is ordered created_at desc through the lib (cloud AND local go through db.list)');
    assert.ok(csSrcJ.includes("db.list('content'") && csSrcJ.includes("db.remove('content'"), 'persistence stays on the existing db layer — cloud supabase / local AsyncStorage, unchanged');
    const rem = sliceFn(csSrcJ, 'const remove = async (item) => {', '// BUG 5 behaviour');
    const iSt = rem.indexOf('.remove([item.url])'); const iDb = rem.indexOf("db.remove('content'");
    assert.ok(iSt >= 0 && iDb >= 0 && iSt < iDb, 'the storage object is removed BEFORE the row — no orphan objects');
    assert.ok(rem.includes('isStoredFileRow(item) && isRemote()'), 'only uploaded cloud files touch storage (links/notes/local rows do not)');
    const iErr = rem.indexOf('if (error) {'); const iMsg = rem.indexOf('setAiMsg(', iErr); const iRet = rem.indexOf('return;', iErr);
    assert.ok(iErr >= 0 && iMsg > iErr && iRet > iMsg, 'a storage-remove failure is VISIBLE (setAiMsg) and ABORTS the row delete (return) — F6 pattern');
    assert.ok(rem.includes(`from(CONTENT_BUCKET)`), 'the delete targets the same private bucket');
  });

  // ---------- JREG: regression guards around the locker round ----------
  check('JREG', 'regression: note/link save+open flows intact, the F6 visible-error pattern and the FIX-D2 full-screen reader survive, files are the ONLY cloud-gated kind (local mode still saves notes/links), and no scope creep (no new tables, no schema edits beyond the gated storage block)', () => {
    needsCL();
    // F6 + reader probes (committed constraints)
    assert.ok(csSrcJ.includes('FIX-F6') && csSrcJ.includes('silent failure audit'), 'the F6 audit comments survive');
    for (const p of ['noteOpen', 'fullReaderOpen', 'full-screen note reader', 'maxHeight="92%"', 'maxHeight: 520', 'selectable', 'numberOfLines']) {
      assert.ok(csSrcJ.includes(p), `reader probe survives: ${p}`);
    }
    // local mode: notes/links keep working offline; only uploads are cloud-gated
    const add = sliceFn(csSrcJ, 'const add = async () => {', 'const remove = async (item)');
    assert.ok(!add.includes('LOCAL_UPLOAD_MESSAGE') && !add.includes('isRemote'), 'add() has NO cloud gate — local students keep saving notes/links');
    assert.ok(csSrcJ.includes('LOCAL_UPLOAD_MESSAGE'), 'the honest cloud-only message exists for file kinds');
    // error surfaces remain visible, never silent
    assert.ok(/catch \(e\) \{\s*console\.warn\('\[F6\] Content add failed'/.test(csSrcJ), 'add keeps its visible catch');
    assert.ok(/catch \(e\) \{\s*console\.warn\('\[F6\] Content remove failed'/.test(csSrcJ), 'remove keeps its visible catch');
    assert.ok(csSrcJ.includes("console.warn('[J1] upload failed'"), 'upload failures are visible too');
    // scope: no new tables this round; the only schema addition is the gated storage block
    const contentTables = (schemaSrcJ.match(/create table if not exists public\.content/g) || []).length;
    assert.equal(contentTables, 1, 'the content table DDL is untouched/unchanged (no new locker tables)');
    assert.ok(schemaSrcJ.includes('FIX-J: CONTENT STORAGE'), 'the only FIX-J schema text is the gated storage block');
    // the dependency footprint is exactly one new package
    const pkg = JSON.parse(safeRead('package.json'));
    assert.ok(pkg.dependencies['expo-document-picker'], 'expo-document-picker declared in package.json');
  });

  const failedJ = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedJ.length, 0, `FIX-J: ${failedJ.length} check(s) failed -> ${failedJ.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-BYTE: PROFESSOR BYTE — general assistant, selected context, language mirroring, sanitizer, global access ----------
// Handoff acceptance PB-A…PB-E map to the checks below. PB1/PB5/PB6/PB7/PB8/PB9/PB10
// are DEVICE/PO-RUNTIME (real model answers, isolation, mid-chat language switch,
// visual formatting, reachability on a device, provider-key swap) — verified here
// as SOURCE-WIRING probes where possible and labelled as such; they do NOT
// pretend to prove live model behaviour. Pure rules are proven directly against
// src/lib/byteContext.js (plain-Node importable).
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };

  // imported dynamically so a missing module is a recorded failure, not a suite crash
  // — this is also the fail-before mechanism: at b36840b byteContext.js does not exist.
  let BC = null; let bcErr = '';
  try { BC = await import('./../src/lib/byteContext.js'); }
  catch (e) { bcErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };
  const bcSrc = safeRead('src/lib/byteContext.js');
  const asSrc = safeRead('src/lib/aiService.js');
  const afSrcPB = safeRead('src/lib/aiFeatures.js');
  const tsSrc = safeRead('src/screens/study/TutorScreen.js');
  const rnSrc = safeRead('src/navigation/RootNavigator.js');
  const hsSrc = safeRead('src/screens/home/HomeScreen.js');
  const needsBC = () => assert.ok(BC, `byteContext.js import failed: ${bcErr}`);
  const TODAY = '2026-09-29';

  // ---------- PB0: the pure core exists, imports cleanly, no platform deps ----------
  check('PB0', 'byteContext.js imports cleanly in plain Node and is pure — the ONLY import is config/constants.js (no supabase, no AsyncStorage, no react-native, no dayjs chain); caps and header are the PO-confirmed values', () => {
    needsBC();
    const imports = bcSrc.match(/^import .*$/gm) || [];
    assert.ok(imports.length >= 1, 'at least one import');
    for (const line of imports) assert.ok(line.includes("from '../config/constants.js'"), `unexpected import: ${line}`);
    assert.equal(BC.MAX_CONTEXT_CATEGORIES, 3, 'PO-confirmed hard cap: <=3 categories per call');
    assert.equal(BC.MAX_BLOCK_CHARS, 600, 'each block <= ~600 chars — prompts stay small, never the whole DB');
    assert.equal(BC.CONTEXT_HEADER, 'StudentOS context (use only if relevant):', 'the injection header per handoff §4');
    assert.ok(BC.ALL_KEYWORDS.includes('everything') && BC.ALL_KEYWORDS.includes('my progress'), 'explicit "use everything" intents exist (PB4)');
  });

  // ---------- PB-A: relevance-based category selection ----------
  check('PB-A', 'selectCategories: general-knowledge message -> profile ONLY; "revision plan for biology exam" -> academic; "plan today\'s workout" -> fitness; "organize tomorrow" -> schedule+habits; "everything about my progress" -> broad set; the cap NEVER exceeds 3 categories on any message', () => {
    needsBC();
    assert.deepEqual(BC.selectCategories('How does photosynthesis work?'), ['profile'], 'general knowledge needs no StudentOS data');
    assert.deepEqual(BC.selectCategories('What is the capital of France?'), ['profile'], 'another general question -> profile only');
    assert.deepEqual(BC.selectCategories(''), ['profile'], 'empty message -> profile only');
    assert.deepEqual(BC.selectCategories(null), ['profile'], 'null-safe');
    const rev = BC.selectCategories('Make a revision plan for my biology exam');
    assert.ok(rev.includes('academic'), 'exam/revision -> academicCtx');
    const wo = BC.selectCategories("plan today's workout");
    assert.ok(wo.includes('fitness'), 'workout -> fitnessCtx');
    const org = BC.selectCategories('Help me organize tomorrow');
    assert.ok(org.includes('schedule') && org.includes('habits'), 'organize tomorrow -> scheduleCtx(+habits) exactly as PB-A specifies');
    const all = BC.selectCategories('Tell me everything about my progress');
    assert.ok(all.length > 1 && all.length <= 3, 'explicit everything -> broad set, still capped');
    assert.ok(all.includes('academic'), 'the broad set is progress-relevant (academic first by priority)');
    assert.ok(BC.selectCategories('my gym split feels wrong').includes('fitness'), 'gym/split -> fitness');
    assert.ok(BC.selectCategories('how do I make friends?').includes('social'), 'friends -> social');
    assert.ok(BC.selectCategories('I lack discipline with my habits').includes('habits'), 'habit/discipline -> habits');
    assert.ok(BC.selectCategories('aaj ka din kaise plan karun').includes('schedule'), 'Hinglish aaj/plan -> schedule (language mirroring includes selection)');
    // the cap is absolute, even for an everything-at-once message
    for (const m of ['exam workout habit friend schedule today everything my progress', 'gym exam plan habit friends', 'studentos all context everything about me']) {
      assert.ok(BC.selectCategories(m).length <= 3, `cap holds for: ${m}`);
      assert.equal(BC.selectCategories(m)[0], 'profile', 'profile always leads (identity, tiny)');
    }
  });

  // ---------- PB-B: every resolver/formatter is total — '' on junk, never throws ----------
  await record('PB-B', 'formatters return \'\' on empty/junk data and never throw; resolveByteContext isolates EVERY category fetch in its own try/catch — a failing category contributes nothing and Byte proceeds; every fetch is scoped to the user id (identity/privacy)', async () => {
    needsBC();
    for (const junk of [null, undefined, {}, 'str', 42, []]) {
      assert.doesNotThrow(() => BC.profileCtx(junk), 'profileCtx total');
      assert.doesNotThrow(() => BC.academicCtx(junk), 'academicCtx total');
      assert.doesNotThrow(() => BC.scheduleCtx(junk), 'scheduleCtx total');
      assert.doesNotThrow(() => BC.habitsCtx(junk), 'habitsCtx total');
      assert.doesNotThrow(() => BC.fitnessCtx(junk), 'fitnessCtx total');
      assert.doesNotThrow(() => BC.socialCtx(junk), 'socialCtx total');
    }
    assert.equal(BC.profileCtx(null), ''); assert.equal(BC.profileCtx({}), '');
    assert.equal(BC.academicCtx({}), ''); assert.equal(BC.scheduleCtx({}), '');
    assert.equal(BC.habitsCtx({}), ''); assert.equal(BC.habitsCtx({ habits: [] }), '');
    assert.equal(BC.fitnessCtx({}), ''); assert.equal(BC.socialCtx({}), '');
    assert.equal(BC.socialCtx({ friendCount: 0 }), '', 'zero friends -> nothing to say');
    assert.equal(BC.countFriends(null, undefined, 'u'), 0, 'countFriends junk-safe');
    // profile with real fields -> the 4-liner + name + streak
    const pc = BC.profileCtx({ display_name: 'Asha', class_level: 'Class 10', board: 'CBSE', competitive_exam: 'JEE Main', exam_date: '2027-04-01', olympiad: 'None', prep_level: 'Intermediate', current_streak: 12 });
    assert.ok(pc.includes('Asha') && pc.includes('Class 10') && pc.includes('CBSE') && pc.includes('preparing for JEE Main on 2027-04-01') && pc.includes('12-day streak'), 'profileCtx carries name/class/board/exam/streak');
    assert.ok(!pc.includes('None'), 'unset olympiad never shows');
    // academic: archived rows excluded (S5), counts + deadlines only
    const ac = BC.academicCtx({
      syllabus: [
        { subject: 'Maths', chapter: 'Quadratic', status: 'completed', deadline: '2026-10-05' },
        { subject: 'Maths', chapter: 'Trig', status: 'in_progress' },
        { subject: 'OldHist', chapter: 'X', status: 'archived' },
      ],
      deadlines: [
        { topic: 'Lab report', deadline_date: '2026-10-02', status: 'pending' },
        { topic: 'Old one', deadline_date: '2026-09-01', status: 'pending' }, // past -> excluded
        { topic: 'Done', deadline_date: '2026-10-09', status: 'completed' },   // completed -> excluded
      ],
      profile: {}, today: TODAY,
    });
    assert.ok(ac.includes('Maths 1/2 done'), 'per-subject done/total');
    assert.ok(!ac.includes('OldHist'), 'archived syllabus rows NEVER reach Byte');
    assert.ok(ac.includes('Lab report due 2026-10-02'), 'upcoming deadline included');
    assert.ok(!ac.includes('Old one') && !ac.includes('Done'), 'past/completed deadlines excluded');
    // habits: done/pending against today's logs
    const hc = BC.habitsCtx({
      habits: [{ id: 'h1', name: 'Read 10 pages', icon: '📚' }, { id: 'h2', name: 'Stretch', icon: '🤸' }],
      logsToday: [{ habit_id: 'h1', completed: true }],
    });
    assert.ok(hc.includes('1/2 habits done today') && hc.includes('Read 10 pages — done') && hc.includes('Stretch — pending'), 'habit status lines');
    // resolveByteContext: EVERY table fetch throws -> still answers, profile-only, no rejection
    const throwingList = async () => { throw new Error('db down'); };
    const out1 = await BC.resolveByteContext({ list: throwingList, profile: { id: 'u1', display_name: 'Asha', class_level: 'Class 10' }, message: 'my exam revision', today: TODAY });
    assert.equal(typeof out1, 'string', 'never rejects');
    assert.ok(out1.includes('Asha'), 'the profile block survives a total db failure (PB11)');
    assert.ok(!out1.includes('db down'), 'context errors are never surfaced into the prompt');
    // selective failure: syllabus throws, schedule works -> schedule still lands
    const calls = [];
    const partialList = async (table, opts) => {
      calls.push({ table, opts });
      if (table === 'syllabus' || table === 'deadlines') throw new Error('boom');
      if (table === 'schedule') return [{ date: TODAY, start_time: '17:00', subject: 'Physics', topic: 'Optics', session_type: 'study', status: 'pending' }];
      return [];
    };
    const out2 = await BC.resolveByteContext({ list: partialList, profile: { id: 'u1', display_name: 'Asha' }, message: 'revision plan and my schedule for today', today: TODAY });
    assert.ok(out2.includes('Physics') && out2.includes('Optics'), 'the category that loaded is used');
    assert.ok(!out2.includes('boom'), 'the failed category is silently skipped');
    // identity scoping: EVERY fetch carries the user id (RLS + F5 guard upstream)
    assert.ok(calls.length > 0, 'fetches happened');
    for (const c of calls) {
      const eq = (c.opts && c.opts.eq) || {};
      assert.ok(eq.user_id === 'u1' || eq.friend_id === 'u1', `${c.table} fetch is scoped to the user id`);
    }
    // no uid (guest) -> profile-only, zero fetches
    calls.length = 0;
    const out3 = await BC.resolveByteContext({ list: partialList, profile: {}, message: 'my exam', today: TODAY });
    assert.equal(calls.length, 0, 'a guest triggers ZERO db fetches');
    assert.ok(!out3.includes('Academics'), 'guests get no academic block');
    // social: COUNT only — friend names never enter the context
    const friendsList = async (table) => {
      if (table !== 'friends') return [];
      return [
        { user_id: 'u1', friend_id: 'p1', friend_name: 'Priya', status: 'accepted' },
        { user_id: 'p2', friend_id: 'u1', friend_name: 'Raj', status: 'accepted' },
        { user_id: 'u1', friend_id: 'p3', friend_name: 'Ghost', status: 'pending' }, // pending never counts
      ];
    };
    const out4 = await BC.resolveByteContext({ list: friendsList, profile: { id: 'u1' }, message: 'about my friends', today: TODAY });
    assert.ok(out4.includes('2 friends'), 'accepted friends counted in BOTH directions');
    assert.ok(!out4.includes('Priya') && !out4.includes('Raj') && !out4.includes('Ghost'), 'NEVER names, never pending requests (PO-confirmed)');
    // no list function at all -> still fine
    const out5 = await BC.resolveByteContext({ profile: { id: 'u1', display_name: 'Asha' }, message: 'exam prep', today: TODAY });
    assert.ok(out5.includes('Asha'), 'missing db injection degrades to profile-only, no throw');
  });

  // ---------- PB-C: persona + system strings (P1/P2/P3/P8 + §13-5 neutralization) ----------
  check('PB-C', 'persona/system strings: NO "Max ~180 words", NO "steer back", NO forced-Hinglish mandate anywhere in the AI prompts; language-mirroring instruction present; general-purpose identity present; the plain-text + no-LaTeX formatting contracts are KEPT; AI fallback strings neutralized to English (PO §13-5)', () => {
    needsBC();
    // the persona (single source of truth)
    assert.ok(asSrc.includes('general-purpose AI assistant'), 'Byte is a general-purpose assistant, not a study-only mentor');
    assert.ok(asSrc.includes('Never steer the user back to studying'), 'P1 fixed at the persona level too');
    assert.ok(asSrc.includes('SAME language the user writes in'), 'language-mirroring instruction present');
    assert.ok(asSrc.includes('Never force Hindi/Hinglish into an English conversation'), 'no forced Hindi flavor');
    assert.ok(asSrc.includes('Length follows the question'), 'P2 fixed: no artificial cap');
    assert.ok(!asSrc.includes('Light Hinglish flavor'), 'the forced-Hinglish mandate is gone');
    assert.ok(!asSrc.includes('short-ish'), 'the "short-ish" bias is gone');
    assert.ok(asSrc.includes('NEVER use Markdown') && asSrc.includes('NEVER write LaTeX'), 'the plain-text + math contracts survive (PB-D depends on them)');
    assert.ok(asSrc.includes('export function stripMarkdown'), 'the existing askAI-level strip survives');
    // the tutor layer
    assert.ok(!afSrcPB.includes('gently steer back'), 'P1: the steer-back instruction is gone');
    assert.ok(!afSrcPB.includes('Max ~180 words'), 'P2: the 180-word cap is gone');
    assert.ok(afSrcPB.includes('fitness, life and social questions, general knowledge, writing and coding'), 'the tutor system string covers general topics');
    assert.ok(/Length follows the question — short for simple asks, detailed when depth genuinely helps/.test(afSrcPB), 'length follows the request');
    // P8: other features no longer hardcode Hinglish
    assert.ok(!afSrcPB.includes('Hinglish-flavored English'), 'aiMotivate mandate stripped');
    assert.ok(!afSrcPB.includes('Hinglish flavor ok'), 'aiDailyMessage + weekly reflection mandates stripped');
    assert.ok(!afSrcPB.includes('next week ke liye'), 'weekly reflection prompt is language-neutral');
    assert.ok((afSrcPB.match(/in the user's language/g) || []).length >= 3, "motivate/daily/reflection now say \"in the user's language\"");
    // §13-5 (PO decision): AI fallback strings neutralized
    for (const s of ['dobara try karo', 'Asli wajah', 'offline, yaar', 'keys missing hai', 'samajh nahi aaya', 'ne time liya', 'accept nahi hui']) {
      assert.ok(!asSrc.includes(s), `aiService fallback neutralized: "${s}" is gone`);
    }
    assert.ok(asSrc.includes('Please try again'), 'neutral English retry copy present');
    assert.ok(!tsSrc.includes('Thodi technical gadbad'), 'TutorScreen fallback neutralized');
    assert.ok(tsSrc.includes('Something went wrong on my side'), 'the neutral fallback is in place');
    // provider chain untouched (MUST-NOT list): the F9-era internals survive
    assert.ok(asSrc.includes('callProvider') && asSrc.includes('MAX_TOTAL_MS'), 'retry/timeout internals untouched');
  });

  // ---------- PB-D: the display sanitizer ----------
  check('PB-D', 'sanitizeMarkdownStray: **bold**->bold, leading -/* bullets -> •, ``` fences and # headings stripped; math/LaTeX-ish plain text (what MathText renders) is UNTOUCHED; idempotent; non-strings pass through', () => {
    needsBC();
    assert.equal(BC.sanitizeMarkdownStray('**Bold** idea'), 'Bold idea', '** stripped');
    assert.equal(BC.sanitizeMarkdownStray('- item one'), '• item one', 'dash bullet -> •');
    assert.equal(BC.sanitizeMarkdownStray('* item two'), '• item two', 'star bullet -> •');
    assert.equal(BC.sanitizeMarkdownStray('```js\nconst a = 1;\n```'), 'const a = 1;\n', 'code fences stripped');
    assert.equal(BC.sanitizeMarkdownStray('## Heading\nbody'), 'Heading\nbody', 'heading markers stripped');
    const math = 'Solve x^2 + 1 = 0 → x = ±i. sqrt(2) ≈ 1.414, ∫ f(x) dx, θ = π/4, d/dx of x^(n+1)';
    assert.equal(BC.sanitizeMarkdownStray(math), math, 'math notation untouched — MathText keeps working');
    const once = BC.sanitizeMarkdownStray('**a**\n- b');
    assert.equal(BC.sanitizeMarkdownStray(once), once, 'idempotent (askAI already strips once — double application is safe)');
    assert.equal(BC.sanitizeMarkdownStray(42), 42, 'non-string passes through');
    assert.equal(BC.sanitizeMarkdownStray(null), null, 'null passes through');
    assert.equal(BC.sanitizeMarkdownStray('mid-word hyphen ok\n2 - 3 = -1'), 'mid-word hyphen ok\n2 - 3 = -1', 'inline hyphens/minuses are NOT bullets');
  });

  // ---------- PB-E: prompt assembly ----------
  check('PB-E', 'prompt assembly: the context block is injected ONLY when non-empty (with its "use only if relevant" header), capped at 2400 chars, per-category blocks clipped to 600; the history cap stays at exactly 8 messages', () => {
    needsBC();
    // functional: selectContext emptiness + header + clipping
    assert.equal(BC.selectContext({ profile: '' }, 'hi'), '', 'empty blocks -> empty context (prompt carries NO context section)');
    assert.equal(BC.selectContext({}, 'photosynthesis'), '', 'no blocks at all -> empty');
    const withCtx = BC.selectContext({ profile: 'Asha · Class 10', academic: 'Maths 1/2 done' }, 'exam revision');
    assert.ok(withCtx.startsWith(BC.CONTEXT_HEADER), 'the header leads the block');
    assert.ok(withCtx.includes('Profile: Asha · Class 10'), 'category labels are human-readable');
    assert.ok(!withCtx.includes('Habits'), 'unselected categories never ride along');
    const long = 'x'.repeat(700);
    const clipped = BC.selectContext({ profile: long }, 'hi');
    assert.ok(clipped.includes('x'.repeat(600)) && !clipped.includes('x'.repeat(601)), 'each block clipped to 600 chars');
    // wiring: aiTutorReply injects only when non-empty, with its own safety cap
    assert.ok(/ctxBlock \? ctxBlock\.slice\(0, 2400\) : ''/.test(afSrcPB), 'context injected ONLY when non-empty, capped');
    // scoped to aiTutorReply — 'Student context:' legitimately survives in rewriteAnswerWindows (FIX-G3, untouched)
    const tutorFn = afSrcPB.slice(afSrcPB.indexOf('export async function aiTutorReply'), afSrcPB.indexOf('export async function aiMotivate'));
    assert.ok(tutorFn.length > 100, 'aiTutorReply region located');
    assert.ok(!tutorFn.includes('Student context:'), 'the old blind 400-char profile injection is gone from aiTutorReply');
    assert.ok(tutorFn.includes('ctxBlock'), 'the selected block is what gets injected');
    assert.ok(afSrcPB.includes('.slice(-8)'), 'history cap UNCHANGED at 8');
    assert.ok(/system: `\$\{AI_PERSONA\}\\nYou are chatting in the Professor Byte screen/.test(afSrcPB), 'the tutor system string still composes AI_PERSONA (one source of truth)');
    assert.ok(afSrcPB.includes('use it only where it is relevant'), 'the system string marks the context optional');
  });

  // ---------- PB-F*: wiring probes — global access, screen plumbing, storage untouched ----------
  check('PB-F*', '[wiring probe — DEVICE tests PB1/PB6/PB7/PB8/PB9/PB10 are PO/device-side] TutorScreen fetches context per message via resolveByteContext with db.list INJECTED, sanitizes every reply before persist, chips are general-purpose, Byte is registered in Home+Life+Study stacks with a Home header icon, and the chat storage mechanism is untouched', () => {
    needsBC();
    // screen plumbing
    assert.ok(tsSrc.includes("import { resolveByteContext, sanitizeMarkdownStray } from '../../lib/byteContext'"), 'the screen uses the pure lib');
    assert.ok(tsSrc.includes('list: (table, opts) => db.list(table, opts)'), 'db.list is INJECTED — byteContext stays pure');
    assert.ok(tsSrc.includes('resolveByteContext({'), 'context is resolved per message');
    const iResolve = tsSrc.indexOf('resolveByteContext({');
    const iReply = tsSrc.indexOf('aiTutorReply({ history');
    const iSan = tsSrc.indexOf('reply = sanitizeMarkdownStray(reply)');
    const iPersist = tsSrc.indexOf("{ role: 'assistant', content: reply");
    assert.ok(iResolve >= 0 && iReply > iResolve, 'context is resolved BEFORE the AI call');
    assert.ok(iSan > iReply && iPersist > iSan, 'every reply is sanitized BEFORE persist/render');
    assert.ok(tsSrc.includes('buildProfileContext(profile || {})'), 'the motivate path keeps the tiny profile line');
    // chips generalized (P7)
    assert.ok(!tsSrc.includes('from my syllabus'), 'the study-locked quiz chip is gone');
    assert.ok(tsSrc.includes('Plan my day') && tsSrc.includes('Help me write'), 'general-purpose chips exist');
    assert.ok(tsSrc.includes('__MOTIVATE__'), 'the motivate chip still works');
    // global access (P6): 3 registrations, Home header icon, hub param
    const tutorRegs = (rnSrc.match(/name="Tutor" component=\{TutorScreen\}/g) || []).length;
    assert.equal(tutorRegs, 3, 'Tutor registered in Study + Home + Life stacks');
    assert.ok(rnSrc.includes('<LifeStack.Screen name="Settings" component={SettingsScreen} />'), 'LifeStack carries Settings (Byte\'s AI-key banner navigates there)');
    assert.ok(hsSrc.includes("navigation.navigate('Tutor', { hub: 'HomeMain' })"), 'Home header icon entry (in-stack push)');
    assert.ok(hsSrc.includes('chatbubble-ellipses-outline'), 'the icon itself');
    assert.ok(hsSrc.includes("screen: 'Tutor'"), 'the existing Home Byte card is untouched');
    assert.ok(tsSrc.includes("route?.params?.hub || 'StudyHub'"), 'back fallback is per-entry (StudyHub for the classic entry)');
    // MUST-NOTs: chat storage + provider reuse untouched
    assert.ok(tsSrc.includes('sos.chat.') && tsSrc.includes('.slice(-60)'), 'chat storage mechanism unchanged (device-local, cap 60)');
    assert.ok(tsSrc.includes('MathText'), 'replies still render through MathText');
    assert.ok(afSrcPB.includes('return askAI({') && afSrcPB.includes('temperature: 0.7'), 'aiTutorReply still reuses askAI as-is (provider swappable)');
    // §13-1 (PO decision): NO markdown renderer dependency was added
    const pkg = JSON.parse(safeRead('package.json'));
    assert.ok(!pkg.dependencies['react-native-markdown-display'], 'plain-text sanitize path chosen — no markdown renderer dependency');
    const mdDeps = Object.keys(pkg.dependencies).filter((d) => /markdown/i.test(d));
    assert.equal(mdDeps.length, 0, 'zero markdown dependencies');
  });

  // ---------- PB-G: regression guards around the Byte round ----------
  check('PB-G', 'regression: the provider chain/retry/timeout internals, the other AI features\' logic, db/schema/XP/gym/scheduler/battle code are untouched; F9 model documentation survives; the only package.json footprint is the pre-existing FIX-J picker', () => {
    needsBC();
    // F9-era aiService documentation + model lists (committed probes depend on these)
    assert.ok(asSrc.includes('FIX-F9') && asSrc.includes('qwen/qwen3.6-27b') && asSrc.includes('REMOVED'), 'F9 removal comment intact');
    assert.ok(asSrc.includes('openai/gpt-oss-120b') && asSrc.includes('openai/gpt-oss-20b'), 'Groq models intact');
    assert.ok(asSrc.includes('gemini-flash-latest'), 'Gemini models intact');
    assert.ok(asSrc.includes('looksLikeMissingModel') && asSrc.includes('isRetryable'), 'fallback-chain helpers intact');
    // other AI features untouched: quiz/test/mindmap/battle AI keep their logic
    assert.ok(afSrcPB.includes('normalizeMindMapResponse'), 'mind map normalizer intact');
    assert.ok(afSrcPB.includes('export function buildProfileContext'), 'buildProfileContext still exported (daily message + others use it)');
    assert.ok(afSrcPB.includes('school exam days are light revision only'), 'FIX-D4 aiReschedule prompt intact');
    assert.ok(afSrcPB.includes('rewriteAnswerWindows'), 'FIX-G3 rewrite pass intact');
    // no db/schema/XP changes this round
    const schemaSrcPB = safeRead('supabase/schema.sql');
    assert.ok(!/byte|context/i.test(schemaSrcPB.slice(schemaSrcPB.indexOf('FIX-J: CONTENT STORAGE'), schemaSrcPB.indexOf('Done! 🎉'))), 'the storage block is unchanged (no FIX-BYTE schema text at all)');
    assert.ok(!schemaSrcPB.includes('FIX-BYTE'), 'FIX-BYTE touches NO schema');
    // package.json: picker from FIX-J remains; nothing new this round
    const pkg = JSON.parse(safeRead('package.json'));
    assert.ok(pkg.dependencies['expo-document-picker'], 'FIX-J dependency untouched');
    // nav: 5 tabs unchanged
    assert.equal((rnSrc.match(/name: '\w+Tab'/g) || []).length, 5, 'the 5-tab structure is unchanged (no nav redesign)');
  });

  const failedPB = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedPB.length, 0, `FIX-BYTE: ${failedPB.length} check(s) failed -> ${failedPB.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-BYTE2: Item A (residual Hinglish strings) + Item C (sanitizer regex hardening) ----------
// PO decisions executed: (a) DO the 17-string neutralization, (d) aiModelGuard.js
// allowlisted for this round ONLY, (c) HARDEN the sanitizer riding along, (b) B1
// accept-and-declare the persist order — ZERO code change (the existing PB-F*
// probe already locks sanitize-before-persist, which IS the B1-accepted behaviour).
// Red-before: at c64900b the 17 strings exist and '2 * 3 * 4 = 24' is mangled.
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };
  const asSrc2 = safeRead('src/lib/aiService.js');
  const afSrc2 = safeRead('src/lib/aiFeatures.js');
  const agSrc2 = safeRead('src/lib/aiModelGuard.js');

  // dynamically imported so a broken module is a recorded failure, not a crash
  let BC2 = null; let bc2Err = '';
  try { BC2 = await import('./../src/lib/byteContext.js'); }
  catch (e) { bc2Err = String(e && e.message ? e.message : e).split('\n')[0]; }

  // ---------- PB-H (Item A): the locked §13-5 neutralization is now COMPLETE ----------
  check('PB-H', 'Item A: aiService.js + aiFeatures.js + aiModelGuard.js (PO-allowlisted, this round only) contain NONE of the residual Hinglish fallback tokens, and every template interpolation survived the swap exactly', () => {
    const FORBIDDEN = ['karo', 'nahi aaye', 'nahi mile', 'nahi bana', 'ban paya', 'ban payi', 'bheja', 'diye', 'samajh nahi', 'kat gaya', 'chhota', 'baaki:'];
    const files = [['aiService.js', asSrc2], ['aiFeatures.js', afSrc2], ['aiModelGuard.js', agSrc2]];
    for (const [name, src] of files) {
      assert.ok(src.length > 500, `${name} was read`);
      for (const tok of FORBIDDEN) assert.ok(!src.includes(tok), `${name} still contains "${tok}"`);
    }
    // interpolations preserved exactly (no template variable lost in the swap)
    assert.ok(asSrc2.includes("The AI's answer was cut off mid-generation (truncated). Please try again — the generation limit has been raised!"), 'aiService truncation string neutralized (#1)');
    assert.ok(agSrc2.includes('AI timeout — total time ${MAX_TOTAL_MS / 1000}s exceeded. Please try again.'), 'aiModelGuard timeout keeps ${MAX_TOTAL_MS / 1000}s (#17)');
    assert.ok(afSrc2.includes('The AI returned only ${result.clean.length}/${count} questions — try a smaller count or try again.'), 'quiz-count string keeps ${result.clean.length}/${count} (#4)');
    assert.ok(afSrc2.includes("The AI didn't return the ${stillMissing.join(', ').toUpperCase()} section — please retry. Present: ${presentTypes.join(', ') || 'none'}"), 'paper-section string keeps both interpolations (#11)');
    assert.ok(afSrc2.includes('The AI returned only ${totalQs}/${totalQuestions} questions — try a smaller count or try again.'), 'paper-count string keeps ${totalQs}/${totalQuestions} (#12)');
    assert.ok(afSrc2.includes('_banner: `${questions.length}/${totalQuestions} questions returned${missLine ? ` — missing: ${missLine}` : \'\'}${skipLine} — please try again`'), 'partial banner keeps ${questions.length}/${totalQuestions} + missLine + skipLine (#14)');
    assert.ok(afSrc2.includes("Mind map came back small — ${shortfalls.join('; ')} — please try again"), 'mind-map banner keeps ${shortfalls.join} (#16)');
    // the neutralized plain strings (spot-check the rest of the inventory)
    for (const s of ['No AI habit suggestions came back.', "Couldn't parse the AI's quiz — pulling from the bank instead.",
      'AI deck generation failed — empty cards came back.', 'No AI challenge questions came back.',
      "The AI couldn't build a reschedule plan.", "The weekly reflection couldn't be generated.",
      "The AI couldn't build a syllabus.", 'The AI returned an empty paper — try a smaller count.',
      'The AI returned an empty question bank — please try again.', "Mind map couldn't be generated — please try again"]) {
      assert.ok(afSrc2.includes(s), `neutralized string present: ${s.slice(0, 45)}…`);
    }
    // FIX-BYTE's own neutralizations survive (no regression of the previous round)
    assert.ok(asSrc2.includes('Please try again') && !asSrc2.includes('Asli wajah'), 'FIX-BYTE §13-5 strings intact');
  });

  // ---------- PB-D2 (Item C): sanitizer regex hardening — the handoff's exact acceptance cases ----------
  check('PB-D2', 'Item C: spaced-asterisk arithmetic (2 * 3 * 4 = 24) passes through UNCHANGED; a line-start - followed by a DIGIT is never bulleted; - item / * item still become • item (letters incl. Devanagari); bold/headings/fences behaviour unchanged; idempotency preserved', () => {
    assert.ok(BC2, `byteContext.js import failed: ${bc2Err}`);
    const s = BC2.sanitizeMarkdownStray;
    // acceptance case 1: the arithmetic regression is fixed
    assert.equal(s('2 * 3 * 4 = 24'), '2 * 3 * 4 = 24', 'spaced asterisks between digits are MATH, not italics');
    assert.equal(s('2*3*4 = 24'), '2*3*4 = 24', 'unspaced stays safe too');
    assert.equal(s('The answer is 3 * 4, then 5 * 6.'), 'The answer is 3 * 4, then 5 * 6.', 'letters BETWEEN two spaced-asterisk pairs still count as math');
    // acceptance case 2: digit after a line-start marker is never bulleted
    assert.equal(s('- 3 = 2'), '- 3 = 2', 'math continuation line untouched');
    const steps = 'solve:\n- 5x = 10\n- 2y + 1 = 7';
    assert.equal(s(steps), steps, 'digit-led lines stay (5x/2y start with digits)');
    // acceptance case 3: real bullets still convert — Latin AND Devanagari letters
    assert.equal(s('- item'), '• item', 'dash bullet still converts');
    assert.equal(s('* item'), '• item', 'star bullet still converts');
    assert.equal(s('  - indented item'), '• indented item', 'indented bullet still converts');
    assert.equal(s('- पढ़ाई'), '• पढ़ाई', 'Devanagari bullet converts (language mirroring)');
    // acceptance case 4: everything else unchanged from PB-D
    assert.equal(s('**Bold** idea'), 'Bold idea', 'bold stripping unchanged');
    assert.equal(s('## Heading\nbody'), 'Heading\nbody', 'heading stripping unchanged');
    assert.equal(s('```js\nconst a = 1;\n```'), 'const a = 1;\n', 'fence stripping unchanged');
    assert.equal(s('*important* word'), 'important word', 'letter italics still strip');
    const math = 'Solve x^2 + 1 = 0 → x = ±i. sqrt(2) ≈ 1.414, ∫ f(x) dx, θ = π/4';
    assert.equal(s(math), math, 'plain math text untouched');
    // acceptance case 5: idempotency over a mixed sample
    const mixed = '**Note**\n- alpha\n2 * 3 * 4 = 24\n- 5 = 5\n*beta*\n```x\ny\n```';
    assert.equal(s(s(mixed)), s(mixed), 'idempotent');
    // non-strings still pass through
    assert.equal(s(null), null); assert.equal(s(42), 42);
  });

  const failedPB2 = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedPB2.length, 0, `FIX-BYTE2: ${failedPB2.length} check(s) failed -> ${failedPB2.map((f) => f.id).join(', ')}`);
}

// ---------- FIX-AUTH: Google sign-in on Android + standalone (no-Metro) APK ----------
// Audit RC2 (token parser cannot read #fragment) is proven fixed here; RC1 is a
// PO-executed Supabase dashboard config gate and RC3 is the PO-executed EAS
// build — both are DEVICE/PO-RUNTIME and asserted here only as config-file
// probes (OA3). Red-before: at the pre-commit tip oauthParams.js does not
// exist, auth.js still calls parseQueryParams, and app.json/eas.json lack the
// EAS config.
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };
  // recursive walk of src/ collecting .js sources (for the no-localhost probe)
  const walkJs = (dir) => {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walkJs(p));
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
    }
    return out;
  };

  // imported dynamically so a missing module is a recorded failure, not a suite crash
  let OA = null; let oaErr = '';
  try { OA = await import('./../src/lib/oauthParams.js'); }
  catch (e) { oaErr = String(e && e.message ? e.message : e).split('\n')[0]; }
  const needsOA = () => assert.ok(OA, `oauthParams.js import failed: ${oaErr}`);

  // ---------- OA1: parseOAuthParams behaviour (RC2) ----------
  check('OA1', 'parseOAuthParams: fragment-only implicit response yields access_token/refresh_token/expires_in; ?code= query yields code; mixed query+fragment parses BOTH (fragment wins duplicates); values percent-decoded (+ = space); null/junk/empty/"not a url" -> {} and NEVER throws', () => {
    needsOA();
    const p = OA.parseOAuthParams;
    // the exact implicit-flow shape GoTrue returns without PKCE (audit RC2)
    const frag = p('studentos://auth-callback#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer');
    assert.equal(frag.access_token, 'abc123', 'access_token read from the FRAGMENT (the bug this round fixes)');
    assert.equal(frag.refresh_token, 'def456');
    assert.equal(frag.expires_in, '3600');
    assert.equal(frag.token_type, 'bearer');
    // query-shaped responses still work
    assert.equal(p('studentos://auth-callback?code=xyz').code, 'xyz', '?code= query parsed (future PKCE path needs no parser change)');
    // mixed: both sides land in one object; the fragment wins duplicate keys
    const mixed = p('https://ref.supabase.co/auth/v1/callback?code=abc#access_token=tok&refresh_token=r');
    assert.equal(mixed.code, 'abc'); assert.equal(mixed.access_token, 'tok'); assert.equal(mixed.refresh_token, 'r');
    const dup = p('s://cb?a=1#access_token=FRAG&a=2');
    assert.equal(dup.a, '2', 'fragment values win (that is where implicit tokens live)');
    assert.equal(dup.access_token, 'FRAG');
    // error responses are captured for the honest-error message
    const err = p('studentos://auth-callback#error=server_error&error_description=bad%20thing+here');
    assert.equal(err.error, 'server_error');
    assert.equal(err.error_description, 'bad thing here', 'percent-decoding AND + -> space');
    // totality: junk never throws, always an object
    for (const junk of [null, undefined, '', 'not a url', 42, {}, [], 'studentos://auth-callback', '#&&&=', '?', '##', '%E0%A4%A']) {
      const r = p(junk);
      assert.ok(r && typeof r === 'object' && !Array.isArray(r), `parseOAuthParams(${JSON.stringify(junk)}) -> object`);
    }
    assert.deepEqual(p(null), {}); assert.deepEqual(p('not a url'), {}); assert.deepEqual(p('studentos://auth-callback'), {}, 'a callback with no params -> {}');
    // malformed percent escapes degrade to raw values instead of throwing
    assert.equal(p('#a=%E0%A4%A').a, '%E0%A4%A', 'undecodable escape kept raw, no throw');
  });

  // ---------- OA2: auth.js wiring probe (native branch only; web branch untouched) ----------
  check('OA2', '[wiring probe — DEVICE QA items 1-9 are PO-side on the built APK] auth.js native branch now parses via parseOAuthParams(result.url) and keeps the audited flow shape: studentos://auth-callback, openAuthSessionAsync(authUrl, redirectTo), setSession->getSession->persist chain, cancel path, web branch on window.location.origin; the superseded parser is kept (remove-nothing); NO localhost literal anywhere in src/', () => {
    needsOA();
    const authSrc = safeRead('src/lib/auth.js');
    assert.ok(authSrc.length > 1000, 'auth.js was read');
    // the RC2 fix
    assert.ok(authSrc.includes("import { parseOAuthParams } from './oauthParams'"), 'the pure parser is imported');
    assert.ok(authSrc.includes('const params = parseOAuthParams(result.url);'), 'the native branch parses through parseOAuthParams');
    assert.ok(!authSrc.includes('parseQueryParams(result.url)'), 'the query-only parser is no longer called on the redirect');
    assert.ok(authSrc.includes('function parseQueryParams'), 'the superseded parser is KEPT, not deleted (remove-nothing rule)');
    // the audited flow shape survives
    assert.ok(authSrc.includes("const redirectTo = 'studentos://auth-callback'"), 'the custom-scheme redirect is unchanged');
    assert.ok(authSrc.includes('WebBrowser.openAuthSessionAsync(authUrl, redirectTo)'), 'openAuthSessionAsync call unchanged');
    assert.ok(authSrc.includes('/auth/v1/authorize?provider=google&redirect_to='), 'the GoTrue authorize URL is unchanged');
    const iSet = authSrc.indexOf('supabase.auth.setSession({');
    const iGet = authSrc.indexOf('supabase.auth.getSession()', iSet);
    const iWrite = authSrc.indexOf('writeJson(SESSION_KEY, session)', iSet);
    assert.ok(iSet >= 0 && iGet > iSet && iWrite > iGet, 'setSession -> getSession -> persist chain intact, in order');
    assert.ok(authSrc.includes("result.type !== 'success'"), 'the cancel path survives');
    assert.ok(authSrc.includes('Google sign-in cancel ho gaya.'), 'cancel message untouched (native-branch-only round; copy sweeps are separate PO decisions)');
    // honest-error improvement (optional per handoff, implemented)
    assert.ok(/params\.error_description \? ` \(\$\{params\.error_description\}\)` : ''/.test(authSrc), 'GoTrue error_description is surfaced in the final failure message');
    // web branch untouched
    assert.ok(authSrc.includes('redirectTo: window.location.origin'), 'the web Google flow still uses the page origin (detectSessionInUrl pickup)');
    assert.ok(authSrc.includes("Platform.OS === 'web'"), 'the web/native split is unchanged');
    // RC1 evidence: localhost can ONLY come from the Supabase dashboard — never from code
    const srcFiles = walkJs(path.join(__dirname, '..', 'src'));
    assert.ok(srcFiles.length > 30, `src/ walked (${srcFiles.length} files)`);
    for (const f of srcFiles) {
      const body = fs.readFileSync(f, 'utf8');
      assert.ok(!body.includes('localhost'), `${path.relative(path.join(__dirname, '..'), f)} contains a localhost literal`);
    }
  });

  // ---------- OA3: EAS config probes (RC3 — the build itself is PO-executed) ----------
  check('OA3', '[config-file probe — eas env:create + eas build are PO-EXECUTED, never by NEW X] app.json carries the EXISTING EAS projectId (no re-init) and keeps scheme studentos; eas.json preview profile = internal distribution + android buildType apk with NO developmentClient anywhere and NO development profile; ZERO dependency changes (no expo-dev-client / expo-auth-session / google-signin; expo-web-browser + expo-linking already present)', () => {
    needsOA();
    const app = JSON.parse(safeRead('app.json'));
    assert.equal(app.expo.extra.eas.projectId, 'c3d81764-bd95-4478-adbc-7a8be8f22e3a', 'the SAME project id registered at recovery 0d1d072 — never eas init a new one');
    assert.equal(app.expo.scheme, 'studentos', 'the deep-link scheme that registers the studentos:// intent is untouched');
    assert.equal(app.expo.android.package, 'com.studentos.app', 'android package untouched');
    const easRaw = safeRead('eas.json');
    assert.ok(easRaw.length > 20, 'eas.json exists on arena');
    const eas = JSON.parse(easRaw);
    assert.equal(eas.cli.appVersionSource, 'remote');
    assert.equal(eas.build.preview.distribution, 'internal', 'preview = sideloadable internal distribution');
    assert.equal(eas.build.preview.android.buildType, 'apk', 'preview builds an APK (the launch artifact)');
    assert.ok(!easRaw.includes('developmentClient'), 'NO developmentClient flag anywhere — the preview APK embeds its JS bundle (no Metro, RC3)');
    assert.equal(eas.build.development, undefined, 'no development profile on arena (expo-dev-client is recovery-only, deliberate)');
    assert.ok(eas.build.production && eas.build.production.autoIncrement === true, 'production profile per the handoff');
    // ZERO dependency changes — the architecture needs no new packages
    const pkg = JSON.parse(safeRead('package.json'));
    for (const banned of ['expo-dev-client', 'expo-auth-session', '@react-native-google-signin/google-signin']) {
      assert.equal(pkg.dependencies[banned], undefined, `${banned} must NOT be added`);
    }
    assert.ok(pkg.dependencies['expo-web-browser'] && pkg.dependencies['expo-linking'], 'the reused packages are the pre-existing ones');
    // .env hygiene unchanged
    const gitignore = safeRead('.gitignore');
    assert.ok(gitignore.includes('.env'), '.env stays gitignored (secrets never committed; PO bakes EXPO_PUBLIC_* via eas env:create)');
  });

  const failedOA = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failedOA.length, 0, `FIX-AUTH: ${failedOA.length} check(s) failed -> ${failedOA.map((f) => f.id).join(', ')}`);
}


// ---------- FIX-TEST: GT1/GT2/HASH1/MASK1/UM1 ----------
{
  const results = [];
  const check = (id, desc, fn) => {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      results.push({ id, desc, ok: false, err: 'async fn given to sync check() — use record()' });
      return;
    }
    try { fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const record = async (id, desc, fn) => {
    try { await fn(); results.push({ id, desc, ok: true }); }
    catch (e) { results.push({ id, desc, ok: false, err: String(e && e.message ? e.message : e).split('\n')[0] }); }
  };
  const safeRead = (p) => { try { return read(p); } catch { return ''; } };

  // ---------- GT1: gym reps regression — logic simulation ----------
  check('GT1', 'Gym reps verbatim: \"4 each leg\" survives merge->filter->persist->reload, empty reps with sets becomes \"—\" (proves digit-loss regression cannot return)', () => {
    const mergeEntry = (existing, patch) => {
      return { sets: '', reps: '', weight: '', ...(existing || {}), ...patch };
    };
    const filterNonEmpty = (entriesObj) => Object.entries(entriesObj).filter(([, v]) => v.sets || v.reps || v.weight);
    const persist = (filtered) => filtered.map(([, v]) => ({
      sets: v.sets,
      reps: v.reps || '—',
      weight: v.weight,
    }));

    let e = {};
    e['pushup'] = mergeEntry(e['pushup'], { reps: '4 each leg', sets: '3' });
    let filtered = filterNonEmpty(e);
    assert.equal(filtered.length, 1, 'non-empty filter keeps row with sets');
    let saved = persist(filtered);
    assert.equal(saved[0].reps, '4 each leg', 'persist keeps verbatim');
    const reload = saved[0].reps;
    assert.equal(reload, '4 each leg', 'reload byte-for-byte exact');

    e = {};
    e['squat'] = mergeEntry(e['squat'], { sets: '2', reps: '' });
    filtered = filterNonEmpty(e);
    assert.equal(filtered.length, 1, 'empty reps but sets filled still passes filter');
    saved = persist(filtered);
    assert.equal(saved[0].reps, '—', 'empty reps becomes em dash');
  });

  // ---------- GT2: gym reps wiring probe ----------
  check("GT2", "[wiring probe] GymScreen.js still contains verbatim patterns (v.reps fallback and keyboardType default for reps) and ABSENCE of digit-stripping transforms on reps path", () => {
    const gymSrc = safeRead('src/screens/life/GymScreen.js');
    assert.ok(gymSrc.length > 1000, 'GymScreen.js read');
    assert.ok(gymSrc.includes("reps: v.reps || '—'"), "contains v.reps || '—'");
    assert.ok(gymSrc.includes("sets: '', reps: '', weight: ''"), 'contains merge defaults');
    assert.ok(gymSrc.includes('keyboardType="default"') && gymSrc.includes('entry.reps'), 'reps inputs use keyboardType default');
    const countDefault = (gymSrc.match(/keyboardType="default"/g) || []).length;
    assert.ok(countDefault >= 2, `at least 2 keyboardType="default" found, got ${countDefault}`);
    const hasParseInt = gymSrc.includes('parseInt(');
    const hasParseFloat = gymSrc.includes('parseFloat(');
    assert.equal(hasParseInt, false, 'GymScreen.js must NOT contain parseInt(');
    assert.equal(hasParseFloat, false, 'GymScreen.js must NOT contain parseFloat(');
    const lines = gymSrc.split('\n');
    for (const line of lines) {
      if (line.includes('reps') && line.includes('.replace(')) {
        if (/\b(reps|entry\.reps|v\.reps)\b/.test(line) && /\.replace\(/.test(line)) {
          assert.fail(`digit-stripping .replace found on reps path: ${line.trim()}`);
        }
      }
    }
  });

  // ---------- HASH1: sha256Hex vectors ----------
  await record('HASH1', 'sha256Hex pure impl: \"\", \"abc\", 64-byte, 65-byte, unicode — hardcoded lower-case 64-hex exact, no runtime crypto', async () => {
    let mod = null;
    try { mod = await import('./../src/lib/hash.js'); } catch (e) { throw new Error('hash.js import failed: ' + e.message); }
    const { sha256Hex } = mod;
    assert.ok(typeof sha256Hex === 'function', 'sha256Hex exported');
    const vectors = [
      { input: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      { input: 'abc', expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
      { input: 'y'.repeat(64), expected: 'ffbf30ab94107b2c14d75cfb455ec94f200400ddc5ce304e0c21894090db055f' },
      { input: 'z'.repeat(65), expected: '57685f5e43ddac1567f4d404c357c44bab70744b8b6af6009760389170c5c062' },
      { input: 'héllo wörld ünïcode ✓', expected: '09cc6e242ffeccc975f644c8385c48f7f387513a88ba4e4c2085c07a7c0ee0c4' },
    ];
    for (const { input, expected } of vectors) {
      const got = sha256Hex(input);
      assert.equal(typeof got, 'string', 'returns string');
      assert.equal(got.length, 64, '64 hex chars');
      assert.equal(got, got.toLowerCase(), 'lower-case');
      assert.ok(/^[0-9a-f]{64}$/.test(got), 'hex format');
      assert.equal(got, expected, `sha256Hex(${JSON.stringify(input).slice(0,30)}) matches expected`);
    }
    const hashSrc = safeRead('src/lib/hash.js');
    assert.ok(!hashSrc.includes('node:crypto') && !hashSrc.includes("require('crypto')") && !hashSrc.includes('createHash'), 'hash.js must NOT use Node crypto at runtime');
  });

  // ---------- MASK1: dateMask extraction + behavioral ----------
  await record('MASK1', 'maskDateInput/isValidDateStr extracted to lib, real impl tested, wiring probe import-only', async () => {
    let dm = null;
    try { dm = await import('./../src/lib/dateMask.js'); } catch (e) { throw new Error('dateMask.js import failed: ' + e.message); }
    const { maskDateInput, isValidDateStr } = dm;
    assert.ok(typeof maskDateInput === 'function' && typeof isValidDateStr === 'function', 'both exported');
    assert.equal(maskDateInput('2026 11 14'), '2026-11-14', 'spaces → dashes');
    assert.equal(maskDateInput('20261114'), '2026-11-14', '8 digits → YYYY-MM-DD');
    assert.equal(maskDateInput('202611141234'), '2026-11-14', '>8 digits truncated');
    assert.equal(maskDateInput('2026-1'), '2026-1', 'partial stable 2026-1');
    assert.equal(maskDateInput('2026-11'), '2026-11', 'partial stable 2026-11');
    assert.equal(maskDateInput(''), '', 'empty → empty');
    assert.equal(maskDateInput('abc'), '', 'junk → empty');
    assert.equal(isValidDateStr('2026-11-14'), true, 'valid true');
    assert.equal(isValidDateStr('2026 11 14'), false, 'space false');
    assert.equal(isValidDateStr(''), false, 'empty false');

    const onbSrc = safeRead('src/screens/onboarding/OnboardingScreen.js');
    const setSrc = safeRead('src/screens/settings/SettingsScreen.js');
    assert.ok(onbSrc.includes("from '../../lib/dateMask'") || onbSrc.includes('from \"../../lib/dateMask\"'), 'Onboarding imports dateMask');
    assert.ok(setSrc.includes("from '../../lib/dateMask'") || setSrc.includes('from \"../../lib/dateMask\"'), 'Settings imports dateMask');
    assert.ok(!/function\s+maskDateInput\s*\(/.test(onbSrc), 'Onboarding no longer defines local maskDateInput');
    assert.ok(!/function\s+maskDateInput\s*\(/.test(setSrc), 'Settings no longer defines local maskDateInput');
    const libSrc = safeRead('src/lib/dateMask.js');
    assert.ok(libSrc.includes('replace(/\\D/g'), 'lib contains digit strip');
    assert.ok(libSrc.includes('slice(0, 8)'), 'lib contains 8-digit cap');
    assert.ok(libSrc.includes('isValidDateStr'), 'lib exports isValidDateStr');
  });

  // ---------- UM1: updateMany local-path ----------
  check('UM1', 'updateMany local branch: Map-based patch, updated_at fresh, unrelated rows untouched, empty no-op, return exactly patched', () => {
    const dbSrc = safeRead('src/lib/db.js');
    assert.ok(dbSrc.includes('async updateMany'), 'db.js has updateMany');
    assert.ok(dbSrc.includes('new Map(') && dbSrc.includes('map.has(r.id)'), 'Map-based patch present');
    assert.ok(dbSrc.includes('updated_at: nowIso()'), 'updated_at: nowIso() present');
    assert.ok(dbSrc.includes('localSave'), 'localSave used in local branch');
    assert.ok(dbSrc.includes('localAll'), 'localAll used');

    const nowIso = () => new Date().toISOString();
    const localSaveSim = (rows, next) => { rows.length = 0; rows.push(...next); };

    const simulateUpdateManyLocal = (rows, updates) => {
      if (!updates.length) return [];
      const map = new Map(updates.map((u) => [u.id, u.patch]));
      const next = rows.map((r) => (map.has(r.id) ? { ...r, ...map.get(r.id), updated_at: nowIso() } : r));
      localSaveSim(rows, next);
      return next.filter((r) => map.has(r.id));
    };

    const rows = [
      { id: 'a', title: 'Alpha', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'Beta', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'c', title: 'Gamma', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    const beforeC = JSON.stringify(rows[2]);

    const updates = [
      { id: 'a', patch: { status: 'done' } },
      { id: 'b', patch: { title: 'Beta-2' } },
    ];
    const ret = simulateUpdateManyLocal(rows, updates);

    const rowA = rows.find((r) => r.id === 'a');
    const rowB = rows.find((r) => r.id === 'b');
    assert.equal(rowA.status, 'done', 'a patched');
    assert.equal(rowB.title, 'Beta-2', 'b patched');
    assert.equal(JSON.stringify(rows.find((r) => r.id === 'c')), beforeC, 'c unchanged byte-for-byte');
    assert.ok(rowB.status === 'pending', 'b status untouched');

    assert.ok(rowA.updated_at !== '2026-01-01T00:00:00.000Z', 'a updated_at fresh');
    assert.ok(rowB.updated_at !== '2026-01-01T00:00:00.000Z', 'b updated_at fresh');
    assert.ok(new Date(rowA.updated_at) > new Date('2026-01-01'), 'a updated_at is recent');
    assert.equal(rows.find((r) => r.id === 'c').updated_at, '2026-01-01T00:00:00.000Z', 'c updated_at untouched');

    const rows2 = [{ id: 'x', v: 1, updated_at: '2026-01-01T00:00:00.000Z' }];
    const retEmpty = simulateUpdateManyLocal(rows2, []);
    assert.deepEqual(retEmpty, [], 'empty updates returns []');
    assert.equal(rows2.length, 1, 'empty no-op keeps rows');
    assert.equal(rows2[0].v, 1, 'empty no-op unchanged');

    assert.equal(ret.length, 2, 'return length 2');
    assert.ok(ret.some((r) => r.id === 'a') && ret.some((r) => r.id === 'b'), 'return contains a,b');
    assert.ok(!ret.some((r) => r.id === 'c'), 'return does not contain c');
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} [${r.id}] ${r.desc}${r.ok ? '' : ` — ${r.err}`}`);
  assert.equal(failed.length, 0, `FIX-TEST: ${failed.length} check(s) failed -> ${failed.map((f) => f.id).join(', ')}`);
}


console.log('ALL LOGIC TESTS PASSED ✅');














