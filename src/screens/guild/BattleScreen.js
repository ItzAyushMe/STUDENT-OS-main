// BATTLES — FIX-H: REAL realtime battles against a real friend.
//
// The old screen simulated the rival: hashing the battle id together with the
// opponent id produced a fake score, nothing was sent or stored, and a "rematch"
// was a new fake battle. That is gone — no hashed rival, no demo rival, not once.
// Everything here is a real handshake over Supabase Realtime:
//
//   presence check -> battle_challenges(pending, 120 s TTL) -> the ACCEPTER writes
//   the shared 5-question set -> battles(active) -> both clients tracked on
//   channel battle:{challenge_id} -> play starts only when BOTH are present ->
//   each side grades locally and upserts its OWN battle_results row (composite PK)
//   -> when both rows exist either client finalizes -> one identical outcome on
//   both phones -> the F7 XP path (+25 complete, +60 on a win, once/day) plus the
//   per-battle ledger so a remounted result screen can never pay twice.
//
// Every decision (expiry, both-present, winner, tie, XP) is made by the pure rules
// in src/lib/battleRules.js; this file only renders and moves bytes.
// PO decision (a): local mode has NO opponent and NO demo rival — the screen says
// so honestly instead of faking a fight.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useTheme } from '../../context/ThemeContext';
import { GAMER, fonts, radius } from '../../config/theme';
import { db } from '../../lib/db';
import { hasEarnedToday, markEarnedToday } from '../../lib/xpOnce';
import { QUIZ_BANK } from '../../lib/quizBank';
import { aiChallengeQuestions } from '../../lib/aiFeatures';
import { aiStatus, isOnline } from '../../lib/aiService';
import { PixelText } from '../../components/gamer/PixelText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Confetti } from '../../components/gamer/Confetti';
import { nowIso, fmtClock, seededShuffle } from '../../lib/utils';
import { activeSyllabusRows } from '../../config/constants'; // FIX-S S5
import {
  battlesAvailable, LOCAL_MODE_MESSAGE,
  trackPresence, untrackPresence, guildPresenceState,
  createChallenge, listChallenges, acceptChallenge, declineChallenge, cancelChallenge,
  expireDueChallenges, subscribeInvites, unsubscribeInvites, getBattleByChallenge, fetchMyActiveBattle,
  joinBattleChannel, leaveBattleChannel, broadcastProgress,
  saveBattleResult, listBattleResults, finalizeBattle, abandonBattle, subscribeBattle,
  ledgerGet, ledgerSet, applyBattleXp, quizResultRow,
  isChallengeExpired, msUntilExpiry, bothPresent, lastSeenOf, graceExceeded, opponentIdOf,
  normalizeQuestions, isPlayableSet, canFinalize, outcomeForMe,
  BATTLE_QUESTION_COUNT, PER_QUESTION_SECONDS, ABANDON_GRACE_MS,
} from '../../lib/battleRealtime';

const POLL_INVITES_MS = 10_000;  // fallback when the socket is down
const POLL_RESULT_MS = 2_500;    // waiting for the opponent's score row
const RESULT_WAIT_LIMIT_MS = 120_000;

