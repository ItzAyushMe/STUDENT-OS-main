// ============================================================
// StudentOS — guild data helpers
// Cloud mode: real friends/leaderboard/xp_events from Supabase.
// Local mode: a lively set of demo rivals so the Guild feels
// alive offline (clearly labelled "demo rivals").
// ============================================================
import { db } from './db';
import { seededShuffle, hashString, weekStartStr, todayStr, dayjs } from './utils';
import { TIERS } from '../config/constants';

export const DEMO_RIVALS = [
  { id: 'demo-arjun', username: 'arjun_grinds', display_name: 'Arjun', class_level: 'Class 12', emoji: '🦁' },
  { id: 'demo-priya', username: 'priya.neet', display_name: 'Priya', class_level: 'Class 12', emoji: '🦉' },
  { id: 'demo-kabir', username: 'kabir_jeeprep', display_name: 'Kabir', class_level: 'Class 11', emoji: '🐉' },
  { id: 'demo-ananya', username: 'ananya.codes', display_name: 'Ananya', class_level: 'Class 10', emoji: '🦊' },
  { id: 'demo-zoya', username: 'zoya_boards', display_name: 'Zoya', class_level: 'Class 10', emoji: '🐧' },
];

export function demoRivalWeeklyXp(dateStr) {
  // Deterministic per week so the board is stable within a week
  const seed = `week-${weekStartStr(dateStr)}`;
  const base = seededShuffle([320, 480, 650, 540, 260, 410, 700, 380], seed);
  return DEMO_RIVALS.map((r, i) => {
    const total = base[i % base.length];
    const study = Math.round(total * 0.55);
    const habit = Math.round(total * 0.2);
    const gym = Math.round(total * 0.12);
    const social = total - study - habit - gym;
    return { ...r, total_xp: total, study_xp: study, habit_xp: habit, gym_xp: gym, social_xp: social };
  });
}

const FEED_TEMPLATES = [
  (f) => `${f.display_name} completed a 50-min focus session — Cheer! 🎯`,
  (f) => `${f.display_name} conquered a chapter (+100 XP) 📚`,
  (f) => `${f.display_name} hit a ${2 + (hashString(f.id) % 20)}-day streak 🔥`,
  (f) => `${f.display_name} scored 90%+ on a quiz 🧠`,
  (f) => `${f.display_name} logged a workout 💪`,
  (f) => `${f.display_name} finished the Daily Arena ⚔️`,
];

export function demoFeed(dateStr) {
  const day = dateStr || todayStr();
  return seededShuffle(DEMO_RIVALS, `feed-${day}`)
    .slice(0, 4)
    .map((f, i) => ({
      id: `demo-feed-${day}-${i}`,
      friend: f,
      text: FEED_TEMPLATES[hashString(`${f.id}-${day}`) % FEED_TEMPLATES.length](f),
      ts: `${day}T${String(9 + i * 3).padStart(2, '0')}:30:00`,
      demo: true,
    }));
}

// ---- weekly leaderboard sync (works in both modes) ----
export async function syncMyWeeklyLeaderboard(profile) {
  if (!profile?.id) return null;
  const weekStart = weekStartStr(todayStr());
  const weekEnd = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
  try {
    const events = await db.list('xp_events', {
      eq: { user_id: profile.id },
      // M-5 (audit): widen the window a day back so Monday 00:00–05:30 IST
      // events (UTC Sunday) still land inside the local week.
      gte: { created_at: `${dayjs(weekStart).subtract(1, 'day').format('YYYY-MM-DD')}T00:00:00` },
    });
    const sum = (cat) => events.filter((e) => e.category === cat).reduce((a, e) => a + (e.amount || 0), 0);
    const total = events.reduce((a, e) => a + (e.amount || 0), 0);
    const existing = await db.list('leaderboard', { eq: { user_id: profile.id, week_start: weekStart } });
    const row = {
      user_id: profile.id,
      week_start: weekStart,
      week_end: weekEnd,
      total_xp: total,
      study_xp: sum('study'),
      habit_xp: sum('habit'),
      gym_xp: sum('gym'),
      social_xp: sum('social'),
      rank: existing[0]?.rank || null,
    };
    if (existing[0]) {
      await db.update('leaderboard', existing[0].id, row);
    } else {
      await db.insert('leaderboard', row);
    }
    return row;
  } catch (e) {
    return null;
  }
}

export function tierFor(xp) {
  return TIERS.find((t) => xp >= t.min && xp < t.max) || TIERS[TIERS.length - 1];
}

// Arena: deterministic "global" ranking for demo/local mode
export function demoArenaBoard(dateStr, myEntry) {
  const day = dateStr || todayStr();
  const rivals = seededShuffle(DEMO_RIVALS, `arena-${day}`).map((f, i) => {
    const correct = 2 + (hashString(`${f.id}-${day}`) % 4);
    const time = 40 + (hashString(`t-${f.id}-${day}`) % 60);
    return { id: f.id, name: f.display_name, emoji: f.emoji, correct, time, demo: true };
  });
  const all = [...rivals, ...(myEntry ? [{ ...myEntry, me: true }] : [])];
  all.sort((a, b) => b.correct - a.correct || a.time - b.time);
  return all.map((row, i) => ({ ...row, rank: i + 1 }));
}
