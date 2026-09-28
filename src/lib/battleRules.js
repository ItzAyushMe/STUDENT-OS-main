// ============================================================
// StudentOS — FIX-H: REALTIME BATTLE RULES (pure core)
//
// Everything that decides an outcome lives here and nowhere else: no supabase,
// no AsyncStorage, no react-native, no device clock. Each function takes the
// timestamps / rows it needs as arguments, so the whole handshake is testable in
// Node (scripts/logic-test.mjs) and identical on both phones.
//
// The effectful half (channels, presence, row writes) is src/lib/battleRealtime.js,
// which delegates every decision back to this module.
//
// PO decisions ratified for this round:
//   (a) local mode  -> battles are ONLINE ONLY, no demo rival, honest message
//   (b) XP          -> +25 BATTLE_COMPLETE, +60 BATTLE_WIN, once per day (F7 cap)
//   (c) exact tie   -> DRAW, no win XP for either player
//   (d) timings     -> challenge TTL 120 s, presence grace 30 s
//
// SECURITY SHAPE (why three tables): a shared `scores jsonb` on the battle row
// would let either player overwrite the opponent's score — RLS is row-level and
// cannot restrict a field. Per-player `battle_results` rows with
// `with check (auth.uid() = user_id)` make "your own score only" enforceable.
// ============================================================
// Explicit .js so this module is importable by BOTH plain Node (tests, no loader)
// and Metro. Every decision below is pure — no device clock, no I/O.
import { XP_RULES } from '../config/constants.js';

// ---------- ratified constants ----------
export const CHALLENGE_TTL_MS = 120_000;        // (d) 120 s to accept
export const ABANDON_GRACE_MS = 30_000;         // (d) 30 s of lost presence voids a battle
export const BATTLE_QUESTION_COUNT = 5;
export const PER_QUESTION_SECONDS = 20;         // unchanged from the existing battle UI
export const CHALLENGE_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'cancelled'];
export const BATTLE_STATUSES = ['active', 'complete', 'abandoned'];
export const XP_KEY_BATTLE = 'battle';          // the F7 daily-cap key — unchanged

export const XP_BATTLE_COMPLETE = XP_RULES?.BATTLE_COMPLETE?.amount ?? 25; // 25
export const XP_BATTLE_WIN = XP_RULES?.BATTLE_WIN?.amount ?? 60;           // 60

// ---------- time maths: SERVER timestamps only ----------
// The project has known device-clock skew, so every comparison here takes an
// explicit `nowIso` captured from a server-written column (created_at) or from
// the caller's injected clock — never from a device-local date string.
const asMs = (v) => {
  if (v == null) return NaN;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
};

/** expires_at for a challenge created at `nowIso` (default TTL 120 s). */
export function expiryFrom(nowIso, ttlMs = CHALLENGE_TTL_MS) {
  const t = asMs(nowIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + Math.max(0, Number(ttlMs) || 0)).toISOString();
}

/** A challenge is expired when it is still pending and its deadline has passed. */
export function isChallengeExpired(challenge, nowIso) {
  if (!challenge) return false;
  if (challenge.status !== 'pending') return false; // accepted/declined/expired are terminal
  const end = asMs(challenge.expires_at);
  const now = asMs(nowIso);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return false; // no deadline -> never auto-expire
  return now >= end;
}

/** Milliseconds left on a pending challenge (0 once due, negative never returned). */
export function msUntilExpiry(challenge, nowIso) {
  const end = asMs(challenge && challenge.expires_at);
  const now = asMs(nowIso);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  return Math.max(0, end - now);
}

/** True when a player's last seen timestamp is older than the grace window. */
export function graceExceeded(lastSeenIso, nowIso, graceMs = ABANDON_GRACE_MS) {
  const seen = asMs(lastSeenIso);
  const now = asMs(nowIso);
  if (!Number.isFinite(seen) || !Number.isFinite(now)) return false; // unknown -> do not void
  return now - seen > Math.max(0, Number(graceMs) || 0);
}

// ---------- presence ----------
/**
 * Supabase presence state is `{ [key]: [meta, ...] }`. A battle starts ONLY when
 * both participants are tracked on the channel — one-sided presence never starts.
 * @param {object} presenceState  channel.presenceState()
 * @param {string} meId
 * @param {string} oppId
 */
export function bothPresent(presenceState, meId, oppId) {
  if (!presenceState || typeof presenceState !== 'object' || !meId || !oppId) return false;
  const ids = new Set();
  for (const metas of Object.values(presenceState)) {
    for (const m of Array.isArray(metas) ? metas : []) {
      if (m && m.user_id) ids.add(String(m.user_id));
    }
  }
  return ids.has(String(meId)) && ids.has(String(oppId));
}

