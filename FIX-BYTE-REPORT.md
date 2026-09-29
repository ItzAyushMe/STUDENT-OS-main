# FIX-BYTE REPORT — Professor Byte becomes a real general-purpose AI assistant

Round: FIX-BYTE (handoff audited at `b36840b` = the ONLY spec, plus the PO's §13 answers given in chat this session).
Branch: `arena/01a0b92e-student-os-main`. Base: `b36840b` (accepted FIX-J).
Status: implemented, committed, pushed. STOPPED at the PO gate — nothing merged, main/recovery/PR #2 untouched.

## 1. Problems fixed (handoff §2 → where)

| # | Problem | Fix |
|---|---------|-----|
| P1 | "gently steer back" rejected non-study topics | Removed from the tutor system string; persona now says "Never steer the user back to studying — a non-study question is a normal question" (`aiFeatures.js` aiTutorReply, `aiService.js` AI_PERSONA) |
| P2 | artificial "Max ~180 words" cap | Deleted; replaced with "Length follows the question — short for simple asks, detailed when depth genuinely helps. No artificial word caps." |
| P3 | forced language (persona Hinglish mandate + hardcoded fallbacks) | AI_PERSONA rewritten: "reply in the SAME language the user writes in — English → English, Hindi → Hindi, Hinglish → natural Hinglish… Never force Hindi/Hinglish into an English conversation." All aiService fallback strings neutralized (PO §13-5 decision — see §7) |
| P4 | no context beyond a blind 4-field line | New pure lib `src/lib/byteContext.js`: 6 category resolvers (profile/academic/schedule/habits/fitness/social), keyword-intent selection (`selectCategories`), per-message `resolveByteContext` with `db.list` INJECTED, replacing the blind line with an optional "StudentOS context (use only if relevant):" block |
| P5 | stray markdown visible | PO chose the plain-text path (§13-1): persona's no-Markdown/no-LaTeX contracts KEPT; new pure `sanitizeMarkdownStray()` applied to every reply in TutorScreen before persist/render (idempotent — `askAI` already runs `stripMarkdown`; this is the display-layer belt PB-D asked for). NO markdown-renderer dependency added |
| P6 | study-only placement | TutorScreen registered in HomeStack AND LifeStack (+ Settings in LifeStack, see §7) and a Home header icon (`chatbubble-ellipses-outline` → `navigate('Tutor', { hub: 'HomeMain' })`). 5-tab structure and all existing entries unchanged |
| P7 | study-locked quick chips | Chips generalized: Explain / Quiz me (no "from my syllabus") / Summarize / Plan my day / Help me write / Motivate me |
| P8 | other features hardcode Hinglish | `aiMotivate`, `aiDailyMessage`, `aiWeeklyReflection` prompts now say "in the user's language" — zero "Hinglish-flavored English"/"Hinglish flavor ok"/"next week ke liye" strings remain in aiFeatures.js |

## 2. Commit

- Exactly ONE commit, prefix `FIX-BYTE:` — SHA recorded in §11 verification.
- Staged file-by-file (NO `git add .`): `src/lib/byteContext.js` (new), `src/lib/aiService.js`, `src/lib/aiFeatures.js`, `src/screens/study/TutorScreen.js`, `src/navigation/RootNavigator.js`, `src/screens/home/HomeScreen.js`, `scripts/logic-test.mjs`, `FIX-BYTE-REPORT.md`. Full diff inspected pre-commit.
- Excluded: `FIX-H-REPORT.md` (older untracked artifact), `dist/` (deleted; gitignored).
- `package.json`/`package-lock.json`/`supabase/schema.sql`/`db.js`/XP/gym/scheduler/battle files: UNTOUCHED (zero diff this round).

## 3. Dependency change

**None.** PO selected the plain-text sanitize path (§13-1); `react-native-markdown-display` was NOT added (probe-asserted: zero markdown dependencies in package.json).

## 4. Schema / security gate

**None required, none made** (§12): no tables/columns/buckets/policies touched; `schema.sql` has zero FIX-BYTE text (probe-asserted). All context reads go through the existing `db.list` as the authenticated user (RLS + F5 identity guard unchanged); social context is friend COUNT only — never names or pending requests (probe-asserted: names in fetched rows never reach the prompt); guests (no profile.id) trigger ZERO db fetches; context is fetched fresh per call and never persisted into the chat log; no service-role anywhere.

## 5. Tests — `npm run test:logic` (the only test command)

- **After (working tree): 109 PASS / 0 FAIL, exit 0** — 101 pre-existing (incl. all 18 FIX-J checks) + 8 new PB checks (PB0, PB-A, PB-B, PB-C, PB-D, PB-E, PB-F*, PB-G).
- **Red-before (pristine `b36840b` + only the new `scripts/logic-test.mjs` overlaid): all 8 PB checks FAIL** ("byteContext.js import failed" — the module does not exist at the base; the dynamic-import pattern records red instead of crashing). Every pre-existing check still passes on the old tree.
- PB-A proves the handoff's exact selection cases (photosynthesis → profile only; revision/exam → academic; workout → fitness; "organize tomorrow" → schedule+habits; "everything" → broad set) and the ≤3 cap on adversarial mixed messages.
- PB-B proves totality ('' on junk, never throws) and PB11 failure isolation with injected fake `list` functions: total db failure → profile-only reply path, per-category failure → silent skip, identity scoping (`eq.user_id`/`eq.friend_id`) on EVERY fetch, guest = zero fetches, friend names never leak.
- PB-C/PB-E are string/wiring probes on the committed sources; PB-D proves the sanitizer leaves math notation (`x^2`, `sqrt(y)`, `∫`, `θ`) untouched.
- `npx expo export --platform web`: exit 0 — all modified screens bundle; the new persona and context-header strings are present in the bundle. `dist/` deleted.

## 6. DEVICE / PO-RUNTIME items — NOT verified by me (labelled as wiring probes)

PB1 (a real general question gets a real general answer from a live model), PB5 (account-B isolation on device), PB6 (English→English / Hindi→Hindi / mid-chat switch), PB7 (long answer when depth is warranted), PB8 (visual formatting check), PB9 (Byte reachable from Home and Life on a device), PB10 (swap a provider key → still works). The suite proves selection logic, prompt assembly and wiring — it does NOT pretend to prove live model behaviour.

## 7. Declared deviations / judgement calls

1. **§13-5 executed as the PO chose, not as the handoff defaulted**: the handoff said keep the Hinglish fallback UI copy; the PO selected "Neutralize to English" in chat this session. Neutralized: all aiService fallback/AIUnavailable strings (timeouts, humanizeError, offline, missing-key, busy/"Asli wajah") + TutorScreen's catch-all toast. Scope reading: only the AI-stack fallbacks — the app-wide non-AI Hinglish toasts (Gym/Habits/etc.) are UI flavor outside this round and were left untouched.
2. **`aiModelGuard.js` keeps one Hinglish timeout string** — the file is NOT in §10's may-modify list, so it was left alone despite being AI-adjacent. Flagged for a future round if the PO wants it.
3. **LifeStack also registers Settings** (§6 said "~4 lines"): TutorScreen's "AI not connected" banner calls `navigation.navigate('Settings')`; without the registration that button dead-ends in the Life stack — same reason StudyStack already carries Settings. Coherent-minimal, not a redesign.
4. **`useHubBack` hub is now `route?.params?.hub || 'StudyHub'`**: the back fallback must land on the entry stack's hub (HomeMain when opened from Home); the classic Study entry is byte-identical in behaviour.
5. **QUICK gained a 6th chip** ("Help me write") while generalizing — chips are explicitly in scope (P7) and this covers the "writing" general-topic requirement.
6. **`byteContext.js` inlines tiny mirrors of `todayStr`/`normalizeGymSplitV2`** instead of importing `utils.js`/`gymSplit.js` — those modules use extensionless imports and would break the plain-Node importability contract (FIX-H/J pattern) that the whole PB test block relies on. Behaviour for the displayed fields is identical.
7. **Convo role labels ("Student:"/"Professor Byte:") kept** — cosmetic, not a steering instruction; minimal diff.

## 8. Preserved constraints (probe-asserted by PB-C/PB-E/PB-F*/PB-G)

Provider chain/retry/timeout internals untouched (`callProvider`, `MAX_TOTAL_MS`, `looksLikeMissingModel`, `isRetryable`, F9 model documentation, Groq/Gemini model lists); `askAI` reuse unchanged (provider swappable — §3 requirement); the plain-text FORMATTING and MATH NOTATION persona contracts kept verbatim; `stripMarkdown` kept; history cap exactly 8; chat storage untouched (`sos.chat.{uid}`, cap 60, device-local, guest key kept); MathText rendering kept; other AI features' logic (quiz/test/mindmap/battle/rewriteAnswerWindows/buildProfileContext/FIX-D4 reschedule prompt) untouched; 5-tab nav structure unchanged; Home's existing Byte card and StudyHub tile unchanged.

## 9. Context architecture facts (§4/§8 compliance)

Selection is keyword/intent-based with word-boundary matching (includes Hinglish `aaj`/`kal`/`padhai`); default (no match) = profile only; "use everything" intents map to the broader top-priority set — still ≤3 categories; each block ≤600 chars, whole injection ≤2400 chars; `schedule` pulls `habits` (PB-A's "organize tomorrow" case); archived syllabus rows never reach Byte (S5 `activeSyllabusRows`); past/completed deadlines excluded; the block is injected ONLY when non-empty. No persistent Byte memory was invented (§8: none exists, none added).

## 10. Not done (scope discipline)

No Life/Guild entry BUTTON (LifeHubScreen/GuildScreen are not in §10's file list — Life reachability is the stack registration per §6; a Life button needs a future authorized touch of LifeHubScreen.js). No markdown renderer. No memory feature. No nav redesign. No exam-picker/rollover/AI-feature additions. No provider-chain changes.

## 11. Git/GitHub compliance

Work only on `arena/01a0b92e-student-os-main`; exactly ONE commit starting `FIX-BYTE:`; pushed to that branch only; verified via `git ls-remote` + `gh api` (see chat log); no cherry-pick/merge/reset/force; `recovery/v1.0.6-studentos` (`7661131`), `main` (`d85953e`) and PR #2 untouched.

## 12. Known limitations (honest)

Keyword selection is a heuristic — an unusual phrasing may fetch profile-only (safe default) or one imperfect category (blocks are marked "use only if relevant", so the model can ignore them). Hindi-keyword coverage is minimal (aaj/kal/padhai). Context is fetched fresh per message (no caching — by design, §8). The sanitizer handles the common stray-marker cases (**, leading -/*, fences, headings); exotic markdown (nested lists, links) relies on the persona contract + askAI's stripMarkdown.

## 13. STOP

FIX-BYTE is committed and pushed for PO review. Awaiting the PO gate: review the commit → device tests PB1/PB5–PB10 (§6). No further work performed.
