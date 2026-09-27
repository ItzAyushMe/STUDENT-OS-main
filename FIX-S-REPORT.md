# FIX-S REPORT — scheduler subject interleave, exam run-up, conquered-chapter ladder, class-session cutoff

**Round:** FIX-S (S1–S5 spec)
**Base:** `recovery/v1.0.6-studentos` @ `938e69d` — preserved, not rewritten
**Transfer commit:** ONE commit, message prefix `FIX-S:`, parented on the arena tip `c81fc89`
**Branch pushed:** `arena/01a0b92e-student-os-main` (this session's fixed branch — nothing pushed to `main`, no PR touched, no merge)
**Status:** S1–S4 implemented and tested (`f48a302`). **S5 now implemented in code and tested (see §9) — but DORMANT: it does nothing on the live cloud database until the PO runs the §9.6 SQL.** No DDL was executed by the agent.
**Not claimed:** accepted / closed. This is for PO audit (NEW Y gate).

> **Terminology correction (PO, this round):** `c81fc89` ("FIX-H: redesign scheduler") is **NOT an accepted FIX-H** commit, and **FIX-H (battles) is NOT STARTED**. Earlier wording in this report that called it "accepted FIX-H" was wrong and has been removed. References below to `H1`–`H14` are to the **scheduler test suite that ships in `c81fc89` and runs on `recovery@938e69d`** — test identifiers only, carrying no acceptance claim for any round.

---

## 1. Files changed (exactly 3)

| File | Change | Lines (post-fix) |
|---|---|---|
| `src/config/constants.js` | +`CLASS_SESSION_END = '02-25'` (S4) | L177–185 |
| `src/lib/scheduleGenerator.js` | S1 rotation, S2 run-up, S3 ladder, S4 cutoff — inside the existing single planner (from `c81fc89`) | 1401 total (+492/−27) |
| `scripts/logic-test.mjs` | +22 FIX-S checks; the H-suite fixture date moved (declared, §6 D5) | 2572 total (+642/−4) |

**Not touched (fences respected):** `app.json`, `eas.json`, `package.json`, `package-lock.json` (byte-identical to `c81fc89` — verified by blob hash), `BattleScreen`/battle code, Content Locker, RLS/policies/`supabase/**`, `ScheduleScreen.js`, `main`, PR #2, no dependency changes.

`ScheduleScreen.js` needed **no** change: it already renders `coverage.coverageWarning`, `coverage.unscheduled` and `coverage.partial` (L425–448), so every new FIX-S honesty message reaches the user through the existing surface.

---

## 2. What was implemented

### S1 — weekly subject-pair interleave
- **New pure export** `buildSubjectRotation(pendingRows, startDate, numDays)` (`scheduleGenerator.js` L347–397): groups pending class rows by subject, orders subjects by **nearest deadline → heavier backlog → name** (total order, no clock, no randomness), then deals day `i` the pair `(order[2i mod n], order[2i+1 mod n])`, **keyed by calendar date** and returned as `{ order, byDate, subjects }`.
- **Wired into the class-track day loop**, not a parallel path: `planSchedule` builds the rotation once per plan from the class work items (L612–615), and Phase 1c spends the class quota on that day's pair (L1087–1122) via the new `spendQuota(track, quota, onlySubjects)` helper (L931–943) and `placeStudy(..., onlySubjects)` (L897–929). Phase 2's unclaimed minutes are also kept inside the pair, with a fall-back to plain urgency when the pair is exhausted (L1152–1170).
- **Urgency enlarges the share, never removes the second subject:** the lead subject keeps `quota − secondQuota`; `secondQuota` = 35 % of the class quota on a calm day (`PAIR_SECONDARY_SHARE`), shrinking to a 30-minute floor (`PAIR_URGENT_SECONDARY_MIN`) when the lead subject has a deadline inside `URGENT_LEAD_DAYS` or is overdue. A day carries one subject only when the student genuinely has one subject left.
- **Non-class tracks are untouched** — olympiad/exam/custom keep their `timeSplit` behaviour exactly (`pair = track === 'class' ? classPair : null`).
- **Day offs do not shift the week:** pairs are keyed by calendar date, so an off day leaves its slot unused and the rest of the week is unchanged. Regenerating mid-week rebuilds the same calendar-keyed pairs, and kept rows are still never re-emitted (existing dedupe path unchanged).

### S2 — exam-aware run-up (14 days before each school-exam start)
- `runUps` (L617–645) computes, per school exam, the subjects that still hold class chapters whose **deadline falls before that exam's start**, plus the named chapters. `runUpFor(date)` picks the window a date sits in; **overlapping ranges → nearest exam start wins**.
- `classPairFor(date)` (L648–655) re-orders that day's pair so a due-before-exam subject leads it, and swaps one in when the plain pair holds none — the pair still has two subjects.
- The **revision wave keeps its exact shape** (revision + timed practice, zero new study) but picks from due-before-exam topics first, reaching back through the whole studied history when they are not in the last picks (L1007–1031).
- **New edge handled:** a wave day that falls on a declared day off **moves to the previous day** (`movedWaveDates`, L740–757 + L1030–1033) — the day off stays a day off and the run-up loses no revision.
- **Preserved unchanged:** exam-day light revision (45 min), pre-exam mock, protected window (no NEW class study from `start−14`), `H14` one-shot event behaviour.
- **New honesty field:** class chapters whose deadline lands *inside* the protected window cannot be finished before that exam — they are now named (`coverage.classDueInProtectedWindow` L1213–1221, `coverage.examRunUp` L1228–1231, warning L1246–1251) and stated in `coverageWarning` instead of being quietly scheduled after the exam.

### S3 — conquered chapter → one chapter test + spaced revisions
- Ladder built in `planSchedule` from the *genuinely completed* syllabus rows only (`reason === 'completed'`, L658–704): **one full-chapter test at +2 d** (60 min, session type `mock`) and **spaced revisions at +3 / +7 / +14 d** (25 min — inside the 20–30 min band, session type `revision`).
- **Deterministic identity key:** `subject | topic | type`, where the topic itself encodes chapter + ladder step (`Chapter test: X`, `Spaced revision (+7d): X`, `Spaced revision (catch-up): X`). It is declared at L705–716, seeded from `existing` rows at L723–728 and checked before every emission (L966–984), so regeneration never duplicates a ladder session — even when it rolled to another day or the day's cursor moved. `schedule` rows have no syllabus FK, so this is `row.id + kind + offsetDate` in the only form the database can answer with (declared, §6 D4).
- **Edges:** offsets already in the past clamp forward to today (never backwards); a completion older than 14 days collapses into **one** honest catch-up revision; a chapter test never lands on a school-exam day (it rolls forward) while a spaced revision on an exam day stays light; a session that does not fit rolls to the next day rather than vanishing; sessions for a track whose event date has passed are stopped and counted.
- Conquered chapters are still **never** study-scheduled (the existing completed-row exclusion untouched, now carrying `subject`/`track`/`completedAt` for the ladder — L470–484).

### S4 — 25 February class-track hard cutoff
- `constants.js`: `CLASS_SESSION_END = '02-25'` (MM-DD, leap-safe).
- **New pure export** `classSessionCutoff(today)` (L411–423): session = April→March, cutoff = 25 Feb of the session's **ending** year. `2026-09-27 → 2027-02-25`, `2027-02-26 → 2027-02-25` (passed), `2027-04-01 → 2028-02-25` (new session), `2028-02-29 → 2028-02-25` (leap-safe).
- Enforced in the day loop (L813–839: `olympiadAhead`, `mainExamBufferDay`, `examRelatedDay`, `classBlocked`, `eventPassed`, `classPair`): after the cutoff the class track gets **no new study** (Phase 1c and Phase 2), **no class revision-cycle/quiz rows**, and **no class ladder sessions**. **Olympiad and competitive tracks are unaffected** and still run to their own dates.
- **Exams override the cutoff, new content does not:** school-exam days, the day-before-exam mock, the 14-day run-up, board/main-exam buffer days and main-exam-driven mocks are carved out (`examRelatedDay`), so an exam straddling 25 Feb still gets its revision days through the range end.
- **Unplaceable backlog is reported, never dropped or scheduled late:** `coverage.classCutoff`, `classCutoffDaysBlocked`, `classCutoffUnplaced` (L1318–1322), plus a plain-language `coverageWarning` (L1252–1263); the chapters themselves appear in the existing `unscheduled` / `partial` lists that `ScheduleScreen` already renders.

---

## 3. Test evidence

`npm run test:logic` (Node 22, deterministic: injected `today`/`createdAt`, and the FIX-F dev-date offset for S4).

**FAIL-BEFORE** — final FIX-S test file run against the unmodified `recovery@938e69d` sources:

```
PASS [H1]…[H14]                      (all 14 scheduler-suite checks present on the base)
FAIL [S1a] buildSubjectRotation is not exported (S1 mechanism absent)
FAIL [S1b] SG.buildSubjectRotation is not a function
FAIL [S1c] day 1 must carry both subjects of the pair, got Science
FAIL [S1d] SG.buildSubjectRotation is not a function
FAIL [S1e] SG.buildSubjectRotation is not a function
FAIL [S2a] the summary must name the run-up it applied
FAIL [S2b] SG.buildSubjectRotation is not a function
FAIL [S2c] a run-up is reported
FAIL [S2e] the run-up is named even when it started before the plan did
FAIL [S2f] the wave must not sit on the day off 2026-01-14
FAIL [S3a] exactly one chapter test, got 0
FAIL [S3b] the first run must produce exactly 4 ladder sessions, got 0
FAIL [S3c] 5 chapter tests expected, got 0
FAIL [S3d] a completion older than the ladder collapses to ONE catch-up session, got 0
FAIL [S3e] the +3d revision still happens on the exam day
FAIL [S4a] classSessionCutoff is not exported (S4 mechanism absent)
FAIL [S4b] SG.classSessionCutoff is not a function
FAIL [S4c] olympiad prep still stops at its own date
FAIL [S4d] constants.js must export CLASS_SESSION_END
PASS [S2d], PASS [SP1]               (regression guards — designed to pass before and after)
AssertionError: FIX-S: 19 check(s) failed
```

**PASS-AFTER** — same test file against the FIX-S sources:

```
62 PASS / 0 FAIL
ALL LOGIC TESTS PASSED ✅
```

**Full regression green in the same run:** all legacy suite checks (schedule/XP/streak/rollover/deadlines), FIX-A…FIX-G blocks (incl. `testGenKit`, XP ledger, mind-map size rules), **the `H1`–`H14` scheduler suite** (incl. `H14` one-shot event stop + honest `tooLate`), FIX-F dev-date offset checks, FIX-E rollover, idempotent regeneration (`H8`, `SP1`), zero/tiny hours (`H11`, `H13`), `H12` source greps (single date system, no `setDevDateOffset` inside the scheduler, FIX-D4 guard, deadlines-before-planning).

**FIX-S checks added (22):** `S1a S1b S1c S1d S1e | S2a S2b S2c S2d S2e S2f | S3a S3b S3c S3d S3e | S4a S4b S4c S4d | SP1` (+ the block-level import guards).

---

## 4. Honesty Contract

| # | Files (function → line) | Mechanism actually shipped | Fail-before | Pass-after | Deviations (declared in §6) |
|---|---|---|---|---|---|
| S1 | `scheduleGenerator.js`: `buildSubjectRotation` L347–397; rotation build L612–615; `placeStudy` L897–929; `spendQuota` L931–943; Phase 1c L1087–1122; Phase 2 L1152–1170 | Calendar-keyed disjoint subject pairs dealt round-robin over subjects ordered by nearest deadline; class quota split lead/second (35 %, or a 30-min floor when the lead is due); pair also binds Phase-2 top-ups; non-class tracks untouched | `S1a S1b S1c S1d S1e` FAIL (function absent; day 1 carried one subject only) | all 5 PASS; `H1 H3 H6 H7 H10` still PASS | **D1** (pair model vs the spec's chain example), **D2** (odd subject counts can repeat a subject across two days — arithmetic, not a shortcut) |
| S2 | `runUps`/`runUpFor`/`classPairFor` L617–655; `movedWaveDates` L740–757; wave L1007–1031; `dueInProtected` L1213–1221 + warnings L1246–1263 | Due-before-exam subjects lead the day's pair and the revision wave inside the 14-day run-up; nearest exam wins overlaps; a wave on a day off moves to the previous day; wave shape, exam-day light revision, pre-exam mock and the protected window unchanged; chapters due *inside* the protected window are named as unfinishable in time | `S2a S2b S2c S2e S2f` FAIL | all 5 PASS; `S2d` + `H4 H14` PASS before and after | **D3** (S2 applies to the pair **and** the wave: the preserved protected-window rule forbids NEW class study in those 14 days, so "pairs" inside the window can only mean wave/pair ordering — `S2a` uses a 20-day lead and asserts the window; `S2e` covers the literal 10-day case) |
| S3 | ladder build L658–704; identity keys L705–716 + seeding L723–728; emission L966–984; `completedItems` enrichment L470–484; coverage L1324–1333 | One 60-min chapter test at +2 d (type `mock`) and 25-min revisions at +3/+7/+14 d (type `revision`) per conquered chapter; past offsets clamp forward; >14-day-old completions collapse to one catch-up; tests never land on exam days; unfit sessions roll forward; identity keyed so regeneration emits nothing twice | `S3a S3b S3c S3d S3e` FAIL (0 ladder sessions) | all 5 PASS; `H7` completed-exclusion still PASS | **D4** (chapter test uses the existing `mock` type — schema has no `revisionmock`, and adding one is forbidden DDL), **D6** (identity key is `subject|topic|type`, the recoverable form of `row.id+kind+offsetDate`) |
| S4 | `constants.js` L177–185; `classSessionCutoff` L411–424; day-loop gate L813–839; Phase 1c/2 + revision/quiz/ladder gates L1087–1170, L1138, L1147, L966–984; mock track L993–1001; coverage L1318–1322 + warning L1252–1263 | Class track takes no new content after 25 Feb of the session (Apr→Mar, leap-safe, computed from the injected/`todayStr()` date only); olympiad/competitive continue to their dates; exam-related class days carved out; unplaceable class backlog listed and explained, never dropped or scheduled late | `S4a S4b S4c S4d` FAIL (function/constant absent; class rows after the cutoff; olympiad rows after its date) | all 4 PASS; `H14`/`H5` still PASS | **D5** (H-suite fixture date moved `2026-03-02 → 2026-01-05`, same weekday, zero assertion text changed — 2 March sits *after* the new cutoff, i.e. in the gap where the class track is legitimately closed), **D7** (olympiad-driven mocks are labelled `olympiad`, and mocks/consolidation stop at their event date), **D8** (consequence: with S5 stopped, a Class-10 user in the 26 Feb–31 Mar gap sees zero class sessions + the honest warning) |
| S5 | **no files changed** | **STOPPED before any schema change.** Requires a new `users` column (one-time-per-session prompt flag + decline-next-day memory + chosen stream) and a new `syllabus.status` CHECK value (`archived`). Neither exists; no free-form column is available; the `track='custom:archived'` workaround was rejected as a semantic wart | n/a — no S5 test written (a test for unimplemented behaviour would be a permanent red, not evidence) | n/a | **D9** (STOP + exact SQL in §5, per the spec's own STOP rule; plus two data-layer gaps: Class 11 rows carry no `stream` marker, and `importPreset` is screen-local) |

---

## 5. S5 — STOPPED: schema gate and the exact SQL required

**Why it cannot be done without DDL (verified against `supabase/schema.sql`):**

1. `users` has **no free-form flag column**. Its jsonb columns are all semantically taken (`school_exams`, `priorities`, `arc`, `custom_exercises`, `days_off`). S5 needs a *one-time-per-session* prompt flag, a *decline* memory that must survive to the next day (cloud, not device), and the *chosen stream* — none of which can be derived from `class_level` alone.
2. `syllabus.status` CHECK allows **only** `('locked','in_progress','completed')`. Archiving superseded Class 10 rows needs the value `'archived'`.

Derivable **without** schema change: the accept path itself (`class_level` 10 → 11, import Class 11 presets via the existing `importPreset(preset, track)` in `SyllabusScreen.js` L125, XP/streak/history/locker untouched). **Not** derivable: decline-next-day memory and archival.

**Exact SQL to run (additive; no RLS/policy change — `users.progression` is covered by the existing `users` policies):**

```sql
-- Gate 1: one-time-per-session promotion flag + decline memory + chosen stream
alter table public.users
  add column if not exists progression jsonb default null;
comment on column public.users.progression is
  'FIX-S S5: { session:"2026-27", promptedAt, status:"accepted"|"declined", stream:"Science"|"Commerce"|"Humanities", declinedOn }';

-- Gate 2: archival status for superseded syllabus rows (adds a value only)
alter table public.syllabus drop constraint if exists syllabus_status_check;
alter table public.syllabus add constraint syllabus_status_check
  check (status in ('locked','in_progress','completed','archived'));
```

**Verify the live constraint name before running gate 2** (it may differ in the deployed DB):

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.syllabus'::regclass and contype = 'c';
```

**Two further S5 gaps found in recon (data layer, not schema — need a PO decision):**
- `CLASS_SYLLABI['Class 11']` (89 rows, 11 subjects) has **no `stream` field** and contains no Accountancy/Business Studies, so "choose your stream" cannot be honoured from existing data. Either add a `stream` marker per row, or accept a subject→stream map in `constants.js` (Science / Commerce / Humanities).
- `importPreset(preset, track)` lives inside `SyllabusScreen.js`; S5's accept path (from ScheduleScreen/Home) needs it lifted into a lib module rather than duplicated.

**Zero-DDL alternative (declared, NOT implemented):** mark superseded rows `track = 'custom:archived'` (satisfies the existing `track` CHECK and is excluded from planning by the planner's allocatable-track filter). Rejected for implementation because it abuses the custom-track namespace and would show up in the user's custom-track UI.

---

## 6. Deviations (all declared here, none silent)

- **D1 — S1 pair model.** The spec's weekly example (Mon Maths+SST, Tue SST+Eng…) shares a subject across consecutive days, but acceptance test `[S1a]` demands "no subject on consecutive days". These contradict. I implemented **disjoint-pair round-robin**, which satisfies `[S1a]`. If the PO prefers the chain model, `[S1a]` must relax to "no subject on 3+ consecutive days".
- **D2 — odd subject counts.** With an odd number of subjects, wrap-around makes one subject repeat across two consecutive days (pigeonhole). No fake second subject is invented; the day simply carries what exists. `[S1a]`/`[S1e]` use 6 and 8 subjects (even) and pass strictly.
- **D3 — S2 inside the protected window.** The preserved H4 rule (mandated by the FIX-S spec) forbids NEW class study in the 14 days before a school exam, so S2's "pairs" inside that window can only mean **wave/pair ordering**, not new study. `S2a` therefore uses a 20-day lead and asserts every run-up day; `S2e` covers the literal "exam in 10 days" case and asserts the run-up is named, the protected rule still wins, and the at-risk chapter is reported.
- **D4 — chapter-test session type.** Schema CHECK on `schedule.session_type` has no `revisionmock`; the spec's "revision/mock already exist" was read as `revision` + `mock`. Chapter tests use **`mock`** (labelled "Mock Test" in `SESSION_TYPES`), spaced revisions use **`revision`**. Adding a type would be forbidden DDL.
- **D5 — H-suite test fixture date.** `H_TODAY` moved `2026-03-02 → 2026-01-05` (**same weekday, Monday**), `H_CREATED` likewise. Reason: S4 makes 2 March a post-cutoff date, i.e. inside the gap where the class track is legitimately closed, so class-planning checks need a date inside the session. **No H assertion text was changed**, and all 14 pass both before (with the moved date, old code) and after.
- **D6 — S3 identity key.** `schedule` rows carry no syllabus FK, so `row.id + kind + offsetDate` is stored/recovered as `subject | topic | type`, the topic encoding chapter + ladder step (`Chapter test:`, `Spaced revision (+7d):`, `Spaced revision (catch-up):`). Effect is identical: one ladder per conquered chapter, never duplicated by regeneration (`S3b` proves it over three runs).
- **D7 — event-date honesty for mocks/consolidation.** An olympiad-driven mock is now labelled `track='olympiad'` (it is olympiad prep; labelling it class would let the class cutoff delete legitimate olympiad work), and mocks/revision-cycle/quiz/ladder rows stop at their track's event date — the same rule `pruneExpired`/`H14` already applies to study. No test or screen logic depends on a mock's `track` beyond the existing badge.
- **D8 — consequence of shipping S4 without S5.** Between 26 Feb and 31 Mar the class track is closed by design: such a user gets zero class sessions, the honest cutoff warning and the named unplaced chapters — and no promotion prompt, because S5 is stopped. This is the spec's own behaviour, stated here so it is not mistaken for a regression.
- **D9 — S5 stopped** (§5), per the spec's STOP rule. No schema change, no code, no silent workaround.
- **D10 — spec line references.** The spec's line numbers (~L283–365 etc.) point at the pre-FIX-H file. The intent was mapped onto the existing planner architecture from `c81fc89` (`planSchedule` / `buildWorkItems` / queues / phases); there is still exactly **one** planner and no parallel path.
- **D11 — workspace state.** The sandbox working tree is `recovery@938e69d` content minus the four fenced EAS/package files, so those files could not be touched even by accident; the logic suite is unaffected by them. The transfer commit is parented on the arena tip `c81fc89` so its diff is exactly the FIX-S delta and cherry-picking it onto `recovery` cannot regress the EAS config.

---

## 7. What these tests do NOT prove

The logic suite exercises the planner as a pure function. It does **not** prove rendering, navigation, Supabase writes/reads, RLS, or that a user sees the new warnings in the right place. Manual verification still required on a device/emulator: (1) Schedule screen shows two subjects per class day; (2) the cutoff warning + unplaced chapter list render for a date after 25 Feb (use the FIX-F dev-date offset); (3) a chapter marked complete shows its test at +2 d and revisions at +3/+7/+14 d, and regenerating the plan does not duplicate them; (4) during an exam run-up the wave revises the due-before-exam subjects.

## 8. Transfer / verification

```
git ls-remote origin refs/heads/arena/01a0b92e-student-os-main     # -> the FIX-S commit
git show --stat <FIX-S commit>                                     # -> exactly 3 files
git diff --name-only c81fc89 <FIX-S commit>                        # -> exactly 3 files
# apply onto recovery (PO step):
git checkout recovery/v1.0.6-studentos && git cherry-pick <FIX-S commit>
npm ci && npm run test:logic                                       # -> 62 PASS, ALL LOGIC TESTS PASSED
```

**STOP here.** No merge, no PR change, no `main` change, no claim of acceptance.

---

# 9. FIX-S S5 — session progression (Class 10 → Class 11)

**Authorisation:** PO decisions 1–5 + NEW Y's audited S5a–S5f criteria.
**Base for this delta:** `f48a302` (the S1–S4 commit) on `arena/01a0b92e-student-os-main`.
**Commit:** ONE commit, message prefix `FIX-S:`. **No merge, no PR, no `main`, no EAS/package files, no dependency changes.**
**Live database:** untouched. The feature is **dormant** until the PO applies §9.6.

## 9.1 What S5 does

| Decision | Behaviour shipped |
|---|---|
| PO 1 — DDL approved, agent must not run it | `supabase/schema.sql` documents the column + widened CHECK for **fresh installs**; the live DB is not touched and `S5_SCHEMA_GATE_APPLIED = false` in `constants.js` keeps the feature dormant (no prompt, no banner) in cloud mode until `users.progression` exists. `[S5e]` |
| PO 2 — stream is **label-only**, use the existing combined Class 11 set | Accept imports `CLASS_SYLLABI['Class 11']` = **89 chapters / 11 subjects**, identical for Science, Commerce and Humanities. The stream is stored in `progression.stream` and shown in the UI; it drives no curriculum. `[S5b]` |
| PO 3 — collapsible **"Class 10 · Archived"**, zero planning effect | Archived rows are filtered out of the planner (no study, no chapter test, no spaced revision, no deadlines), progress/trophy counts, subject cards, quizzes, test builder, deadlines, study-hub stats and custom-track subject lists. They are rendered only in the collapsible read-only section in `SyllabusScreen`. `[S5d]` |
| PO 4 — prompt on Schedule load + Home banner; decline re-prompts next day | `shouldPrompt(profile, today)` is a pure function of the profile and the injected date (FIX-F dev-offset aware). One shared controller (`hooks/usePromotion.js`) + one shared sheet (`components/study/PromotionSheet.js`) serve both screens; the sheet opens once per prompt-day; a decline records `declinedOn` and re-fires the next day. `[S5a]`, `[S5c]`, `[S5f]` |
| PO 5 — Class 10 school exams preserved but stop driving Class 11 scheduling; olympiad/competitive stay active | `school_exams` are never deleted. After an accept, `activeSchoolExams()` filters exams saved before `promotedOn` out of the planner/deadline/catch-up inputs. Olympiad and exam tracks keep their dates, workload and sessions. `[S5b]`, `[S5c]` |

## 9.2 Files in this delta (15 modified + 4 new)

**New**
| File | Role |
|---|---|
| `src/lib/progression.js` (423 L) | the S5 engine: **pure** decisions (`shouldPrompt`, `promotionState`, `classPausedFor`, `sessionLabelFor`, `promotionDueDate`, `planAccept`, `planDecline`, `activeSchoolExams`, `preservationSnapshot`, `pendingSessionsToRetire`, `isSchemaReady`) + `runPromotion(plan, deps)` where **every effect is injected**. Imports no db / AsyncStorage / wall clock. |
| `src/lib/presetRows.js` (76 L) | db-free preset→row mapping and the **one** dedupe rule (`subject::chapter`, archived rows never block). See D17. |
| `src/hooks/usePromotion.js` (159 L) | the single controller both screens use: wires the engine to `db.*`, `updateProfile` and `importPresetRows`; probes the schema gate with the real mode (`isRemote()`). |
| `src/components/study/PromotionSheet.js` (139 L) | the one decision sheet (stream chips, what-will-happen list, accept / "abhi nahi", error surface). |

**Modified**
| File | Change |
|---|---|
| `src/config/constants.js` | `SESSION_START='04-01'`, `PROMOTION_FROM_CLASS`, `PROMOTION_TO_CLASS`, `PROGRESSION_STREAMS`, `SYLLABUS_ARCHIVED`, `isArchivedRow()`, `activeSyllabusRows()`, `S5_SCHEMA_GATE_APPLIED=false` (+30 L) |
| `src/lib/scheduleGenerator.js` | archived rows excluded **before** the completed/ladder branch (reason `'archived'`, never enters the S3 conquered registry); no deadlines for archived rows; `classPaused` input → zero class-track emissions (chapters **and** class-labelled mocks/exam-day revision/buffer/consolidation) + honest `coverageWarning`, `coverage.classPaused`, reason `'class-paused'` (+104/−…) |
| `src/lib/starterData.js` | `importPresetRows()` exported (the shared import NEW Y asked for); `seedSyllabusTrack` + `presetToRows` now delegate to `presetRows.js`; both dedupe paths ignore archived rows |
| `src/screens/study/ScheduleScreen.js` | opens the sheet on load (once per prompt-day), paused/prompt/result/error banners, planner fed with `classPaused` + retired-exam-filtered `schoolExams` (generate **and** both catch-up paths) |
| `src/screens/home/HomeScreen.js` | promotion banner + paused banner + result banner + the same sheet |
| `src/screens/study/SyllabusScreen.js` | screen-local `importPreset` replaced by the shared lib; collapsible **"Class 10 · Archived"** section; every active count/subject card/AI dedupe excludes archived rows |
| `src/screens/study/{StudyHub,Deadlines,Quiz,TestBuilder}Screen.js`, `src/screens/settings/SettingsScreen.js`, `src/screens/guild/{Arena,Battle}Screen.js` | one-line archived filters on their syllabus reads (PO decision 3). See D19. |
| `supabase/schema.sql` | `users.progression jsonb default null` + comment; `syllabus.status` CHECK widened to include `'archived'`; idempotent guarded migration block for existing installs. **File only — nothing executed.** |
| `scripts/logic-test.mjs` | +6 S5 checks (`S5a`–`S5f`, 448 L) and one re-pointed source guard (D18) |

## 9.3 Self-verification (evidence, not claims)

`npm run test:logic` → **68 PASS / 0 FAIL**, `ALL LOGIC TESTS PASSED ✅` (62 before S5 + 6 new).

| Criterion | Check | Key assertions that passed |
|---|---|---|
| **S5a** trigger, pure fn | `S5a` | Class 10 + no progression: `2027-04-01`→true, `2027-04-30`→true, `2027-03-15`→false, `2027-02-26`→false; Class 11→false; Class 9→false; `'10'`/`'class-10'` normalise→true; accepted (same session and next session)→false; declined same day→false, next day→true; older-session decline cannot silence a new session; leap-year window; **no db/AsyncStorage/`new Date()`/`process.env` in `progression.js`** |
| **S5b** accept | `S5b` | `class_level`→`'Class 11'`; `progression = {session:'2027-28', status:'accepted', stream:'Science', promotedOn}` and no `declinedOn`; **all 9** Class 10 rows `status='archived'` with `completed_at`/`progress_percent` intact; olympiad row **not** archived; import yields **exactly 89** fresh `locked` class rows; PCB subset (11 rows) exists but is **not** what gets imported; archived row sharing a `subject::chapter` with a Class 11 chapter does not block it (2 rows coexist); preservation snapshot **byte-identical** (`JSON.stringify` equal) for XP/streak/longest/freezes/board/exam dates/school_exams/content/habits/workouts/schedule; profile write set is **exactly** `['class_level','progression']`; no other table written; pending Class 10 sessions (incl. a ladder test) retired while completed history and olympiad sessions are not; every stream imports the same 89; unknown stream throws; retired school exams stop driving planning but stay saved |
| **S5c** decline | `S5c` | `progression={status:'declined', declinedOn, session}`; `class_level` unchanged; **0** rows archived, **0** imported; write set exactly `['progression']`; snapshot byte-identical; re-prompt next day; planner with `classPaused` → **0 class sessions** (`coverage.classTotal = 0`, `heldChapters = 3`, reason `'class-paused'`, honest `coverageWarning`), pause **not** reported as the S4 cutoff, olympiad/exam planned-chapter sets **identical** to the unpaused run and their totals unchanged, both tracks still emit sessions, and no non-class session is lost |
| **S5d** scheduler vs archived | `S5d` | archived open + archived **conquered** rows → `archivedExcluded = 2`, registry reason `'archived'`, **no** session of any kind, **zero** ladder steps, never in `completedItems` (the S3 registry), live chapter still plans, `autoSetDeadlines` writes no deadline for archived rows |
| **S5e** local mode | `S5e` | `isSchemaReady(remote:false)`→true; cloud row **without** the key→false (dormant); cloud row with `progression:null`→true; full local accept (89 imported, all archived, `Humanities`) and full local decline both succeed with no cloud; **schema-gate simulation**: archive refused → `ok:false`, `reason:'schema-gate'`, `class_level` untouched, `progression` untouched, nothing archived/imported, **zero** users writes, message names the DDL, and the student is asked again afterwards |
| **S5f** one-time | `S5f` | after accept: no prompt same day / next day / later in the session / next session; `promotionState='accepted'`; `classPausedFor=null`; record round-trips unchanged (relaunch); regeneration over the new map excludes all 9 archived rows, no archived chapter returns to the calendar, Class 11 + olympiad plan normally, and the progression record is **not** rewritten; sheet opens once per prompt-day; both screens use the one sheet; the screen-local duplicate import is gone |

**Fail-before (required):** on `f48a302` with only the new test file copied in, the suite aborts red —
`AssertionError: FIX-S: 6 check(s) failed -> S5a, S5d, S5b, S5c, S5e, S5f`
(`S5a/S5b/S5c/S5e/S5f`: `progression.js` does not exist; `S5d`: "archived rows are counted, not silently dropped" — the old planner has no archived exclusion at all). Reproduced in a throwaway `git worktree` at `f48a302`, removed afterwards; the working tree was never reset. To reach the S5 block on the old commit, two **new** source guards from this delta had to be made non-fatal in that temporary copy only (they assert files that `f48a302` does not have) — the unmodified suite on `f48a302` fails at the first of them, which is itself fail-before evidence.

## 9.4 Honest limits — what these tests do NOT prove

The suite exercises pure logic and the planner as a function against an in-memory store. It does **not** prove rendering, navigation, real Supabase writes/reads, RLS, or that the sheet looks right on a device. Manual verification still required (use the FIX-F dev-date offset set to on/after 1 April, Class 10 profile):
1. Schedule opens the promotion sheet on load; Home shows the banner; closing without deciding does not nag on every focus but returns the next day.
2. Accept → Syllabus shows **Class 10 · Archived** (collapsed, expandable, read-only) and 89 new Class 11 chapters; XP/streak/habits/workouts/Content Locker unchanged; regenerate → no Class 10 chapter on the calendar.
3. Decline → Home + Schedule show the paused banner; regenerate → zero 🏫 class sessions and the honest "Class planning is paused" line, olympiad/competitive sessions still present; the prompt returns the next day.
4. Cloud mode **before** the DDL: no prompt and no banner anywhere (dormant); if an accept is somehow attempted, the error names the schema gate and the class level does not change.

## 9.5 Deviations declared for S5 (continuing the D-series)

- **D12 — NEW Y's handoff was factually wrong about `CLASS11_12_PCB`.** The handoff stated it "no longer exists at all". It **does** exist (`src/data/syllabusData.js` L415, 11 rows Physics/Chemistry/Biology) and `pickClassSyllabus` (L583) returns it for Class 11/12 **NEET** profiles. Consequence: had the accept path used `pickSyllabusSet(profile).class`, a NEET aspirant would have been "promoted" to an 11-chapter map. The promotion therefore resolves **`CLASS_SYLLABI['Class 11']` explicitly** (PO decision 2), and `S5b` asserts both facts (PCB = 11 rows, imported = 89).
- **D13 — the promotion window is 1 April of the *current calendar year*,** not "the next session start". Because S4's class cutoff is a fixed calendar rule (every 25 Feb), a Class 10 student has no class plan from 26 Feb until they progress; keying the window to the *following* session would have made the spec's own `2027-04-01 → true` case false (it evaluated to 2028-04-01). Behaviour now: Jan–Mar = no prompt (board season), on/after 1 Apr = prompt, one decision per session label.
- **D14 — pending Class 10 sessions are retired on accept** (`pendingSessionsToRetire`). Beyond the letter of the handoff, required by PO decision 3 ("zero effect on scheduling"): otherwise last year's pending blocks — and the FIX-E auto-roller — would keep pushing Class 10 work into the new year. **Completed and skipped history is never deleted**; olympiad sessions are never retired. Asserted in `S5b`.
- **D15 — "zero class sessions" includes class-*labelled* calendar fixtures.** While paused, the planner also suppresses class-track mocks, exam-day revision, buffer cleanup and consolidation (an olympiad-driven mock keeps its `olympiad` label and keeps running). Freed class capacity flows to the other tracks — the planner's existing rule ("a track with no work claims no share") — so olympiad/exam session **counts can rise**; their **planned chapter set and totals are unchanged**, which is what `S5c` asserts. `classCutoffDaysBlocked` still counts only S4 cutoff days, so a pause is never mis-reported as the cutoff.
- **D16 — `supabase/schema.sql` was edited; the live database was not.** Fresh installs need the column and the widened CHECK or an accept would fail for them too. This is a file change, not a migration run: nothing was executed against Supabase, and `S5_SCHEMA_GATE_APPLIED` stays `false` so cloud clients remain dormant until the PO confirms the live change (then flip that one flag — it is the only code change needed to go live).
- **D17 — the shared import lives in two files, not one.** NEW Y's note said "lift `importPreset` into a shared lib"; the PO chose `starterData`. `starterData.js` imports `db.js` → `@react-native-async-storage`, which cannot load under Node, so the suite could not test the rule at all. The **pure** half (row mapping + dedupe) therefore lives in `src/lib/presetRows.js` and `starterData.importPresetRows()` (still exported from the chosen lib, still the only writer) delegates to it. Also note the old screen-local import defaulted `estimated_hours` to 4 while `starterData` used 6: all 426 shipped preset rows specify `estimated_hours`, so no behaviour changes.
- **D18 — one existing source guard was re-pointed.** The H-round assertion "seedSyllabusTrack uses existingKeys/fresh merge logic" tested the *implementation detail* that D17 moved. It now asserts the same intent in both files (`selectFreshPresetRows` in `starterData`, the `subject::chapter` + archived-aware rule in `presetRows`). Its companion assertions (no early-exit, merge adds only missing) are unchanged and still pass.
- **D19 — archived filters reach two FIX-H screens.** `ArenaScreen`/`BattleScreen` pass syllabus rows to `aiChallengeQuestions`; without a filter, battles would keep drawing on archived Class 10 chapters, contradicting PO decision 3. The change is **one line each, on the data input only** — no battle logic, scoring, XP or UI was touched.
- **D20 — the local branch pointer had regressed.** The sandbox came back with `arena/01a0b92e-student-os-main` at `8e14fe0` (an older commit) while `origin` correctly held `f48a302`, and all prior work sat uncommitted in the tree. Re-anchored with `git reset --mixed f48a302` (**index only — no file was modified, no force-push, nothing pushed to any other branch**), verified by `git diff f48a302 --stat` showing exactly the S5 delta.
- **D21 — the `progression` JSONB carries more keys than NEW Y's column comment.** `{session, promptedAt, status, stream, declinedOn}` plus `fromClass, toClass, decidedAt, promotedOn, schoolExamsRetiredOn, archivedRows, conqueredArchived, importedRows, completedAt`. All additive JSON — no schema impact — and they are what makes the audit trail and the "history kept" claim checkable.

## 9.6 The SQL the PO must run (agent did NOT run it)

Pre-check — confirm the live constraint name first:
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.syllabus'::regclass and contype = 'c';
```

Migration (additive, idempotent, no data rewrite; RLS needs no change — the policies are row-level and never enumerate columns):
```sql
alter table public.users add column if not exists progression jsonb default null;

comment on column public.users.progression is
  'FIX-S S5: { session:"2026-27", promptedAt, status:"accepted"|"declined", stream:"Science"|"Commerce"|"Humanities", declinedOn }';

alter table public.syllabus drop constraint if exists syllabus_status_check;
alter table public.syllabus add constraint syllabus_status_check
  check (status in ('locked','in_progress','completed','archived'));
```

After it runs, tell me and I will flip `S5_SCHEMA_GATE_APPLIED` to `true` (one line) so cloud clients stop being dormant. Until then: **cloud users see nothing new; local-mode users get the full feature** (no schema to gate).

## 9.7 Gate order respected

PO decisions 1–5 ✅ → NEW X implements S5 + tests ✅ (this commit) → **PO runs the SQL ⬅ NEXT** → PO announces the gate → NEW Y verifies. Nothing merged, no PR touched, `main` untouched, no claim of acceptance.
