# FIX-H — REALTIME BATTLES — Acceptance Report

**Round:** FIX-H (realtime battles) — the round the PO re-authorized with NEW Y's handoff.
**Branch:** `arena/01a0b92e-student-os-main` · **Base:** `6e8627c` (FIX-S S5, accepted head)
**Status at time of writing: PRE-COMMIT.** All code is in the working tree, all tests pass, nothing is committed or pushed. Awaiting the PO's go for the single `FIX-H:` commit.
**Schema gate: AWAITING PO.** `supabase/schema.sql` was edited; **no DDL was executed anywhere, by anyone, at any point this round.**

> ⚠️ Naming note: the untracked `FIX-H-REPORT.md` already in the tree belongs to the **scheduler** commit `c81fc89` (which the PO ruled is *not* the accepted FIX-H). This battles report is `FIX-H-BATTLES-REPORT.md`. The old file is deliberately left untracked and out of the FIX-H commit — PO to decide its fate.

---

## 1. PO decisions (all ratified before coding)

| # | Decision | Implementation |
|---|---|---|
| (a) | Local mode: Battle disabled with honest message; DEMO_RIVALS deleted from battle | `BATTLES_ONLINE_ONLY = true`, `LOCAL_MODE_MESSAGE` (battleRealtime.js:27–31); offline card (BattleScreen.js:680–694); zero `DEMO_RIVALS`/`hashString`/`rivalScore` tokens in BattleScreen (grep-verified, probe BH14*) |
| (b) | XP: +25 `BATTLE_COMPLETE`, +60 `BATTLE_WIN`, once daily via xpOnce key `'battle'` (exact F7 behavior) | `XP_BATTLE_COMPLETE/XP_BATTLE_WIN` read from `XP_RULES` (battleRules.js:36–37); `applyBattleXp` replays the exact F7 sequence guard → XP → save, capped-day still records history with `xp_earned: 0` (test BH11c) |
| (c) | Exact tie (equal score AND equal time) = DRAW, no win XP for either | `resolveOutcome` returns `draw/exact-equal`; `winnerIdOf → null`; draw pays +25 complete, +0 win (tests BH10, BH11e) |
| (d) | Challenge expiry 120 s; abandon grace 30 s | `CHALLENGE_TTL_MS = 120_000`, `ABANDON_GRACE_MS = 30_000` (battleRules.js:28–29) |

## 2. What was built

**The hash simulation is dead.** Old `BattleScreen.js` L86–88 derived the rival's score from `hashString(battleId + opponentId)`; nothing was sent or stored. The rewrite is a real two-phone handshake over Supabase Realtime and three new tables:

```
A: presence check on B ──offline──▶ "User not available. Try again later." + ZERO rows [H1]
        │ online
        ▼
battle_challenges (pending, expires_at = SERVER created_at + 120 s)  [H3]
        ▼  B accepts (Battle screen or Guild card) — B's client generates the
        ▼  5-question set and stores it on BOTH rows; battles row created (active) [H4]
channel battle:{challenge_id} — play auto-starts ONLY when both are tracked [H5]
        ▼
5 questions each side, local grading, own battle_results row upserted on the
composite PK (battle_id,user_id) — a retry overwrites MY row only [H6]
        ▼
both rows exist → either client finalizes; pure rule = one identical winner on
both phones; the .eq('status','active') guard makes the second writer a no-op [H7][H8][H9][H10]
        ▼
F7 XP path (+25, +60 win, once/day) + per-battle ledger sos.battleXP.{id} so a
result-screen reload NEVER re-awards [H11] → quiz_results row (mode 'battle', complete only)

presence drop > 30 s or explicit leave → battles.status='abandoned' → no results
counted, no XP, no history row, honest void screen [H12]
```

All decisions (expiry, both-present, winner, tie, XP) live in **pure** `src/lib/battleRules.js` — no supabase, no AsyncStorage, no react-native, no device clock in any comparison; every timestamp is an argument. `src/lib/battleRealtime.js` only moves bytes and re-exports the rules, so screens import from one place.

**Why not `db.*` for the three tables:** `db.insert`/`db.upsert` inject an `id` and a device `created_at`; `battle_results` has no id column (composite PK), and every deadline here is anchored on the SERVER's `created_at` so two skewed phones cannot disagree. Reads still use `db.list` (injects nothing). Documented in battleRealtime.js:13–19.

## 3. Files changed (this round, working tree)

