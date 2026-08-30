// ============================================================
// StudentOS — XP / level / tier / streak engine (pure functions)
// All XP rules live in config/constants.js XP_RULES; every feature
// awards XP through GameContext.awardXP so points stay consistent.
// ============================================================
import {
  XP_RULES,
  LEVEL_XP_STEP,
  TIERS,
  STREAK_FREEZE_MAX,
  STREAK_FREEZE_EARN_EVERY,
} from '../config/constants';
import { todayStr, daysBetween } from './utils';

export function xpForCode(code, overrideAmount) {
  const rule = XP_RULES[code] || { amount: 0, category: 'misc', label: code };
  return {
    amount: overrideAmount != null ? overrideAmount : rule.amount || 0,
    perMinute: rule.perMinute || 0,
    category: rule.category,
    label: rule.label || code,
  };
}

export function levelForXp(totalXp) {
  return Math.floor((totalXp || 0) / LEVEL_XP_STEP) + 1;
}

export function levelProgress(totalXp) {
  const total = totalXp || 0;
  const into = total % LEVEL_XP_STEP;
  return { into, step: LEVEL_XP_STEP, pct: LEVEL_XP_STEP ? into / LEVEL_XP_STEP : 0 };
}

export function tierForXp(totalXp) {
  const t = totalXp || 0;
  return TIERS.find((x) => t >= x.min && t < x.max) || TIERS[TIERS.length - 1];
}

export function nextTier(totalXp) {
  const cur = tierForXp(totalXp);
  const idx = TIERS.findIndex((x) => x.name === cur.name);
  return TIERS[idx + 1] || null;
}

// Streak engine — runs on ANY activity. Freeze saves a single missed day.
export function streakOnActivity(profile, today = todayStr()) {
  let current = profile?.current_streak || 0;
  let longest = profile?.longest_streak || 0;
  let freezes = profile?.streak_freezes || 0;
  const last = profile?.last_active_date;

  let changed = false;
  let freezeUsed = false;
  let freezeEarned = false;

  if (!last) {
    current = 1;
    changed = true;
  } else if (last === today) {
    // already counted today
  } else {
    const gap = daysBetween(last, today);
    if (gap === 1) {
      current += 1;
      changed = true;
    } else if (gap === 2 && freezes > 0) {
      // exactly one missed day + freeze available -> streak saved 🧊
      freezes -= 1;
      freezeUsed = true;
      current += 1;
      changed = true;
    } else {
      current = 1;
      changed = true;
    }
  }

  if (current > longest) longest = current;

  if (changed && current > 0 && current % STREAK_FREEZE_EARN_EVERY === 0 && freezes < STREAK_FREEZE_MAX) {
    freezes += 1;
    freezeEarned = true;
  }

  return { current, longest, freezes, changed, freezeUsed, freezeEarned, activeToday: last === today };
}

// ---- orchestration used by GameContext ----
// deps: { profile, updateProfile, insert(row) }
export async function awardXPToProfile(deps, code, opts = {}) {
  const { profile, updateProfile, insert } = deps;
  if (!profile?.id) return null;

  const rule = xpForCode(code, opts.amount);
  let gained = Number(rule.amount) || 0;
  if (!gained && rule.perMinute && opts.minutes) {
    gained = Math.round(rule.perMinute * opts.minutes);
  }
  if (!gained) return null;

  await insert({
    user_id: profile.id,
    code,
    category: opts.category || rule.category,
    amount: gained,
    label: opts.label || rule.label,
    meta: opts.meta || null,
    created_at: nowIsoStr(),
  });

  const total = (profile.total_xp || 0) + gained;
  const level = levelForXp(total);
  const tier = tierForXp(total).name;
  const streak = streakOnActivity(profile);

  await updateProfile({
    total_xp: total,
    level,
    tier,
    current_streak: streak.current,
    longest_streak: streak.longest,
    streak_freezes: streak.freezes,
    last_active_date: todayStr(),
  });

  return {
    code,
    gained,
    total,
    level,
    tier,
    leveledUp: level > (profile.level || 1),
    streak,
    freezeUsed: streak.freezeUsed,
    freezeEarned: streak.freezeEarned,
  };
}

function nowIsoStr() {
  return new Date().toISOString();
}
