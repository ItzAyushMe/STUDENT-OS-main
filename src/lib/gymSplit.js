// NEW X R8: gym split helper — weekly split from workout logs
// FIX-C: full split system with pure rotation logic
import { mondayOf, dateStr, dayjs } from './utils';
import { GYM_SPLITS, EXERCISE_LIBRARY } from '../config/constants.js';

const MUSCLE_MAP = [
  { keywords: ['bench', 'chest press', 'push-up', 'push up', 'shoulder press', 'overhead press', 'dips', 'tricep', 'chest'], cat: 'push' },
  { keywords: ['pull-up', 'pull up', 'lat pulldown', 'row', 'bicep curl', 'deadlift', 'chin'], cat: 'pull' },
  { keywords: ['squat', 'leg press', 'lunge', 'leg', 'calf', 'quad', 'hamstring'], cat: 'legs' },
  { keywords: ['plank', 'crunch', 'leg raise', 'ab', 'core', 'mountain climber'], cat: 'core' },
  { keywords: ['treadmill', 'run', 'walk', 'cardio', 'cycle'], cat: 'cardio' },
];

export function classifyExercise(name = '') {
  const lower = String(name).toLowerCase();
  for (const entry of MUSCLE_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.cat;
  }
  return 'other';
}

export function getWeeklyGymSplit(logs = []) {
  const mon = mondayOf(new Date().toISOString().slice(0,10));
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => dateStr(mon.add(i, 'day'))));
  const weekLogs = logs.filter(l => weekDates.has(l.date));
  const breakdown = { push: 0, pull: 0, legs: 0, core: 0, cardio: 0, other: 0 };
  for (const log of weekLogs) {
    for (const ex of log.exercises || []) {
      const cat = classifyExercise(ex.name);
      breakdown[cat] = (breakdown[cat] || 0) + 1;
    }
  }
  const total = Object.values(breakdown).reduce((a,b)=>a+b,0);
  const activeCats = Object.entries(breakdown).filter(([,v])=>v>0).map(([k])=>k);
  let splitLabel = 'Full Body';
  if (activeCats.includes('push') && activeCats.includes('pull') && activeCats.includes('legs')) splitLabel = 'PPL (Push/Pull/Legs)';
  else if (activeCats.includes('push') && activeCats.includes('pull')) splitLabel = 'Upper (Push/Pull)';
  else if (breakdown.legs > 0 && (breakdown.push>0 || breakdown.pull>0)) splitLabel = 'Upper/Lower';
  else if (breakdown.push > 0 && breakdown.legs===0 && breakdown.pull===0) splitLabel = 'Push focus';
  else if (breakdown.pull > 0 && breakdown.legs===0 && breakdown.push===0) splitLabel = 'Pull focus';
  else if (breakdown.legs > 0 && breakdown.push===0 && breakdown.pull===0) splitLabel = 'Legs focus';

  return { breakdown, total, splitLabel, weekLogsCount: weekLogs.length, activeCats };
}

// For user-configured split stored in users.gym_split (jsonb)
export function normalizeGymSplit(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { type: raw }; }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

export function gymSplitBadgeText(profileSplit, weekly) {
  if (profileSplit?.type || profileSplit?.split) {
    return profileSplit.type || profileSplit.split;
  }
  return weekly?.splitLabel || 'Full Body';
}

// ============================================================
// FIX-C: Gym Split System — pure rotation logic
// ============================================================
export function getSplitDefinition(type) {
  if (!type) return null;
  return GYM_SPLITS[type] || null;
}

// Mon-first weekday: 0=Mon, 6=Sun
export function weekdayMonFirst(dStr) {
  const d = dayjs(dStr);
  return (d.day() + 6) % 7;
}

export function mondayOfWeek(dStr) {
  const d = dayjs(dStr);
  const diff = weekdayMonFirst(dStr);
  return dStr ? dayjs(dStr).subtract(diff, 'day').format('YYYY-MM-DD') : null;
}

// Pure function todayWorkout(split, dateStr) → { label, groups, isRest, dayIndex }
export function todayWorkout(split, targetDateStr) {
  if (!split || !targetDateStr) return { isRest: false, label: 'Full Body', groups: [], dayIndex: 0 };
  const restDays = Array.isArray(split.restDays) ? split.restDays : [];
  const wday = weekdayMonFirst(targetDateStr);
  if (restDays.includes(wday)) {
    return { isRest: true, label: 'Rest & recover 💤', groups: [], dayIndex: -1 };
  }
  let dayTypes = [];
  if (split.type === 'custom' && Array.isArray(split.customDays) && split.customDays.length) {
    dayTypes = split.customDays.map((d, i) => ({
      label: d.name || `Day ${i+1}`,
      groups: Array.isArray(d.groups) ? d.groups : [],
    }));
  } else {
    const def = getSplitDefinition(split.type);
    dayTypes = def?.dayTypes || [{ label: 'Full Body', groups: [] }];
  }
  if (!dayTypes.length) return { isRest: false, label: 'Full Body', groups: [], dayIndex: 0 };

  // Count non-rest days from Monday to target inclusive
  let nonRestCount = 0;
  for (let i = 0; i <= wday; i++) {
    if (!restDays.includes(i)) nonRestCount++;
  }
  // Monday is always day-type 1, fresh every week
  const dayIndex = (nonRestCount - 1) % dayTypes.length;
  const day = dayTypes[dayIndex];
  return { isRest: false, label: day.label, groups: day.groups || [], dayIndex };
}

export function getExercisesForGroups(groups = [], mode = 'gym') {
  if (!groups.length) return [];
  const wantGym = mode === 'gym';
  const wantHome = mode === 'home';
  const filtered = EXERCISE_LIBRARY.filter((ex) => {
    if (!groups.includes(ex.group)) return false;
    if (wantGym && !ex.gym) return false;
    if (wantHome && !ex.home) return false;
    return true;
  });
  // Sort by group order given
  const groupOrder = {};
  groups.forEach((g,i)=> groupOrder[g]=i);
  filtered.sort((a,b)=> (groupOrder[a.group]||0)-(groupOrder[b.group]||0));
  return filtered;
}

export function normalizeGymSplitV2(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { type: raw, restDays: [] }; }
  }
  if (typeof obj !== 'object') return null;
  return {
    type: obj.type || 'ppl',
    restDays: Array.isArray(obj.restDays) ? obj.restDays : [],
    customDays: Array.isArray(obj.customDays) ? obj.customDays : undefined,
    mode: obj.mode || 'split',
  };
}