| File | Change |
|---|---|
| `src/lib/battleRules.js` | **NEW** (421 L) — pure rules engine, 31 exports, plain-Node importable |
| `src/lib/battleRealtime.js` | **NEW** (~480 L) — presence (refcounted), challenges, battles, results, ledger |
| `src/screens/guild/BattleScreen.js` | **REWRITTEN** (+950/−… vs old sim; 0 sim tokens remain) |
| `src/screens/guild/GuildScreen.js` | **+153** — invite card (accept/decline + countdown), entry badge, presence, realtime + 10 s poll; all F6 content untouched |
| `supabase/schema.sql` | **+110 / −0** (verified `git diff | grep -c "^-[^-]"` = 0) — 3 tables, indexes, RLS, publication, gate comment. **FILE ONLY — DDL NEVER RUN** |
| `scripts/logic-test.mjs` | **+374** — 15 BH checks appended; no existing test altered |

**Untouched (verified via `git status`):** ArenaScreen.js, xpOnce.js, db.js, guildData.js, GameContext.js, scheduleGenerator.js, progression.js, presetRows.js, constants.js, all S5 files, friends flows, EAS/package files, main/recovery branches, PR settings.

## 4. Self-verification table

Handoff ID → test ID → mechanism. "Fail-before" = run of the SAME test file against a pristine `git archive` export of `6e8627c` (battle module absent, old sim screen present); "Pass-after" = current tree.

| Handoff | Test | File:line (mechanism) | Fail-before @6e8627c | Pass-after |
|---|---|---|---|---|
| H1 (DEVICE) | BH1* wiring probe | battleRealtime.js:124–126 — `isUserOnline(toUser)` runs BEFORE any `.insert(`; offline → exact message, zero rows; :144 re-anchors `expires_at` on server `created_at` | FAIL (module absent) | PASS |
| H2 (DEVICE) | BH2* wiring probe | battleRealtime.js `declineChallenge` — pending-guarded update, never touches `battles`; BattleScreen reports `row.status === 'declined'` | FAIL | PASS |
| H3 | BH3 | battleRules.js:44–76 `expiryFrom/isChallengeExpired/msUntilExpiry` — 120 s from server timestamp, terminal states never re-expire, expired rows never reused; expire transport idempotent (`.eq('status','pending')`) | FAIL | PASS |
| H4 | BH4 | battleRules.js `normalizeQuestions/isPlayableSet/sameQuestionSet` — accepter stores ONE set on challenge+battle rows (battleRealtime.js:249–266); order/option tamper detected; junk filtered; only the addressed invitee may accept (:230) | FAIL | PASS |
| H5 | BH5 | battleRules.js `bothPresent/lastSeenOf/opponentIdOf` — one-sided presence NEVER starts; BattleScreen.js:258 flips `waiting→play` only via `bothPresent` | FAIL | PASS |
| H6 | BH6 | battleRules.js `resultsByUser/canFinalize` — retry collapses to one row per player; battleRealtime.js:406 `onConflict: 'battle_id,user_id'` (composite PK; `db.upsert` impossible — no id column); score clamped 0..5 | FAIL | PASS |
| H7 | BH7 | battleRules.js:218 `finalizePatch/winnerIdOf` — both phones compute the same winner from the same rows in any order; patch only on `active`; battleRealtime.js `finalizeBattle` `.eq('status','active')` → second writer no-op | FAIL | PASS |
| H8 | BH8 | battleRules.js:174 `resolveOutcome` + `outcomeForMe` — higher score wins; the two views of one battle mirror (win↔loss, same winner id) | FAIL | PASS |
| H9 | BH9 | `resolveOutcome` — equal score → lower `time_ms` wins (`reason: 'lower-time'`) | FAIL | PASS |
| H10 | BH10 | equal score AND time → `draw/exact-equal`, `winnerIdOf → null`, finalize stores `winner: null`, decision pays +25/−0 win bonus (PO decision c) | FAIL | PASS |
| H11 | BH11 (async, injected fakes) | battleRules.js:303 `applyBattleXp` — first win pays 85 (25+60), marks xpOnce once, ledger `sos.battleXP.{id}` written ONLY on confirmed award; reload → `reason:'ledger'`, zero new awards, zero duplicate history; capped day → 0 XP but history saved; awardXP failure → no mark, no ledger, screen still renders; void → nothing | FAIL | PASS |
| H12 (DEVICE) | BH12 + wiring probe | battleRules.js `isVoid/graceExceeded` (29 s alive / 31 s void / unknown never voids) + `applyBattleXp` void early-return (0 XP, 0 history even with result rows present); BattleScreen.js:341–357 watchdog on battle-channel AND guild presence; `abandonBattle` active-guarded | FAIL | PASS |
| H13 (PO SQL) | BH13* schema-file probe | schema.sql:631–741 — 3 tables, composite PK, `score 0..5`/`time_ms>=0` checks, 9 participant/own-row policies, publication for both handshake tables, gate comment. **Live RLS check remains PO-side after running the DDL** | FAIL | PASS (file-level) |
| H14 (DEVICE) | BH14* wiring probe | BattleScreen offline card + `LOCAL_MODE_MESSAGE`; Guild entry sub "Online only — connect Supabase" (GuildScreen.js:435); zero sim/demo tokens (grep = 0) | FAIL | PASS |
| H15 | BH15 + whole suite | no second winner computation anywhere in BattleScreen (regex = 0 matches); F7 machinery reused, `xp_earned: awardedXp` literal (committed G6 guardrail); history only for complete battles; ArenaScreen untouched and its own probes green; **all 68 pre-existing checks still pass unchanged** | FAIL (BH15) / rest green | PASS — **83 PASS / 0 FAIL total** |

