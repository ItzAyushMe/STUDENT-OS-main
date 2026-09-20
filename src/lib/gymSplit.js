
// NEW X R8: gym split helper — weekly split from workout logs
import { mondayOf, dateStr, dayjs } from './utils';

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