/** The other participant of a challenge/battle row. */
export function opponentIdOf(row, meId) {
  if (!row) return null;
  const a = row.from_user || row.challenger;
  const b = row.to_user || row.invitee;
  if (String(a) === String(meId)) return b || null;
  if (String(b) === String(meId)) return a || null;
  return null;
}

/** Latest `ts` seen for one user in a presence state (for the grace window). */
export function lastSeenOf(presenceState, userId) {
  if (!presenceState || !userId) return null;
  let best = null;
  for (const metas of Object.values(presenceState)) {
    for (const m of Array.isArray(metas) ? metas : []) {
      if (!m || String(m.user_id) !== String(userId)) continue;
      if (!best || asMs(m.ts) > asMs(best)) best = m.ts;
    }
  }
  return best;
}

// ---------- questions ----------
/**
 * The 5-question set both players answer: same questions, same order. Only the
 * accepting client generates it; it is then stored on the challenge + battle rows
 * so a reload restores the identical set instead of re-rolling.
 */
export function normalizeQuestions(list, count = BATTLE_QUESTION_COUNT) {
  const src = Array.isArray(list) ? list : [];
  const out = [];
  for (const q of src) {
    if (!q || typeof q !== 'object') continue;
    const text = String(q.q || q.question || '').trim();
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
    const answer = Number(q.answer);
    if (!text || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    out.push({
      q: text,
      options,
      answer,
      subject: q.subject ? String(q.subject) : null,
      topic: q.topic ? String(q.topic) : null,
    });
    if (out.length >= Math.max(1, Number(count) || BATTLE_QUESTION_COUNT)) break;
  }
  return out;
}

/** A set is playable when it is full-length and both sides hold the same order. */
export function isPlayableSet(list, count = BATTLE_QUESTION_COUNT) {
  return Array.isArray(list) && list.length === (Number(count) || BATTLE_QUESTION_COUNT);
}

/** Identical set AND order — the handshake guarantee both phones answer the same quiz. */
export function sameQuestionSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((q, i) => {
    const o = b[i];
    return !!o && q.q === o.q && q.answer === Number(o.answer)
      && Array.isArray(q.options) && Array.isArray(o.options)
      && q.options.length === o.options.length
      && q.options.every((opt, j) => opt === o.options[j]);
  });
}

// ---------- outcome ----------
/**
 * [H8][H9][H10] The single outcome rule, from MY point of view:
 *   higher score wins; equal score -> lower total time wins; equal both -> DRAW.
 * A draw pays no win XP (PO decision c).
 */
export function resolveOutcome({ myScore, oppScore, myTimeMs, oppTimeMs }) {
  const ms = Number(myScore) || 0;
  const os = Number(oppScore) || 0;
  const mt = Number(myTimeMs) || 0;
  const ot = Number(oppTimeMs) || 0;
  if (ms > os) return { result: 'win', reason: 'higher-score', byScore: true };
  if (ms < os) return { result: 'loss', reason: 'higher-score', byScore: true };
  if (mt < ot) return { result: 'win', reason: 'lower-time', byScore: false };
  if (mt > ot) return { result: 'loss', reason: 'lower-time', byScore: false };
  return { result: 'draw', reason: 'exact-equal', byScore: false };
}

/** Pick a result row per participant (a retry overwrites its own row, never duplicates). */
export function resultsByUser(results) {
  const map = {};
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || !r.user_id) continue;
    map[String(r.user_id)] = r;
  }
  return map;
}

/** Both participants have submitted -> the battle can be finalized. */
export function canFinalize(battle, results) {
  if (!battle) return false;
  const by = resultsByUser(results);
  return !!by[String(battle.challenger)] && !!by[String(battle.invitee)];
}

/** The winner's user id, or null for a draw. Pure: same input -> same winner on both phones. */
export function winnerIdOf(battle, results) {
  if (!battle) return null;
  const by = resultsByUser(results);
  const a = by[String(battle.challenger)];
  const b = by[String(battle.invitee)];
  if (!a || !b) return null; // not finalizable yet
  const out = resolveOutcome({
    myScore: a.score, oppScore: b.score, myTimeMs: a.time_ms, oppTimeMs: b.time_ms,
  });
  if (out.result === 'draw') return null;
  return out.result === 'win' ? battle.challenger : battle.invitee;
}

/** The exact patch that closes a battle (status + winner), or null if not ready. */
export function finalizePatch(battle, results, completedAtIso) {
  if (!battle || battle.status !== 'active') return null;
  if (!canFinalize(battle, results)) return null;
  return {
    status: 'complete',
    winner: winnerIdOf(battle, results), // null on an exact tie (PO decision c)
    completed_at: completedAtIso || null,
  };
}