### Fail-before evidence (captured this session)

```
$ git archive 6e8627c | tar -x -C /tmp/fixh-before   # pristine base tree, no battle code
$ cp scripts/logic-test.mjs /tmp/fixh-before/scripts/  # SAME test file
$ node --import ./scripts/esm-register.mjs scripts/logic-test.mjs
  FAIL [BH3]  … battleRules.js import failed: Cannot find module …/src/lib/battleRules.js
  FAIL [BH4] … FAIL [BH15]                            # 15/15 BH checks red
AssertionError: FIX-H battles: 15 check(s) failed -> BH3, BH4, BH5, BH6, BH7, BH8,
BH9, BH10, BH11, BH12, BH1*, BH2*, BH14*, BH13*, BH15   (exit 1)
Non-BH failures in the before-tree: NONE — the old suite was green at 6e8627c,
so the red is exactly the new battle suite and nothing else.
```

### Pass-after evidence

```
$ npm run test:logic   → 83 PASS lines, 0 FAIL, "ALL LOGIC TESTS PASSED ✅" (exit 0)
   (68 pre-existing + 15 new BH checks; no existing test was edited)
$ npx expo export --platform web → exit 0, one 2.3 MB web bundle (Metro compile proof)
Bundle string probes: "BATTLES = ONLINE ONLY" ✓ "sos.battleXP." ✓ "battle_id,user_id" ✓
   "User not available" ✓ "guild_presence" ✓ "battle_challenges" ✓ "BATTLE CHALLENGES" ✓
```

## 5. DEVICE tests — honest status

H1/H2/H12/H14 are two-phone live tests. **They were NOT performed** — this sandbox has no second device and no live Supabase with the battle tables (the DDL has not been run; the schema gate forbids it). What exists instead: the wiring probes above (marked `*`), which verify the code paths but **do not pretend to prove UI or live RLS**. Manual script for the PO after the DDL:

1. **H1** — Phone A: Guild → Battle → tap an ONLINE friend → both phones show the battle within seconds; tap an offline friend → "User not available. Try again later." and `select count(*) from battle_challenges` unchanged.
2. **H2** — Phone B declines → B's card disappears; A shows "Opponent ne challenge decline kiya."; no `battles` row exists.
3. **H12** — Mid-battle, force-close B's app → within ~35 s A shows BATTLE VOID, 0 XP, no `quiz_results` row, `battles.status='abandoned'`.
4. **H14** — Local mode build → Battle shows "BATTLES = ONLINE ONLY" card, no rivals, no crash; Guild battle tile says "Online only".
5. **H13 (SQL)** — as user C (non-participant): select/insert/update on all three tables must be rejected; `battle_results` update must be rejected for the opponent's row.

## 6. Deviations (declared per the Honesty Contract)