export function BattleScreen({ navigation }) {
  useTheme('gamer');
  const { profile } = useAuth();
  const { awardXP } = useGame();
  const insets = useSafeAreaInsets();

  const [offline, setOffline] = useState(false);           // PO decision (a)
  const [phase, setPhase] = useState('pick');              // pick | waiting | play | result
  const [friends, setFriends] = useState([]);
  const [invites, setInvites] = useState([]);              // pending challenges TO me
  const [outgoing, setOutgoing] = useState(null);          // my live pending challenge
  const [challenge, setChallenge] = useState(null);
  const [battle, setBattle] = useState(null);
  const [opponent, setOpponent] = useState(null);          // { id, name } — name from the friends list
  const [questions, setQuestions] = useState([]);
  const [qSource, setQSource] = useState('bank');
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(PER_QUESTION_SECONDS);
  const [totalTimeMs, setTotalTimeMs] = useState(0);       // ms — battle_results.time_ms
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [voidMsg, setVoidMsg] = useState('');
  const [waitingScore, setWaitingScore] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [xpAwarded, setXpAwarded] = useState(0);
  const [xpNote, setXpNote] = useState('');
  const [oppProgress, setOppProgress] = useState(0);       // cosmetic broadcast only
  const [confetti, setConfetti] = useState(0);
  const [saveMsg, setSaveMsg] = useState('');
  const [, setTick] = useState(0);                          // countdown re-render

  // ---------- refs ----------
  // Async callbacks (polls, subscriptions, channel events) always call through
  // refs so they run the LATEST closure — no stale state, and the focus effect
  // can keep a stable dependency list ([me, myName]) instead of re-running (and
  // dropping channels) on every phase change.
  const channelRef = useRef(null);
  const joinChallengeIdRef = useRef(null);
  const rowSubRef = useRef(null);
  const inviteSubRef = useRef(null);
  const pollRef = useRef(null);
  const resultPollRef = useRef(null);
  const resultGuardRef = useRef(null);
  const watchdogRef = useRef(null);
  const oppLastSeenRef = useRef(null);
  const finishingRef = useRef(false);
  const battleRef = useRef(null);
  battleRef.current = battle;
  const phaseRef = useRef('pick');
  phaseRef.current = phase;
  const friendsRef = useRef([]);
  friendsRef.current = friends;
  const loadFriendsRef = useRef(null);
  const loadChallengesRef = useRef(null);
  const adoptBattleRef = useRef(null);
  const resumeActiveRef = useRef(null);
  const joinChannelRef = useRef(null);
  const showFinalRef = useRef(null);
  const showFinalDoneRef = useRef(null); // battle id whose outcome was already applied on this mount

  const me = profile?.id || null;
  const myName = profile?.display_name || profile?.username || 'You';

  // battle_challenges has NO name columns — names come from the accepted-friends
  // list (loaded on focus); fallbacks stay honest ('Friend'/'Opponent').
  const nameOf = (id) => {
    if (!id) return null;
    const f = friendsRef.current.find((x) => String(x.id) === String(id));
    return f ? f.name : null;
  };

  const dropChannel = () => {
    leaveBattleChannel(channelRef.current);
    channelRef.current = null;
    joinChallengeIdRef.current = null;
  };

  // ---------- data loads ----------
  const loadFriends = async () => {
    if (!me || !battlesAvailable()) { setFriends([]); return; }
    try {
      const fr = await db.list('friends', { eq: { user_id: me, status: 'accepted' } });
      // NO demo rivals: a battle needs a real, present opponent (PO decision a).
      // "online" = currently tracked on guild_presence (membership, not the ts).
      const online = guildPresenceState();
      setFriends(fr.map((f) => ({
        id: f.friend_id,
        name: f.friend_name || 'Player',
        emoji: '🎮',
        online: lastSeenOf(online, f.friend_id) != null,
      })));
    } catch {
      setFriends([]);
    }
  };
  loadFriendsRef.current = loadFriends;

  const loadChallenges = async () => {
    if (!me || !battlesAvailable()) return;
    const now = nowIso();
    try {
      const rows = await listChallenges({ userId: me, direction: 'both' });
      setInvites(rows.filter((c) => String(c.to_user) === String(me) && c.status === 'pending' && !isChallengeExpired(c, now)));
      const mine = rows.filter((c) => String(c.from_user) === String(me) && c.status === 'pending' && !isChallengeExpired(c, now));
      setOutgoing(mine[0] || null);
      // a challenge that was accepted while we were away -> pick the battle back up
      const accepted = rows.find((c) => c.status === 'accepted' && (String(c.to_user) === String(me) || String(c.from_user) === String(me)));
      if (accepted && !battleRef.current && (phaseRef.current === 'pick' || phaseRef.current === 'waiting')) {
        const b = await getBattleByChallenge(accepted.id);
        if (b) {
          adoptBattleRef.current(accepted, b);
        } else if (String(accepted.to_user) === String(me)) {
          // crash recovery: a previous accept flipped the challenge but died before
          // the battles insert — acceptChallenge finishes the job from the stored set
          try {
            const retry = await acceptChallenge({ challenge: accepted, questions: accepted.questions, meId: me });
            if (retry.ok && retry.battle) adoptBattleRef.current(accepted, retry.battle);
          } catch { /* next poll */ }
        }
      }
    } catch { /* RLS/offline -> keep whatever we have */ }
  };
  loadChallengesRef.current = loadChallenges;

  // ---------- adopt / resume an in-flight battle (questions come from the row) ----------
  const adoptBattle = (chal, btl) => {
    if (!btl) return;
    const current = battleRef.current;
    if (current && current.id === btl.id) {
      // already adopted — react to transitions ONLY, never reset live progress
      setBattle(btl);
      if (chal) setChallenge(chal);
      if (btl.status === 'complete' && phaseRef.current !== 'result') {
        void showFinalRef.current(btl);
      } else if (btl.status === 'abandoned' && phaseRef.current !== 'result') {
        setVoidMsg('Opponent left — battle void. Koi XP nahi, koi history nahi.');
        setPhase('result');
      }
      return;
    }
    const set = normalizeQuestions(btl.questions, BATTLE_QUESTION_COUNT);
    const oppId = opponentIdOf(btl, me);
    setChallenge(chal || null);
    setBattle(btl);
    setOpponent({ id: oppId, name: nameOf(oppId) || 'Opponent' });
    setOppProgress(0);
    setSaveMsg('');
    if (btl.status === 'active' && isPlayableSet(set)) {
      setQuestions(set);
      setQIndex(0);
      setSelected(null);
      setCorrect(0);
      setTimeLeft(PER_QUESTION_SECONDS);
      setTotalTimeMs(0);
      setXpAwarded(0);
      setXpNote('');
      setOutcome(null);
      setVoidMsg('');
      setPhase('waiting'); // waits for BOTH sides on the channel before playing
      joinChannelRef.current(chal?.id || btl.challenge_id, btl);
    } else if (btl.status === 'active') {
      setNotice('Battle questions load nahi hue — dobara try karo ya battle chhod do.');
    } else if (btl.status === 'abandoned') {
      setVoidMsg('Opponent left — battle void. Koi XP nahi, koi history nahi.');
      setPhase('result');
    } else if (btl.status === 'complete') {
      void showFinalRef.current(btl);
    }
  };
  adoptBattleRef.current = adoptBattle;

  const resumeActive = async () => {
    if (!me || !battlesAvailable()) return;
    try {
      const b = await fetchMyActiveBattle(me);
      if (b) {
        const chal = b.challenge_id
          ? (await listChallenges({ userId: me, direction: 'both' })).find((c) => c.id === b.challenge_id) || null
          : null;
        adoptBattleRef.current(chal, b);
      }
    } catch { /* nothing to resume */ }
  };
  resumeActiveRef.current = resumeActive;

  // ---------- battle channel ----------
  const joinChannel = (challengeId, btl) => {
    if (!challengeId || !battlesAvailable()) return;
    if (channelRef.current && joinChallengeIdRef.current === challengeId) return; // already in this room
    dropChannel();
    joinChallengeIdRef.current = challengeId;
    oppLastSeenRef.current = nowIso();
    channelRef.current = joinBattleChannel(challengeId, { userId: me, name: myName }, {
      onPresence: (state) => {
        const oppId = opponentIdOf(btl || battleRef.current, me);
        // liveness = membership in the presence state (the tracked `ts` is the join
        // time and never advances — the watchdog measures the gap on THIS device)
        if (oppId && lastSeenOf(state, oppId) != null) oppLastSeenRef.current = nowIso();
        // [H5] auto-start ONLY when both are tracked — one side never starts, and a
        // late sync can never drag a finished ('result') screen back into 'play'
        if (bothPresent(state, me, oppId)) setPhase((p) => (p === 'waiting' ? 'play' : p));
      },
      onBroadcast: (msg) => {
        const n = Number(msg?.payload?.q) || 0;
        if (n > 0) setOppProgress(n); // cosmetic only — never used for scoring
      },
      onStatus: (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setNotice('Realtime connect nahi ho paya — polling se chal rahe hain.');
        }
      },
    });
  };
  joinChannelRef.current = joinChannel;

  // ---------- focus: presence, subscriptions, polling, resume ----------
  useFocusEffect(useCallback(() => {
    if (!me) return;
    if (!battlesAvailable()) {
      setOffline(true);   // PO decision (a): honest "online only" screen, zero crashes
      setFriends([]);
      return;
    }
    setOffline(false);
    trackPresence({ userId: me, name: myName });
    (async () => {
      await loadFriendsRef.current();
      try { await expireDueChallenges(me, nowIso()); } catch {}
      await loadChallengesRef.current();
      await resumeActiveRef.current();
    })();

    inviteSubRef.current = subscribeInvites(me, () => {
      loadChallengesRef.current();
      loadFriendsRef.current();
    });
    pollRef.current = setInterval(async () => {
      try { await expireDueChallenges(me, nowIso()); } catch {}
      await loadChallengesRef.current();
      await loadFriendsRef.current();
      setTick((t) => t + 1);
    }, POLL_INVITES_MS);

    return () => {
      // leaving the screen: untrack presence (refcounted with GuildScreen) and
      // drop every channel/interval this screen owns
      // FIX-BATTLE: idempotent unsubscribe + removeChannel
      untrackPresence();
      try { unsubscribeInvites(me); } catch {}
      inviteSubRef.current = null;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      dropChannel();
      try { rowSubRef.current?.unsubscribe(); } catch {}
      rowSubRef.current = null;
      if (resultPollRef.current) { clearInterval(resultPollRef.current); resultPollRef.current = null; }
      if (resultGuardRef.current) { clearInterval(resultGuardRef.current); resultGuardRef.current = null; }
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    };
  }, [me, myName]));

  // countdown re-render while a 120 s TTL is running
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'pick') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // per-question timer (unchanged behaviour; total is kept in ms for battle_results)
  useEffect(() => {
    if (phase !== 'play' || selected != null) return;
    if (timeLeft <= 0) { setSelected(-1); return; }
    const t = setTimeout(() => {
      setTimeLeft((s) => s - 1);
      setTotalTimeMs((ms) => ms + 1000);
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, selected]);

  // presence watchdog [H12]: opponent not tracked anywhere for longer than the
  // 30 s grace window -> the battle is void. Runs while a battle is active
  // (play AND the post-accept waiting room), not just mid-question.
  useEffect(() => {
    const battleActive = !!battle && battle.status === 'active' && (phase === 'play' || phase === 'waiting');
    if (!battleActive) {
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
      return;
    }
    watchdogRef.current = setInterval(async () => {
      const btl = battleRef.current;
      if (!btl || btl.status !== 'active') return;
      if (finishingRef.current) return; // my score is in — finalizing, not abandoning
      const oppId = opponentIdOf(btl, me);
      if (!oppId) return;
      let battleState = null;
      try { battleState = channelRef.current?.presenceState?.() || null; } catch {}
      const aliveNow = lastSeenOf(guildPresenceState(), oppId) != null || lastSeenOf(battleState, oppId) != null;
      if (aliveNow) { oppLastSeenRef.current = nowIso(); return; }
      if (oppLastSeenRef.current && graceExceeded(oppLastSeenRef.current, nowIso(), ABANDON_GRACE_MS)) {
        await voidBattle('Opponent connection chala gaya — battle void.');
      }
    }, 5000);
    return () => { if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; } };
  }, [phase, battle?.id, battle?.status, me]);

  // ---------- questions: AI from MY syllabus first, seeded bank fallback ----------
  const buildQuestions = async (seedId) => {
    try {
      const status = aiStatus();
      if (status.anyConfigured && (await isOnline())) {
        setBusy('Professor Byte questions laa raha hai… 🧠');
        const syllabusRows = me ? activeSyllabusRows(await db.list('syllabus', { eq: { user_id: me } })) : [];
        const qs = await aiChallengeQuestions({
          profile: profile || {},
          syllabusRows,
          count: BATTLE_QUESTION_COUNT,
          topic: 'friend battle',
        });
        setBusy('');
        const norm = normalizeQuestions(qs, BATTLE_QUESTION_COUNT);
        if (isPlayableSet(norm)) { setQSource('ai'); return norm; }
      }
    } catch { setBusy(''); /* AI offline -> bank */ }
    setQSource('bank');
    // ONE client (the accepter) generates and stores the set — both phones then
    // play the identical questions from the row, so the seed never has to match.
    return normalizeQuestions(seededShuffle(QUIZ_BANK, seedId).slice(0, BATTLE_QUESTION_COUNT), BATTLE_QUESTION_COUNT);
  };

  // ---------- A: send a challenge ----------
  const sendChallenge = async (friend) => {
    if (!battlesAvailable()) { setNotice(LOCAL_MODE_MESSAGE); return; }
    setNotice('');
    setBusy('Challenge bhej rahe hain…');
    try {
      const res = await createChallenge({ fromUser: me, toUser: friend.id });
      setBusy('');
      if (!res.ok) {
        // [H1] offline target -> nothing was created, honest message
        setNotice(res.message || 'User not available. Try again later.');
        return;
      }
      setOutgoing(res.challenge);
      setOpponent({ id: friend.id, name: friend.name });
      setPhase('waiting');
      setNotice(res.reused ? 'Pehle se ek challenge pending tha — wahi dikha rahe hain.' : '');
    } catch (e) {
      setBusy('');
      setNotice(e?.message || 'Challenge send nahi hua.');
    }
  };

  // ---------- B: accept / decline an invite ----------
  const onAcceptInvite = async (inv) => {
    setNotice('');
    try {
      const set = await buildQuestions(inv.id); // sets qSource honestly ('ai'|'bank')
      if (!isPlayableSet(set)) { setNotice('Questions ready nahi hue — dobara try karo.'); return; }
      const res = await acceptChallenge({ challenge: inv, questions: set, meId: me });
      if (!res.ok) { setNotice(res.message || 'Accept nahi ho paya.'); await loadChallenges(); return; }
      setInvites((prev) => prev.filter((c) => c.id !== inv.id));
      adoptBattle(res.challenge, res.battle); // opponent + questions come from the rows
      setNotice('Accepted ✅ — dono ke connect hote hi battle shuru.');
    } catch (e) {
      setNotice(e?.message || 'Accept fail hua.');
    }
  };

  const onDeclineInvite = async (inv) => {
    try {
      await declineChallenge(inv.id);
      setInvites((prev) => prev.filter((c) => c.id !== inv.id));
      setNotice('Challenge decline kar diya.');
    } catch (e) {
      setNotice(e?.message || 'Decline fail hua.');
    }
  };

  const onCancelOutgoing = async () => {
    if (!outgoing) { setPhase('pick'); return; }
    try { await cancelChallenge(outgoing.id); } catch {}
    setOutgoing(null);
    setPhase('pick');
    setNotice('Challenge cancel kar diya.');
  };

  // ---------- the challenger notices the accept/decline/expiry (realtime + 2 s poll) ----------
  useEffect(() => {
    if (phase !== 'waiting' || !outgoing) return;
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const rows = await listChallenges({ userId: me, direction: 'outgoing' });
        const row = rows.find((c) => c.id === outgoing.id);
        if (!row) return;
        if (row.status === 'declined') { setOutgoing(null); setPhase('pick'); setNotice('Opponent ne challenge decline kiya.'); return; }
        if (isChallengeExpired(row, nowIso())) {
          try { await expireDueChallenges(me, nowIso()); } catch {}
          setOutgoing(null); setPhase('pick'); setNotice('Challenge expire ho gaya (120s) — koi battle nahi bana.');
          return;
        }
        if (row.status === 'accepted') {
          const b = await getBattleByChallenge(row.id);
          if (b) {
            setOutgoing(null);
            adoptBattleRef.current(row, b); // same-battle guard keeps this idempotent
          }
        }
      } catch { /* poll again */ }
    };
    const t = setInterval(check, 2000);
    check();
    return () => { stopped = true; clearInterval(t); };
  }, [phase, outgoing?.id, me]);

  // ---------- play ----------
  const answer = (i) => {
    if (selected != null) return;
    setSelected(i);
    if (i === questions[qIndex]?.answer) setCorrect((c) => c + 1);
    broadcastProgress(channelRef.current, { q: qIndex + 1 }); // cosmetic only, never scoring
  };

  const next = async () => {
    if (qIndex + 1 >= questions.length) { await finish(); return; }
    setQIndex((i) => i + 1);
    setSelected(null);
    setTimeLeft(PER_QUESTION_SECONDS);
  };

  // ---------- result waiting: stop every poller/subscriber cleanly ----------
  const stopWaiting = () => {
    if (resultPollRef.current) { clearInterval(resultPollRef.current); resultPollRef.current = null; }
    if (resultGuardRef.current) { clearInterval(resultGuardRef.current); resultGuardRef.current = null; }
    try { rowSubRef.current?.unsubscribe(); } catch {}
    rowSubRef.current = null;
    setWaitingScore(false);
    setBusy('');
  };

  // ---------- finish: my result row -> finalize when both exist ----------
  const finish = async () => {
    const btl = battleRef.current;
    if (!btl || finishingRef.current) return;
    finishingRef.current = true;
    setBusy('Score submit ho raha hai…');
    try {
      // [H6] idempotent by composite PK: a retry overwrites MY row only
      await saveBattleResult({ battleId: btl.id, userId: me, score: correct, timeMs: totalTimeMs });
      setWaitingScore(true);
      pollForFinal(btl);
    } catch (e) {
      setBusy('');
      setSaveMsg(e?.message || 'Score submit fail hua — dobara try karo.');
      finishingRef.current = false;
    }
  };

  const pollForFinal = (btl) => {
    const startedAt = Date.now();
    // the opponent's row (or their finalize) can arrive by socket; poll as a fallback
    try { rowSubRef.current?.unsubscribe(); } catch {}
    rowSubRef.current = subscribeBattle(btl.id, () => { checkFinal(btl); });
    resultPollRef.current = setInterval(() => checkFinal(btl), POLL_RESULT_MS);
    resultGuardRef.current = setInterval(() => {
      if (Date.now() - startedAt <= RESULT_WAIT_LIMIT_MS) return;
      // honest timeout: stop everything, keep the play screen, allow a retry
      stopWaiting();
      setSaveMsg('Opponent ka score abhi tak nahi aaya. Screen khuli rakho — aate hi result dikh jayega. Dobara Submit bhi kar sakte ho.');
      finishingRef.current = false;
    }, 5000);
  };

  const checkFinal = async (btl) => {
    if (!btl) return;
    try {
      const [fresh, results] = await Promise.all([
        db.list('battles', { eq: { id: btl.id } }).then((r) => r[0] || null),
        listBattleResults(btl.id),
      ]);
      const row = fresh || btl;
      if (row.status === 'abandoned') {
        stopWaiting();
        await voidBattle('Opponent left — battle void.');
        return;
      }
      if (row.status === 'complete') {
        stopWaiting();
        await showFinalRef.current(row, results);
        return;
      }
      if (canFinalize(row, results)) {
        // [H7] either client may finalize; the status guard makes the second a no-op
        await finalizeBattle({ battle: row, results, completedAt: nowIso() });
        const after = await db.list('battles', { eq: { id: row.id } }).then((r) => r[0] || row);
        stopWaiting();
        await showFinalRef.current(after.status === 'complete' ? after : { ...row, status: 'complete' }, results);
      }
    } catch { /* next tick */ }
  };

  // ---------- void / leave [H12]: no results counted, no XP, no history row ----------
  const voidBattle = async (message) => {
    const btl = battleRef.current;
    stopWaiting();
    finishingRef.current = false;
    if (btl && btl.status === 'active') { try { await abandonBattle(btl.id); } catch {} }
    setBattle(btl ? { ...btl, status: 'abandoned' } : null);
    setVoidMsg(message);
    setWaitingScore(false);
    setOutcome(null);
    setXpAwarded(0);
    setXpNote('Void battle = 0 XP, no history row.');
    setPhase('result');
    dropChannel();
  };

  const onLeaveMidBattle = async () => {
    await voidBattle('Tumne battle chhoda — void. Koi XP nahi, koi history nahi.');
  };

  // ---------- one identical outcome on both phones, then the F7 XP path ----------
  const showFinal = async (btl, preloadedResults) => {
    // A socket delta and the result poll can both detect 'complete' at the same
    // moment; without this guard two concurrent applyBattleXp calls could both
    // read an empty ledger and double-award. One outcome per battle per mount —
    // a REMOUNT is covered by the ledger itself ([H11]).
    if (showFinalDoneRef.current === btl.id) return;
    showFinalDoneRef.current = btl.id;
    const results = preloadedResults || (await listBattleResults(btl.id));
    const out = outcomeForMe(btl, results, me);
    setOutcome(out);
    setBattle(btl);
    setPhase('result');
    dropChannel();

    if (btl.status === 'abandoned' || out.state === 'void') {
      setVoidMsg('Opponent left — battle void.');
      setXpAwarded(0);
      setXpNote('Void battle = 0 XP, no history row.');
      return;
    }

    const completedAt = btl.completed_at || nowIso();
    // FIX-F7 (kept exactly): battle XP independent, anti-retry, daily cap via xpOnce
    // key 'battle' using todayStr(). XP and persistence independent — result save in
    // its own try/catch (fail -> banner, XP secured). [H11] guard -> XP -> save, with
    // the per-battle ledger ABOVE the daily cap so a remounted result screen shows
    // "XP already recorded" instead of paying twice.
    const xp = await applyBattleXp({
      battle: btl,
      results,
      meId: me,
      completedAt,
      opponentName: opponent?.name || nameOf(opponentIdOf(btl, me)) || null,
      hasEarnedToday: (uid, key) => hasEarnedToday(uid, key),
      markEarnedToday: (uid, key) => markEarnedToday(uid, key),
      awardXP: (code, opts) => awardXP(code, opts),
      ledgerGet,
      ledgerSet,
      // complete battles only — the persisted xp_earned IS the value this screen shows
      insertQuizResult: ({ battle: b, results: rs, meId: uid, xpEarned: awardedXp, createdAt, opponentName }) =>
        db.insert('quiz_results', {
          ...quizResultRow({ battle: b, results: rs, meId: uid, xpEarned: awardedXp, createdAt, opponentName }),
          xp_earned: awardedXp,
        }),
    });
    setXpAwarded(Number(xp.awardedXp) || 0);
    setXpNote(xp.msg || (xp.capped ? 'Aaj ka battle XP cap — 0 XP, game still counts.' : ''));
    if (xp.reason === 'ledger') setSaveMsg('Result screen dobara khula — XP pehle hi record ho chuka tha, dobara award nahi hua.');
    else if (!xp.historySaved) setSaveMsg('Result save fail — XP secured ✅ (F5 is its fix, not RLS weakening)');
    if (out.result === 'win') setConfetti(Date.now());
  };
  showFinalRef.current = showFinal;

  // ---------- rematch: a NEW real challenge, never a fake re-roll ----------
  const resetToPick = () => {
    setPhase('pick');
    setOutcome(null);
    setVoidMsg('');
    setSaveMsg('');
    setXpNote('');
    setXpAwarded(0);
    setBattle(null);
    setChallenge(null);
    setOppProgress(0);
    setQuestions([]);
    setQIndex(0);
    setSelected(null);
    setCorrect(0);
    finishingRef.current = false;
  };

  // ---------- render ----------
  const q = questions[qIndex];
  const countdown = (row) => (row ? Math.ceil(msUntilExpiry(row, nowIso()) / 1000) : 0);

  return (
    <View style={{ flex: 1, backgroundColor: GAMER.bg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
      <Confetti trigger={confetti} origin={{ x: '50%', y: '20%' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <Pressable onPress={() => (phase === 'play' ? onLeaveMidBattle() : navigation.goBack())} hitSlop={10} style={{ padding: 6, marginRight: 6 }}>
          <Text style={{ color: GAMER.text, fontSize: 22 }}>‹</Text>
        </Pressable>
        <PixelText size={11} color={GAMER.secondary} glow>
          BATTLE MODE 🤺
        </PixelText>
        <View style={{ flex: 1 }} />
        {!offline ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext }}>
            {friends.filter((f) => f.online).length} online
          </Text>
        ) : null}
      </View>

      {notice ? (
        <Card mode="gamer" style={{ marginBottom: 12, backgroundColor: 'rgba(245,158,11,0.12)', borderColor: '#F59E0B' }}>
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: GAMER.warn, lineHeight: 18 }}>{notice}</Text>
        </Card>
      ) : null}

      {/* ---------------- LOCAL MODE: honest, no fake rival (PO decision a) ---------------- */}
      {offline ? (
        <Card mode="gamer">
          <Text style={{ fontSize: 40, textAlign: 'center' }}>📴</Text>
          <PixelText size={11} color={GAMER.text} style={{ marginTop: 12, textAlign: 'center' }}>
            BATTLES = ONLINE ONLY
          </PixelText>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, marginTop: 12, textAlign: 'center', lineHeight: 19 }}>
            {LOCAL_MODE_MESSAGE}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 10, textAlign: 'center', lineHeight: 16 }}>
            Daily Arena (solo) local mode mein bhi chalta hai — wo fake nahi hai, wo tumhara apna score hai.
          </Text>
        </Card>
      ) : null}

      {/* ---------------- PICK / INVITES ---------------- */}
      {!offline && phase === 'pick' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          {invites.length ? (
            <>
              <PixelText size={9} color={GAMER.gold} style={{ marginBottom: 10 }}>
                INCOMING CHALLENGES ⚔️
              </PixelText>
              {invites.map((inv) => (
                <Card key={inv.id} mode="gamer" style={{ marginBottom: 10, borderColor: GAMER.gold }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: GAMER.text }}>
                    {nameOf(inv.from_user) || 'A friend'} ne challenge bheja hai
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 4, lineHeight: 16 }}>
                    {BATTLE_QUESTION_COUNT} same questions, same timer. {countdown(inv)}s mein expire hoga.
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <Button title="Accept ⚔️" size="sm" mode="gamer" disabled={!!busy} onPress={() => onAcceptInvite(inv)} style={{ flex: 1, marginRight: 8 }} />
                    <Button title="Decline" size="sm" variant="ghost" mode="gamer" disabled={!!busy} onPress={() => onDeclineInvite(inv)} style={{ flex: 1 }} />
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          {outgoing ? (
            <Card mode="gamer" style={{ marginBottom: 12, borderColor: GAMER.secondary }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: GAMER.secondary }}>
                Challenge pending → {opponent?.name || 'friend'}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 4 }}>
                {countdown(outgoing)}s left · accept hote hi battle shuru
              </Text>
              <View style={{ height: 8 }} />
              <Button title="Cancel" size="xs" variant="ghost" mode="gamer" onPress={onCancelOutgoing} />
            </Card>
          ) : null}

          <Card mode="gamer" style={{ marginBottom: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 44 }}>🤺</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, marginTop: 12, textAlign: 'center', lineHeight: 19 }}>
              Ek dost ko challenge karo — dono ko same 5 questions, same timer.{'\n'}Winner +60 XP bonus (din mein ek baar paid).
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 10, textAlign: 'center', lineHeight: 16 }}>
              {busy ? `${busy}` : aiStatus().anyConfigured
                ? `⚔️ AI questions from YOUR syllabus (${profile?.class_level || 'your class'})`
                : '📚 Practice bank questions · add an API key for class-aware AI battles'}
            </Text>
          </Card>

          <PixelText size={9} color={GAMER.subtext} style={{ marginBottom: 10 }}>
            CHOOSE YOUR RIVAL
          </PixelText>
          {friends.map((f) => (
            <Card key={f.id} mode="gamer" onPress={() => sendChallenge(f)} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(6,182,212,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 20 }}>{f.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: GAMER.text }}>{f.name}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: f.online ? GAMER.accent : GAMER.subtext, marginTop: 2 }}>
                    {f.online ? '● Online — abhi battle ho sakta hai' : '○ Away — challenge tabhi banega jab wo online ho'}
                  </Text>
                </View>
                <PixelText size={8} color={f.online ? GAMER.secondary : GAMER.subtext}>
                  {f.online ? 'FIGHT →' : 'AWAY'}
                </PixelText>
              </View>
            </Card>
          ))}
          {!friends.length ? (
            <Card mode="gamer">
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, textAlign: 'center', lineHeight: 19 }}>
                Koi accepted friend nahi mila.{'\n'}Guild tab se dost add karo — real battle real dost ke saath hi hota hai. 🤝
              </Text>
            </Card>
          ) : null}
        </ScrollView>
      ) : null}

      {/* ---------------- WAITING (accept handshake / both-present) ---------------- */}
      {!offline && phase === 'waiting' ? (
        <Card mode="gamer" style={{ alignItems: 'center', marginTop: 20 }}>
          <Text style={{ fontSize: 44 }}>⏳</Text>
          <PixelText size={11} color={GAMER.gold} style={{ marginTop: 12 }}>
            {battle ? 'WAITING FOR BOTH PLAYERS' : 'WAITING FOR ACCEPT'}
          </PixelText>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, marginTop: 12, textAlign: 'center', lineHeight: 19 }}>
            {battle
              ? `${opponent?.name || 'Opponent'} ke is channel par aate hi battle auto-start hoga. Beech mein mat kholna.`
              : `${opponent?.name || 'Friend'} ke accept karte hi battle shuru. ${countdown(outgoing)}s left.`}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 10, textAlign: 'center' }}>
            {busy || (battle ? 'Presence: dono track hone par hi start (ek taraf se kabhi nahi).' : '')}
          </Text>
          <View style={{ height: 14 }} />
          <Button
            title={battle ? 'Leave (battle void ho jayega)' : 'Cancel challenge'}
            size="sm"
            variant="ghost"
            mode="gamer"
            onPress={() => (battle ? voidBattle('Tumne battle chhoda — void.') : onCancelOutgoing())}
          />
        </Card>
      ) : null}

      {/* ---------------- PLAY ---------------- */}
      {!offline && phase === 'play' && q ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, flex: 1 }}>
              vs {opponent?.name || 'Opponent'} · Q{qIndex + 1}/{questions.length} · ✅ {correct}
            </Text>
            <Text style={{ fontFamily: fonts.pixel, fontSize: 12, color: timeLeft <= 5 ? GAMER.danger : GAMER.secondary }}>
              {String(timeLeft).padStart(2, '0')}s
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: GAMER.card, marginBottom: 10 }}>
            <View style={{ height: '100%', width: `${(timeLeft / PER_QUESTION_SECONDS) * 100}%`, borderRadius: 3, backgroundColor: timeLeft <= 5 ? GAMER.danger : GAMER.secondary }} />
          </View>
          {oppProgress ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginBottom: 10 }}>
              ⚡ Opponent Q{oppProgress} par pahunch gaya (sirf dikhne ke liye — scoring tumhari apni row se hoti hai)
            </Text>
          ) : null}
          {waitingScore ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.gold, marginBottom: 10 }}>
              Score submit ho gaya ✅ — opponent ke score ka wait hai…
            </Text>
          ) : null}

          <Card mode="gamer" style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 10, color: GAMER.secondary, letterSpacing: 1, marginBottom: 10 }}>
              {q.subject ? `${String(q.subject).toUpperCase()} · ` : ''}{q.topic ? String(q.topic).toUpperCase() : 'BATTLE'}
            </Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16.5, color: GAMER.text, lineHeight: 25 }}>{q.q}</Text>
          </Card>

          {q.options.map((opt, i) => {
            const isCorrect = selected != null && i === q.answer;
            const isWrong = selected === i && i !== q.answer;
            return (
              <Pressable
                key={i}
                onPress={() => answer(i)}
                disabled={selected != null}
                style={{
                  backgroundColor: isCorrect ? 'rgba(16,185,129,0.15)' : isWrong ? 'rgba(239,68,68,0.15)' : GAMER.surface,
                  borderWidth: 1.5,
                  borderColor: isCorrect ? GAMER.accent : isWrong ? GAMER.danger : GAMER.border,
                  borderRadius: radius.md,
                  padding: 13,
                  marginBottom: 9,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: GAMER.secondary, marginRight: 12 }}>
                  {String.fromCharCode(65 + i)}
                </Text>
                <Text style={{ flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13.5, color: GAMER.text }}>{opt}</Text>
              </Pressable>
            );
          })}

          {selected != null ? (
            <Button title={qIndex + 1 >= questions.length ? 'Submit Score 🏁' : 'Next →'} size="sm" mode="gamer" onPress={next} />
          ) : null}
        </ScrollView>
      ) : null}

      {/* ---------------- RESULT / VOID ---------------- */}
      {!offline && phase === 'result' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          {saveMsg ? (
            <Card mode="gamer" style={{ marginBottom: 10, backgroundColor: 'rgba(251,191,36,0.12)', borderColor: '#F59E0B' }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: '#FBBF24', lineHeight: 18 }}>{saveMsg}</Text>
            </Card>
          ) : null}

          {voidMsg ? (
            <Card mode="gamer" style={{ alignItems: 'center', marginBottom: 16, borderColor: GAMER.danger }}>
              <Text style={{ fontSize: 44 }}>🚪</Text>
              <PixelText size={12} color={GAMER.danger} style={{ marginTop: 12 }}>BATTLE VOID</PixelText>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, marginTop: 12, textAlign: 'center', lineHeight: 19 }}>
                {voidMsg}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 8, textAlign: 'center', lineHeight: 17 }}>
                0 XP · koi quiz_results row nahi · leaderboard par kuch nahi gaya. Ye honest hai: adhoora battle count nahi hota.
              </Text>
            </Card>
          ) : null}

          {!voidMsg ? (
            <Card mode="gamer" style={{ alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 48 }}>{outcome?.result === 'win' ? '🏆' : outcome?.result === 'draw' ? '🤝' : '😤'}</Text>
              <PixelText size={13} color={outcome?.result === 'win' ? GAMER.gold : GAMER.text} glow style={{ marginTop: 12 }}>
                {outcome?.result === 'win' ? 'VICTORY!' : outcome?.result === 'draw' ? 'DRAW!' : 'DEFEATED'}
              </PixelText>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
                <ScoreSide name={myName} emoji="🫵" score={outcome?.myScore ?? correct} me />
                <Text style={{ fontFamily: fonts.pixel, fontSize: 12, color: GAMER.subtext, marginHorizontal: 16 }}>VS</Text>
                <ScoreSide name={opponent?.name || 'Opponent'} emoji="🎮" score={outcome?.oppScore ?? 0} />
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 14, textAlign: 'center', lineHeight: 17 }}>
                {fmtClock(Math.round((outcome?.myTimeMs ?? totalTimeMs) / 1000))} vs {fmtClock(Math.round((outcome?.oppTimeMs ?? 0) / 1000))} · +{xpAwarded} XP earned
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 6, textAlign: 'center', lineHeight: 16 }}>
                {outcome?.reason === 'higher-score'
                  ? 'Zyada sahi jawab jeeta.'
                  : outcome?.reason === 'lower-time'
                  ? 'Score barabar tha — kam time wala jeeta.'
                  : outcome?.reason === 'exact-equal'
                  ? 'Score aur time dono barabar — DRAW, dono ko 0 win bonus (PO decision c).'
                  : ''}
              </Text>
              {xpNote ? (
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.accent, marginTop: 8, textAlign: 'center', lineHeight: 17 }}>
                  {xpNote}
                </Text>
              ) : null}
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row' }}>
            {!voidMsg && opponent ? (
              <Button title="Rematch 🔁" variant="secondary" size="md" mode="gamer" onPress={() => { const opp = opponent; resetToPick(); sendChallenge(opp); }} style={{ flex: 1, marginRight: 8 }} />
            ) : null}
            <Button title="Done" size="md" mode="gamer" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginTop: 10, textAlign: 'center', lineHeight: 15 }}>
            Rematch = naya real challenge (120s TTL), fake re-roll nahi. Source: {qSource === 'ai' ? 'AI (tumhara syllabus)' : 'practice bank'} · {BATTLE_QUESTION_COUNT} same questions dono ko.
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function ScoreSide({ name, emoji, score, me }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: me ? GAMER.primarySoft : GAMER.text, marginTop: 5 }}>
        {name}
      </Text>
      <PixelText size={16} color={me ? GAMER.primarySoft : GAMER.secondary} style={{ marginTop: 8 }}>
        {score}
      </PixelText>
    </View>
  );
}
