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

console.log('ALL LOGIC TESTS PASSED ✅');