| # | Deviation | Why |
|---|---|---|
| D1 | Per-battle ledger lives in `battleRealtime.js`, not `xpOnce.js` | `xpOnce.js` is committed F-suite territory with its own probes; adding to it risked the guardrails. Ledger key `sos.battleXP.{battleId}` and semantics are exactly as specified in the handoff §4. `xpOnce.js` itself: untouched. |
| D2 | Test ids `BH3…BH15` instead of plain `H3…H15` | The committed scheduler suite (c81fc89) already owns ids H3–H11 in the same file; duplicate ids would corrupt both suites' failure reports. Mapping is 1:1 (table above). |
| D3 | `battles.status` starts at `'active'` — there is no DB `'waiting'` state | The handoff's own DDL CHECK constraint is `('active','complete','abandoned')`. "waiting" exists only as a client phase (accepted, not yet both-present), which is what the handoff flow describes. |
| D4 | Update policies carry an explicit `with check` mirroring their `using` clause | Postgres defaults WITH CHECK to the USING expression when omitted — semantically identical to the handoff DDL, written explicitly per repo convention (`drop policy if exists` before each create). Nothing weakened. |
| D5 | `battleRealtime.js` imports `battleRules` extensionlessly, but `battleRules.js` imports `constants.js` WITH the `.js` extension | Makes the pure core importable by plain Node (no loader) as well as Metro and the test harness. Metro handles both (bundle export proves it). |
| D6 | Presence is refcounted across screens | Handoff §5 says track on "Guild/Battle focus". Navigation runs the new screen's focus before the old screen's blur cleanup; naive track/untrack would drop presence mid-handshake. `untrackPresence` now only really leaves when the last screen released it. |
| D7 | `acceptChallenge` gained a crash-recovery path + invitee-only guard | A crashed accept could leave `accepted` with no battle row (unrecoverable without this). Re-calling finishes the job from the stored questions. The guard uses the previously-unused `meId` so only the addressed player can accept client-side (RLS still allows both participants to update, per the handoff's DDL — unchanged). |
| D8 | `applyBattleXp` hands the history-row CONTEXT to the injected `insertQuizResult`; the screen builds the row | The committed G6 guardrail requires the literal `xp_earned: awardedXp` inside BattleScreen.js (persisted value provably equals displayed value). `quizResultRow()` remains the pure reference shape and is spread by the screen — one shape, tested in BH11f. |

## 7. Known limitations (honest)

- **30 s grace is measured on the observing device** (`oppLastSeenRef` + `graceExceeded`): presence *membership* is server-truth, but the duration between "last seen" and "now" uses one device's monotonic wall clock. This is unavoidable for a presence-drop timer and cannot drift between phones (only one phone voids a given battle; the guard `.eq('status','active')` makes it once-only).
- **`battle_results` is not in the realtime publication** — exactly as the handoff DDL specifies (only the two handshake tables are). Result arrival therefore rides the 2.5 s poll + the battles-row delta; worst-case result latency ≈ one poll tick.
- **Both players leaving during the pre-start waiting room** leaves an `active` battle row with no watchdog running; it is resumed (or voided by the remaining player's watchdog) on next mount via `fetchMyActiveBattle`. No zombie XP is possible: nothing pays until both result rows exist.
- **Cloud-side daily cap** (`hasEarnedToday(uid,'battle')`) matches the accepted F7 behavior exactly: in cloud mode the xp_events generic branch compares `code === 'battle'` while awards write `BATTLE_COMPLETE`, so the effective cross-check is the AsyncStorage marker (device-local). This is pre-existing F7 semantics, preserved per PO decision (b) — not redefined here.
- **AI questions need ≥5 valid items**; if the AI returns fewer, the accepter silently falls back to the seeded bank (same as the old screen's fallback). The set is stored, so both phones still play identical questions.

## 8. Definition of Done (handoff checklist)

- ☑ All pure H-tests green (15/15 BH) + fail-before evidence captured (§4)
- ☑ Full suite green: 83 PASS / 0 FAIL, exit 0
- ☑ `supabase/schema.sql` updated (+110/−0), **no live DDL run**
- ☑ Sim + DEMO_RIVALS provably gone (grep = 0 tokens; probe BH14*; bundle export clean)
- ☑ Self-verification table (§4) with file:line | mechanism | fail-before | pass-after | deviations (§6)
- ☑ PO decisions (a)–(d) implemented as ratified (§1)
- ☑ SCHEMA GATE marked **awaiting PO** (header + §5 + schema comment)
- ☐ One `FIX-H:` commit pushed — **NOT DONE YET, by PO instruction this turn ("Do not commit or push yet")**
- ☑ No main/PR/EAS/S5/scheduler/Arena/friends-core touches (§3 untouched list, git-verified)

## 9. Commit plan (awaiting PO go)

One commit on `arena/01a0b92e-student-os-main` only:

```
FIX-H: realtime friend battles — presence-gated challenges, shared 5Q set,
per-player result rows, one identical outcome, F7 XP + per-battle ledger,
honest void/local modes (schema gated, DDL not run)
```

Files: the 4 modified + 2 new source files + this report. **Excluded:** the old untracked `FIX-H-REPORT.md` (scheduler round artifact, PO to decide). Push to the arena branch only; then STOP. DDL remains PO-side; battles stay dormant-but-honest until it runs (in cloud mode the tables' absence surfaces as the existing RLS/offline catch paths: empty lists and "Challenge send nahi hua" — no crash; in local mode battles are disabled by design).
