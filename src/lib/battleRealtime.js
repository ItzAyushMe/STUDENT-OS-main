// ============================================================
// StudentOS — FIX-H: REALTIME BATTLES (effectful half)
//
// Supabase Realtime + the three new tables. EVERY decision (expiry, presence,
// winner, XP) is delegated to src/lib/battleRules.js, which is pure and unit
// tested; this file only moves bytes.
//
// PO decision (a): battles are ONLINE ONLY. In local mode there is no opponent,
// no channel and no demo rival — `battlesAvailable()` is false and the screens say
// so plainly instead of faking a fight.
//
// WHY NOT db.*: `db.insert`/`db.upsert` inject `id` and a DEVICE `created_at`.
// The battle tables must have neither — `battle_results` has a composite PK
// (battle_id, user_id) and no id column at all, and every deadline here is derived
// from the SERVER's `created_at` so two phones cannot disagree because one clock
// is skewed. So these three tables are written through supabase-js directly; reads
// still go through db.list (it injects nothing).
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { db, isRemote } from './db';
import { nowIso } from './utils';
import * as R from './battleRules';

export * from './battleRules'; // screens import rules + transport from one place

export const BATTLES_ONLINE_ONLY = true; // PO decision (a)
export const LOCAL_MODE_MESSAGE =
  'Dost ke saath battle = online only. Local mode mein koi opponent nahi hota — ' +
  'Supabase connect karo (Settings) ya cloud build chalao. Yahan koi fake battle nahi dikhega.';

/** A battle needs a configured Supabase client AND an authenticated cloud session. */
export function battlesAvailable() {
  return !!(supabase && isSupabaseConfigured && isRemote());
}

/** Typed failure so screens can tell "offline" from a real error. */
export class BattleUnavailableError extends Error {
  constructor(message = LOCAL_MODE_MESSAGE) {
    super(message);
    this.name = 'BattleUnavailableError';
    this.offline = true;
  }
}

const requireCloud = () => {
  if (!battlesAvailable()) throw new BattleUnavailableError();
  return supabase;
};

// ============================================================
// PRESENCE — channel `guild_presence`
// "Available" means currently tracked; Supabase drops stale senders itself.
// REF-COUNTED: Guild AND Battle both track on focus (handoff §5). Navigation
// runs the new screen's focus before the old screen's blur cleanup, so a plain
// track/untrack would drop presence mid-handshake. untrack only really leaves
// when the LAST screen released it.
// ============================================================
let presenceChannel = null;
let presenceUserId = null;
let presenceRefs = 0;

export function trackPresence({ userId, name }) {
  if (!battlesAvailable() || !userId) return null;
  if (presenceChannel && presenceUserId === userId) { presenceRefs += 1; return presenceChannel; }
  hardUntrackPresence(); // different user or stale channel
  presenceUserId = userId;
  presenceRefs = 1;
  const ch = supabase.channel('guild_presence', { config: { presence: { key: String(userId) } } });
  ch.on('presence', { event: 'sync' }, () => { /* state is read on demand */ });
  ch.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    try { ch.track({ user_id: String(userId), name: name || 'Player', ts: nowIso() }); } catch {}
  });
  presenceChannel = ch;
  return ch;
}

function hardUntrackPresence() {
  const ch = presenceChannel;
  presenceChannel = null;
  presenceUserId = null;
  presenceRefs = 0;
  if (!ch) return;
  try { ch.untrack(); } catch {}
  try { ch.unsubscribe(); } catch {}
}

/** `{ [key]: [meta,...] }` — feed straight into battleRules.bothPresent(). */
export function guildPresenceState() {
  try { return (presenceChannel && presenceChannel.presenceState()) || {}; } catch { return {}; }
}

export function onlineUserIds() {
  const ids = new Set();
  for (const metas of Object.values(guildPresenceState())) {
    for (const m of Array.isArray(metas) ? metas : []) if (m && m.user_id) ids.add(String(m.user_id));
  }
  return ids;
}

