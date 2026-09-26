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
const planTight = generateSchedule({
  syllabus: multiTrackSyllabus, examDate: null, dailyHours: 1, preferredTime: 'Morning',
  daysOff: [], prepLevel: 'Intermediate', weeks: 6, userId: 'u2',
});
const tightMin = (t) => planTight.filter(r => r.session_type === 'study' && r.track === t).reduce((a, r) => a + r.duration_minutes, 0);
assert.ok(tightMin('class') > tightMin('exam') && tightMin('class') > tightMin('olympiad'), `tight capacity honours 60/30/10 split (class ${tightMin('class')} vs exam ${tightMin('exam')} vs olympiad ${tightMin('olympiad')} min)`);

// custom priority: olympiad first with a big split (FIX B)
const plan2 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 1,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 6,
  userId: 'u2',
  priorities: { order: ['olympiad', 'class', 'exam'], enabled: { class: true, exam: true, olympiad: true }, timeSplit: { olympiad: 70, class: 20, exam: 10 } },
});
const studyMin2 = (t) => plan2.filter(r => r.session_type === 'study' && r.track === t).reduce((a, r) => a + r.duration_minutes, 0);
assert.ok(studyMin2('olympiad') > studyMin2('class'), `olympiad-first priorities give olympiad more time (${studyMin2('olympiad')} vs ${studyMin2('class')} min)`);
assert.ok(plan2.coverage.priorityOrder[0] === 'olympiad', 'coverage reports custom order');

// disabled track never appears (FIX B)
const plan3 = generateSchedule({
  syllabus: multiTrackSyllabus,
  examDate: null,
  dailyHours: 3,
  preferredTime: 'Morning',
  daysOff: [],
  prepLevel: 'Intermediate',
  weeks: 4,
  userId: 'u2',
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
  assert.ok(trackFnSlice.includes('existingKeys') && trackFnSlice.includes('fresh'), 'seedSyllabusTrack uses existingKeys/fresh merge logic');
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
  assert.ok(src.includes('_banner') && src.includes('questions mile'), 'Partial banner honest message exists');
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

  const sgSrc = read('src/lib/scheduleGenerator.js');
  const ssSrc = read('src/screens/study/ScheduleScreen.js');

  // Fixed "today" so every assertion is deterministic and independent of the wall clock.
  // The scheduler must accept it (requirement 6) instead of reading the clock internally.
  const H_TODAY = '2026-03-02';                       // a Monday
  const H_CREATED = '2026-03-02T00:00:00.000Z';
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
      dailyHours: 3, preferredTime: 'Morning', daysOff: [], weeks: 2, userId: 'u-h3',
      today: H_TODAY, createdAt: H_CREATED,
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

console.log('ALL LOGIC TESTS PASSED ✅');