/** My view of a finished (or finishing) battle — drives the result screen. */
export function outcomeForMe(battle, results, meId) {
  if (!battle) return null;
  const by = resultsByUser(results);
  const mine = by[String(meId)] || null;
  const oppId = opponentIdOf(battle, meId);
  const opp = oppId ? by[String(oppId)] || null : null;
  if (!mine || !opp) {
    return {
      state: battle.status === 'abandoned' ? 'void' : 'waiting',
      myScore: mine ? Number(mine.score) || 0 : null,
      oppScore: opp ? Number(opp.score) || 0 : null,
      myTimeMs: mine ? Number(mine.time_ms) || 0 : null,
      oppTimeMs: opp ? Number(opp.time_ms) || 0 : null,
      result: null,
      winner: null,
      reason: null,
    };
  }
  const out = resolveOutcome({
    myScore: mine.score, oppScore: opp.score, myTimeMs: mine.time_ms, oppTimeMs: opp.time_ms,
  });
  return {
    state: battle.status === 'abandoned' ? 'void' : battle.status === 'complete' ? 'final' : 'provisional',
    myScore: Number(mine.score) || 0,
    oppScore: Number(opp.score) || 0,
    myTimeMs: Number(mine.time_ms) || 0,
    oppTimeMs: Number(opp.time_ms) || 0,
    result: battle.status === 'abandoned' ? null : out.result,
    reason: out.reason,
    winner: battle.status === 'abandoned' ? null : (out.result === 'draw' ? null : (out.result === 'win' ? String(meId) : String(oppId))),
    iWon: battle.status !== 'abandoned' && out.result === 'win',
  };
}

/** An abandoned battle is void: no result counts, no XP, no history row. [H12] */
export function isVoid(battle) {
  return !!battle && battle.status === 'abandoned';
}

// ---------- XP (PO decision b) ----------
/**
 * The award decision for ONE completed battle, before any side effect:
 *   * a void/abandoned or non-complete battle pays nothing, ever
 *   * the per-battle ledger wins over everything (a remounted result screen cannot
 *     re-award): reason 'ledger'
 *   * the F7 daily cap (xpOnce key 'battle') pays 0 but the battle still counts:
 *     reason 'daily-cap'
 *   * otherwise 25 for completing, +60 more only on a WIN (a draw pays no bonus)
 */
export function battleXpDecision({ battle, result, alreadyEarnedToday, ledgerEntry }) {
  if (!battle || battle.status !== 'complete') {
    return { award: false, complete: 0, win: 0, total: 0, reason: battle && battle.status === 'abandoned' ? 'void' : 'not-complete' };
  }
  if (ledgerEntry) return { award: false, complete: 0, win: 0, total: 0, reason: 'ledger' };
  if (alreadyEarnedToday) {
    return { award: false, complete: 0, win: 0, total: 0, reason: 'daily-cap', recordHistory: true };
  }
  const win = result === 'win' ? XP_BATTLE_WIN : 0;
  return {
    award: true,
    complete: XP_BATTLE_COMPLETE,
    win,
    total: XP_BATTLE_COMPLETE + win,
    reason: win ? 'complete+win' : 'complete',
    recordHistory: true,
  };
}

/**
 * Runs the award with EVERY effect injected — the screen passes the real
 * awardXP / xpOnce / ledger / quiz_results writers, the tests pass fakes.
 * Sequence is the accepted F7 order: guard -> XP -> save. An awardXP failure never
 * blocks the result display, and the ledger is marked ONLY on a confirmed award.
 */