export function isUserOnline(userId) {
  return !!userId && onlineUserIds().has(String(userId));
}

export function untrackPresence() {
  if (presenceRefs > 0) presenceRefs -= 1;
  if (presenceRefs > 0) return; // another screen (Guild/Battle) still needs presence
  hardUntrackPresence();
}

// ============================================================
// CHALLENGES — battle_challenges
// ============================================================
/**
 * A: presence check first. Offline target => nothing is created at all. [H1]
 * No name is stored: battle_challenges has no name columns — screens resolve
 * names from the friends/users tables.
 */
export async function createChallenge({ fromUser, toUser, ttlMs = R.CHALLENGE_TTL_MS, now = nowIso() }) {
  const sb = requireCloud();
  if (!fromUser || !toUser) throw new Error('createChallenge: fromUser and toUser are required');
  if (String(fromUser) === String(toUser)) throw new Error('Apne aap ko challenge nahi kar sakte 😄');
  if (!isUserOnline(toUser)) {
    // [H1] zero rows: the check happens BEFORE any insert
    return { ok: false, reason: 'opponent-offline', message: 'User not available. Try again later.' };
  }
  // a pending challenge to the same person is reused, never stacked
  const existing = await listChallenges({ userId: fromUser, direction: 'outgoing' });
  const live = existing.find((c) => c.status === 'pending' && String(c.to_user) === String(toUser) && !R.isChallengeExpired(c, now));
  if (live) return { ok: true, reason: 'already-pending', challenge: live, reused: true };

  const { data, error } = await sb
    .from('battle_challenges')
    .insert({ from_user: fromUser, to_user: toUser, status: 'pending', questions: null, expires_at: R.expiryFrom(now, ttlMs) })
    .select()
    .single();
  if (error) throw new Error(`challenge create failed: ${error.message}`);

  // Re-anchor the deadline on the SERVER's created_at, so both phones count the
  // same 120 s from the same instant regardless of either device clock.
  let row = data;
  if (data && data.created_at) {
    const serverExpiry = R.expiryFrom(data.created_at, ttlMs);
    if (serverExpiry && serverExpiry !== data.expires_at) {
      const { data: updated, error: e2 } = await sb
        .from('battle_challenges')
        .update({ expires_at: serverExpiry, updated_at: nowIso() })
        .eq('id', data.id)
        .select()
        .single();
      if (!e2 && updated) row = updated;
    }
  }
  return { ok: true, reason: 'created', challenge: row };
}

/** Read challenges. direction 'incoming' | 'outgoing' | 'both'. */
export async function listChallenges({ userId, direction = 'both', limit = 30 } = {}) {
  requireCloud();
  if (!userId) return [];
  const out = [];
  try {
    if (direction === 'incoming' || direction === 'both') {
      const rows = await db.list('battle_challenges', { eq: { to_user: userId }, order: { col: 'created_at', asc: false }, limit });
      out.push(...rows);
    }
    if (direction === 'outgoing' || direction === 'both') {
      const rows = await db.list('battle_challenges', { eq: { from_user: userId }, order: { col: 'created_at', asc: false }, limit });
      out.push(...rows);
    }
  } catch {
    /* RLS/offline -> empty list, never a crash */
  }
  const seen = new Set();
  return out.filter((r) => (r && r.id && !seen.has(r.id) ? seen.add(r.id) : false));
}

/** Pending, unexpired invites for me — the Guild badge count. */
export async function pendingInvites(userId, now = nowIso()) {
  const rows = await listChallenges({ userId, direction: 'incoming' });
  return rows.filter((c) => c.status === 'pending' && !R.isChallengeExpired(c, now));
}

export async function getChallenge(id) {
  requireCloud();
  const rows = await db.list('battle_challenges', { eq: { id } });
  return rows[0] || null;
}

/**
 * One battle per challenge (unique challenge_id). A retry after a crashed accept
 * returns the existing row instead of duplicating; the 23505 race is re-read.
 */
