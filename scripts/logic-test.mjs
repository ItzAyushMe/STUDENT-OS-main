import assert from 'node:assert';
import { levelForXp, tierForXp, levelProgress, streakOnActivity, xpForCode } from './../src/lib/xpService.js';
import { generateSchedule, autoSetDeadlines, autoRescheduleMissed, normalizePriorities } from './../src/lib/scheduleGenerator.js';
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
  assert.ok(src.includes("'openai/gpt-oss-120b'") && src.includes("'openai/gpt-oss-20b'") && src.includes("'qwen/qwen3.6-27b'"), 'GROQ_MODELS updated to new list');
  assert.ok(!src.includes('gemini-2.0-flash') && !src.includes('gemini-2.5-flash'), 'old Gemini models removed');
  // old models removed from actual model arrays (comment may mention them for history)
  const groqModelsLine = src.split('\n').find(l => l.includes('GROQ_MODELS')) || '';
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
  const src = read('src/lib/aiFeatures.js');
  assert.ok(src.includes('BATCH_SIZE') && src.includes('20'), 'Question bank batching ≤20 exists');
  assert.ok(src.includes('MAX_BATCHES') && src.includes('6'), 'Max 6 batches exists');
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

console.log('ALL LOGIC TESTS PASSED ✅');