export async function applyBattleXp(input) {
  const {
    battle, results, meId, completedAt, opponentName,
    hasEarnedToday, markEarnedToday, awardXP, ledgerGet, ledgerSet, insertQuizResult,
  } = input || {};
  const out = { awardedXp: 0, reason: null, ledgerMarked: false, historySaved: false, capped: false, void: false, msg: '' };
  if (!battle || !meId) { out.reason = 'missing-input'; return out; }

  const my = outcomeForMe(battle, results, meId);
  if (isVoid(battle)) {
    out.void = true;
    out.reason = 'void';
    out.msg = 'Opponent left — battle void. Koi XP nahi, koi history row nahi.';
    return out;
  }

  let ledgerEntry = null;
  try { ledgerEntry = typeof ledgerGet === 'function' ? await ledgerGet(battle.id) : null; } catch { ledgerEntry = null; }

  let alreadyEarnedToday = false;
  try { alreadyEarnedToday = !!(typeof hasEarnedToday === 'function' && (await hasEarnedToday(meId, XP_KEY_BATTLE))); } catch { alreadyEarnedToday = false; }

  const decision = battleXpDecision({ battle, result: my && my.result, alreadyEarnedToday, ledgerEntry });
  out.reason = decision.reason;
  out.capped = decision.reason === 'daily-cap';
  if (decision.reason === 'ledger') {
    out.awardedXp = Number((ledgerEntry && ledgerEntry.xp) || 0);
    out.ledgerMarked = true;
    out.msg = 'XP already recorded for this battle — result screen reload ne dobara award nahi kiya.';
    return out;
  }
  if (decision.reason === 'daily-cap') out.msg = 'Aaj ka battle XP le liya ⚔️ — 0 XP, game still counts.';

  if (decision.award) {
    try {
      const res = typeof awardXP === 'function'
        ? await awardXP('BATTLE_COMPLETE', { amount: decision.complete, label: 'Battle fought' })
        : null;
      out.awardedXp += Number(res && res.gained) || 0;
      if (res) {
        try { if (typeof markEarnedToday === 'function') await markEarnedToday(meId, XP_KEY_BATTLE); } catch {}
        if (decision.win) {
          const winRes = await awardXP('BATTLE_WIN');
          out.awardedXp += Number(winRes && winRes.gained) || 0;
        }
      }
      // the ledger is written ONLY on a confirmed award, inside the finalize path
      if (res && typeof ledgerSet === 'function') {
        try {
          await ledgerSet(battle.id, {
            battleId: battle.id,
            xp: out.awardedXp,
            result: my && my.result,
            score: my ? my.myScore : null,
            opponentScore: my ? my.oppScore : null,
            at: completedAt || new Date().toISOString(),
          });
          out.ledgerMarked = true;
        } catch {}
      }
    } catch {
      out.msg = 'XP award fail hua — result phir bhi sahi hai (F7 pattern: XP failure never blocks the screen).';
    }
  }

  // history: COMPLETE battles only, and only once the outcome is real. The row is
  // built by the CALLER (screen) from this context so the persisted `xp_earned` is
  // provably the same value the screen displays (FIX-G6 guardrail); quizResultRow()
  // below is the pure reference shape used by the tests.
  if (decision.recordHistory !== false && typeof insertQuizResult === 'function') {
    try {
      await insertQuizResult({
        battle,
        results,
        meId,
        myScore: my ? my.myScore : null,
        myTimeMs: my ? my.myTimeMs : null,
        result: my ? my.result : null,
        xpEarned: out.awardedXp,
        createdAt: completedAt,
        opponentName: opponentName || null,
      });
      out.historySaved = true;
    } catch {
      out.msg = out.msg || 'Result save fail — XP secured ✅';
    }
  }
  return out;
}

/**
 * The `quiz_results` row for a completed battle (mode 'battle' keeps the existing
 * global board policy working: `using (mode in ('arena','battle'))`). Pure
 * reference shape — BattleScreen builds the same row inline so the persisted
 * xp_earned is literally the awarded value (FIX-G6 guardrail).
 */
export function quizResultRow({ battle, results, meId, xpEarned, createdAt, opponentName }) {
  const my = outcomeForMe(battle, results, meId) || {};
  const total = BATTLE_QUESTION_COUNT;
  const score = Number(my.myScore) || 0;
  return {
    user_id: meId,
    subject: null,
    topic: opponentName || null,
    mode: 'battle',
    total_questions: total,
    correct_answers: score,
    accuracy: Math.round((score / total) * 100),
    time_taken: Math.round((Number(my.myTimeMs) || 0) / 1000), // seconds, as the existing row does
    xp_earned: Number(xpEarned) || 0,
    weak_topics: [],
    created_at: createdAt || null,
  };
}

/** AsyncStorage key of the per-battle XP ledger (second layer above the daily cap). */
export function battleLedgerKey(battleId) {
  return `sos.battleXP.${battleId}`;
}

/** Honest one-line explanation of a challenge state, for both screens. */
export function challengeStateLabel(challenge, nowIso) {
  if (!challenge) return '';
  if (challenge.status === 'pending') {
    return isChallengeExpired(challenge, nowIso)
      ? 'Expired — dobara challenge bhejo'
      : `Waiting… ${Math.ceil(msUntilExpiry(challenge, nowIso) / 1000)}s left`;
  }
  if (challenge.status === 'accepted') return 'Accepted — battle shuru hone wala hai';
  if (challenge.status === 'declined') return 'Declined';
  if (challenge.status === 'cancelled') return 'Cancelled';
  return 'Expired';
}