async function ensureBattleRow(challenge, set) {
  const sb = requireCloud();
  let battle = await getBattleByChallenge(challenge.id);
  if (battle) return battle;
  const { data: b, error: be } = await sb
    .from('battles')
    .insert({
      challenge_id: challenge.id,
      challenger: challenge.from_user,
      invitee: challenge.to_user,
      status: 'active',
      questions: set,
    })
    .select()
    .single();
  if (be) {
    if (String(be.message || '').includes('duplicate') || String(be.code) === '23505') battle = await getBattleByChallenge(challenge.id);
    if (!battle) throw new Error(`battle create failed: ${be.message}`);
    return battle;
  }
  return b;
}

/**
 * B accepts: the ACCEPTING client generates the 5-question set, writes it to the
 * challenge row (so both phones hold the identical set and order) and creates the
 * `battles` row. [H4] Crash-safe: if a previous attempt flipped the challenge to
 * 'accepted' but died before the battle insert, re-calling with the same challenge
 * finishes the job (the questions travel on the challenge row).
 */
export async function acceptChallenge({ challenge, questions, meId, now = nowIso() }) {
  const sb = requireCloud();
  if (!challenge || !challenge.id) throw new Error('acceptChallenge: a challenge is required');
  // only the addressed player may accept (RLS lets both participants update the
  // row, so the client pins the honest side of the handshake too)
  if (meId && String(challenge.to_user) !== String(meId)) {
    return { ok: false, reason: 'not-for-me', message: 'Ye challenge tumhare liye nahi hai.' };
  }
  if (challenge.status !== 'pending') {
    if (challenge.status === 'accepted') {
      // recovery: accepted earlier but the battles row is missing (insert failed)
      const stored = R.normalizeQuestions(challenge.questions, R.BATTLE_QUESTION_COUNT);
      let battle = await getBattleByChallenge(challenge.id);
      if (!battle && R.isPlayableSet(stored) && String(challenge.to_user) === String(meId)) {
        battle = await ensureBattleRow(challenge, stored);
      }
      if (battle) {
        return { ok: true, reason: 'already-accepted', challenge, battle, questions: R.normalizeQuestions(battle.questions, R.BATTLE_QUESTION_COUNT) };
      }
    }
    return { ok: false, reason: `already-${challenge.status}`, message: `Challenge already ${challenge.status}.` };
  }
  if (R.isChallengeExpired(challenge, now)) {
    await expireChallenge(challenge.id); // idempotent
    return { ok: false, reason: 'expired', message: 'Challenge expire ho gaya — dobara bhejo.' };
  }
  const set = R.normalizeQuestions(questions, R.BATTLE_QUESTION_COUNT);
  if (!R.isPlayableSet(set)) {
    return { ok: false, reason: 'no-questions', message: 'Questions ready nahi hue — dobara try karo.' };
  }

  const { data: updated, error } = await sb
    .from('battle_challenges')
    .update({ status: 'accepted', questions: set, updated_at: now })
    .eq('id', challenge.id)
    .eq('status', 'pending') // loses the race cleanly if the other side already moved it
    .select()
    .single();
  if (error) return { ok: false, reason: 'update-failed', message: error.message };
  if (!updated) return { ok: false, reason: 'lost-race', message: 'Challenge already handled.' };

  const battle = await ensureBattleRow(updated, set);
  return { ok: true, challenge: updated, battle, questions: set };
}

export async function declineChallenge(id) {
  const sb = requireCloud();
  const { error } = await sb.from('battle_challenges').update({ status: 'declined', updated_at: nowIso() }).eq('id', id).eq('status', 'pending');
  if (error) throw new Error(`decline failed: ${error.message}`);
  return { ok: true };
}

export async function cancelChallenge(id) {
  const sb = requireCloud();
  const { error } = await sb.from('battle_challenges').update({ status: 'cancelled', updated_at: nowIso() }).eq('id', id).eq('status', 'pending');
  if (error) throw new Error(`cancel failed: ${error.message}`);
  return { ok: true };
}

/** [H3] Either client may flip an overdue pending challenge; the guard makes it idempotent. */
export async function expireChallenge(id) {
  const sb = requireCloud();
  const { data, error } = await sb
    .from('battle_challenges')
    .update({ status: 'expired', updated_at: nowIso() })
    .eq('id', id)
    .eq('status', 'pending')
    .select();
  if (error) throw new Error(`expire failed: ${error.message}`);
  return { ok: true, changed: Array.isArray(data) ? data.length : 0 };
}

/** Sweep my own overdue pending challenges (called on mount + on the polling tick). */
export async function expireDueChallenges(userId, now = nowIso()) {
  const rows = await listChallenges({ userId, direction: 'both' });
  let changed = 0;
  for (const c of rows) {
    if (!R.isChallengeExpired(c, now)) continue;
    try { const res = await expireChallenge(c.id); changed += res.changed || 0; } catch {}
  }
  return changed;
}

/** Realtime invites: postgres_changes on rows addressed to me + a polling fallback. */
export function subscribeInvites(userId, onChange) {
  if (!battlesAvailable() || !userId) return null;
  const ch = supabase
    .channel(`bc-invites-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'battle_challenges', filter: `to_user=eq.${userId}` },
      (payload) => { try { onChange(payload); } catch {} }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'battle_challenges', filter: `from_user=eq.${userId}` },
      (payload) => { try { onChange(payload); } catch {} }
    )
    .subscribe();
  return ch;
}

// ============================================================
// BATTLES — battles + battle_results
// ============================================================
export async function getBattleByChallenge(challengeId) {
  requireCloud();
  const rows = await db.list('battles', { eq: { challenge_id: challengeId } });
  return rows[0] || null;
}

export async function getBattle(battleId) {
  requireCloud();
  const rows = await db.list('battles', { eq: { id: battleId } });
  return rows[0] || null;
}

/** Resume-on-reload: my newest still-active battle, if any. */
export async function fetchMyActiveBattle(userId) {
  requireCloud();
  if (!userId) return null;
  const asChallenger = await db.list('battles', { eq: { challenger: userId, status: 'active' }, order: { col: 'created_at', asc: false }, limit: 5 });
  const asInvitee = await db.list('battles', { eq: { invitee: userId, status: 'active' }, order: { col: 'created_at', asc: false }, limit: 5 });
  const all = [...asChallenger, ...asInvitee].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return all[0] || null;
}

/**
 * Channel `battle:{challenge_id}` — presence on BOTH sides is the start signal
 * [H5]; the broadcast event is cosmetic ("opponent answered Qn") and is never used
 * for scoring. Scoring truth is each client's own battle_results row.
 */
export function joinBattleChannel(challengeId, me, handlers = {}) {
  if (!battlesAvailable() || !challengeId) return null;
  const ch = supabase.channel(`battle:${challengeId}`, { config: { presence: { key: String(me.userId) } } });
  ch.on('presence', { event: 'sync' }, () => {
    try { handlers.onPresence && handlers.onPresence(ch.presenceState()); } catch {}
  });
  ch.on('presence', { event: 'join' }, () => {
    try { handlers.onPresence && handlers.onPresence(ch.presenceState()); } catch {}
  });
  ch.on('presence', { event: 'leave' }, () => {
    try { handlers.onPresence && handlers.onPresence(ch.presenceState()); } catch {}
  });
  ch.on('broadcast', { event: 'progress' }, (msg) => {
    try { handlers.onBroadcast && handlers.onBroadcast(msg); } catch {}
  });
  ch.subscribe((status) => {
    try { handlers.onStatus && handlers.onStatus(status); } catch {}
    if (status !== 'SUBSCRIBED') return;
    try { ch.track({ user_id: String(me.userId), name: me.name || 'Player', ts: nowIso() }); } catch {}
  });
  return ch;
}

export function broadcastProgress(channel, payload) {
  try { channel && channel.send({ type: 'broadcast', event: 'progress', payload }); } catch {}
}

export function leaveBattleChannel(channel) {
  if (!channel) return;
  try { channel.untrack(); } catch {}
  try { channel.unsubscribe(); } catch {}
}

/**
 * [H6] My own score, upserted on the composite PK so a retry overwrites MY row and
 * can never duplicate it — and can never touch the opponent's row (RLS
 * `br_insert_own` / `br_update_own` enforce the same thing server-side).
 */
export async function saveBattleResult({ battleId, userId, score, timeMs, completedAt = nowIso() }) {
  if (!battlesAvailable()) throw new BattleUnavailableError(); // local mode never hosts a battle
  const row = {
    battle_id: battleId,
    user_id: userId,
    score: Math.max(0, Math.min(R.BATTLE_QUESTION_COUNT, Number(score) || 0)),
    time_ms: Math.max(0, Math.round(Number(timeMs) || 0)),
    completed_at: completedAt,
  };
  const { data, error } = await supabase
    .from('battle_results')
    .upsert(row, { onConflict: 'battle_id,user_id' }) // composite PK — retry overwrites MY row only
    .select()
    .single();
  if (error) throw new Error(`result save failed: ${error.message}`);
  return data;
}

export async function listBattleResults(battleId) {
  requireCloud();
  return db.list('battle_results', { eq: { battle_id: battleId } });
}

/**
 * [H7] Either client may finalize; both compute the SAME winner from the same two
 * rows (battleRules.winnerIdOf is pure), and the `.eq('status','active')` guard
 * makes the second writer a no-op instead of a double finalize.
 */
export async function finalizeBattle({ battle, results, completedAt = nowIso() }) {
  const sb = requireCloud();
  const patch = R.finalizePatch(battle, results, completedAt);
  if (!patch) return { ok: false, reason: 'not-ready' };
  const { data, error } = await sb
    .from('battles')
    .update({ status: patch.status, winner: patch.winner, completed_at: patch.completed_at })
    .eq('id', battle.id)
    .eq('status', 'active')
    .select();
  if (error) throw new Error(`finalize failed: ${error.message}`);
  const changed = Array.isArray(data) ? data.length : 0;
  return { ok: true, changed, winner: patch.winner, alreadyFinal: changed === 0 };
}

/** [H12] Leave / presence drop beyond the grace window: void, no XP, no history. */
export async function abandonBattle(battleId) {
  const sb = requireCloud();
  const { data, error } = await sb
    .from('battles')
    .update({ status: 'abandoned' })
    .eq('id', battleId)
    .eq('status', 'active')
    .select();
  if (error) throw new Error(`abandon failed: ${error.message}`);
  return { ok: true, changed: Array.isArray(data) ? data.length : 0 };
}

/** Deltas on my battle row (opponent finalized / abandoned). */
export function subscribeBattle(battleId, onChange) {
  if (!battlesAvailable() || !battleId) return null;
  return supabase
    .channel(`battle-row-${battleId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` }, (p) => {
      try { onChange(p); } catch {}
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_results', filter: `battle_id=eq.${battleId}` }, (p) => {
      try { onChange(p); } catch {}
    })
    .subscribe();
}

// ============================================================
// PER-BATTLE XP LEDGER (second layer above the F7 daily cap)
// Written ONLY inside the finalize transition; a remounted result screen reads it
// and shows "XP already recorded" instead of awarding again. [H11]
// ============================================================
export async function ledgerGet(battleId) {
  if (!battleId) return null;
  try {
    const raw = await AsyncStorage.getItem(R.battleLedgerKey(battleId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function ledgerSet(battleId, payload) {
  if (!battleId) return false;
  try {
    await AsyncStorage.setItem(R.battleLedgerKey(battleId), JSON.stringify(payload || {}));
    return true;
  } catch {
    return false;
  }
}
