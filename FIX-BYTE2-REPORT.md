# FIX-BYTE2 REPORT — Item A (17 residual Hinglish strings) + Item C (sanitizer hardening) + Item B (B1 declared)

Round: FIX-BYTE2 (audit handoff from NEW Y at `c64900b` + PO decisions relayed in chat: (a) DO, (d) YES allowlist aiModelGuard.js this round only, (b) B1 accept-and-declare, (c) HARDEN-with-A).
Branch: `arena/01a0b92e-student-os-main`. Base: `c64900b` (FIX-BYTE, audit PASS).
Status: implemented, committed, pushed. STOPPED. Transfer T was authorized for an UNPINNED session — this session is pinned to arena and did NOT touch recovery.

## 1. Decisions executed

- **(a) Item A — DONE:** all 17 inventoried strings neutralized to plain, warm English; every `${interpolation}` preserved exactly (probe-asserted per-string).
- **(d) aiModelGuard.js — allowlist expansion exercised:** its L21 timeout string (#17) neutralized. Scoped exactly as the PO stated: this file, this round only; no other logic in it touched (1-line diff).
- **(b) Item B — B1 accepted and declared, ZERO code change:** `sanitizeMarkdownStray(reply)` runs BEFORE `persist(...)` in TutorScreen's send flow, so the stored chat keeps sanitized text ("what is stored = what was shown"). This deviated from the §13-1 phrasing "sanitize display only; persisted chat text stays original" and was NOT declared in the FIX-BYTE report — declared here (see §4). Consequence accepted per PO: if a Markdown renderer is ever installed, pre-existing messages won't re-render raw formatting. The behaviour is already probe-locked by the existing PB-F* check (sanitize index between reply and persist), so it cannot drift silently.
- **(c) Item C — DONE riding along with (a):** two regex tweaks in `sanitizeMarkdownStray` (see §3).

## 2. Commit

- Exactly ONE commit, prefix `FIX-BYTE2:`, on top of `c64900b` (arena tip at execution time), arena branch only, pushed, verified.
- Staged file-by-file (no `git add .`): `src/lib/aiService.js` (1 string), `src/lib/aiFeatures.js` (15 strings), `src/lib/aiModelGuard.js` (1 string, PO-allowlisted), `src/lib/byteContext.js` (2 regexes — declared deviation, §5), `scripts/logic-test.mjs` (PB block + 1 probe update, §6), `FIX-BYTE2-REPORT.md`.
- NOT touched: TutorScreen.js (B1 = no code change), package.json/lock (zero dependency change), schema.sql (zero schema change), eas/app config, main, recovery, PR #2. No DDL/Storage/deployment command of any kind.

## 3. Item C mechanism (NEW X decision, per the handoff's suggested shape)

- **Italic:** content between spaced `*` markers must contain a LETTER (Latin or Devanagari) **and** start/end on a non-space → `2 * 3 * 4 = 24` and `The answer is 3 * 4, then 5 * 6.` pass through unchanged (the second case is why the non-space-edge rule was added on top of the letter rule — letters can sit BETWEEN two arithmetic pairs); `*important*` still strips.
- **Bullets:** a line-start `-`/`*` marker converts to `•` only when followed by a LETTER (Latin or Devanagari) → `- 3 = 2` stays; `- item`, `* item`, indented `- item`, and `- पढ़ाई` convert (letter rule covers Hindi bullets, matching the language-mirroring persona).
- Bold/headings/fences behaviour and idempotency: unchanged (probe-asserted). Accepted edge per the acceptance spec: a digit-led "bullet" like `- 5 tips` intentionally stays literal.

## 4. Report-accuracy correction (mandated by the audit)

FIX-BYTE-REPORT.md §7.1 claimed "all aiService fallback strings neutralized." **That claim was inaccurate**: the truncation string at `aiService.js` L440 (`AI ka answer beech mein kat gaya…Dobara try karo…`) survived the previous round — its capital-D "Dobara" slipped past my case-sensitive verification grep. It is neutralized now (inventory #1) and locked by the PB-H probe. Corrected here rather than editing the committed FIX-BYTE-REPORT.md (that file is not in this round's allowlist, and history should stay honest).

## 5. Declared deviation: byteContext.js edited though absent from the allowlist

The handoff's Item-C acceptance tests target `sanitizeMarkdownStray`, which exists ONLY in `src/lib/byteContext.js` — a file the FIX-BYTE2 allowlist omitted. The PO order "(c) HARDEN, ride along with (a)" is explicit and unimplementable anywhere else (TutorScreen.js is forbidden under B1; duplicating the sanitizer would break single-source). The edit is confined to the two regexes + comments inside that one function (9-line diff). Flagged BEFORE implementation in chat; declared here per the honesty contract.

## 6. One pre-existing probe updated (necessitated by the PO-ordered copy change)

`scripts/logic-test.mjs` L668 (FIX-G block): `src.includes('questions mile')` → `src.includes('questions returned')` — the probe tracked the exact banner copy the PO ordered neutralized (inventory #14). The probe still asserts the same contract (honest partial banner exists); it now tracks the locked new copy. Marked inline with a comment. This also forms part of the red-before evidence (§7). The neighbouring L671 OR-probe still passes via its `stillMissing` branch and was left untouched (minimal diff).

## 7. Tests — `npm run test:logic` (the only test command)

- **After (working tree): 111 PASS / 0 FAIL, exit 0** = 109 pre-existing (83 + 18 J + 8 PB) + **PB-H** (Item A source probes: none of `karo / nahi aaye / nahi mile / nahi bana / ban paya / ban payi / bheja / diye / samajh nahi / kat gaya / chhota / baaki:` in any of the three files; all interpolations + all 17 neutralized strings asserted present) + **PB-D2** (Item C: the handoff's exact acceptance cases).
- **Red-before (pristine `c64900b` + only the new test file overlaid): PB-H FAIL** ("aiService.js still contains karo") **and PB-D2 FAIL** ("spaced asterisks between digits are MATH") — the other 109 pass there. Additionally, with the suite completely unadjusted, the updated L668 banner probe aborts the old tree first ("Partial banner honest message exists") — a second independent red signature proving the string swap. (For the isolated PB-H/PB-D2 red run, the /tmp scratch copy's L668 was temporarily reverted to the old copy — scratch only, never the repo.)
- `npx expo export --platform web`: exit 0. `dist/` deleted (gitignored).

## 8. Forbidden-change compliance

No dependency/schema/eas/app-config change; `main` never touched; no PR created/modified; no `reset --hard`/`git clean`/`git add .`/force-push; no live SQL/DDL/Storage/Edge/EAS operation; no secrets requested; recovery untouched (T is for an unpinned session — this session is pinned to arena); TutorScreen untouched (B1); provider chain/retry/timeout LOGIC untouched (only the message text at aiModelGuard L21, per the explicit allowlist expansion).

## 9. Inventory executed (17/17)

#1 aiService truncation · #2 habit suggestions · #3 quiz parse · #4 quiz short-count · #5 deck empty-cards · #6 challenge questions · #7 reschedule plan · #8 weekly reflection · #9 syllabus · #10 empty paper · #11 missing section (kept `${stillMissing…}` + `${presentTypes…}`) · #12 paper short-count (kept `${totalQs}/${totalQuestions}`) · #13 empty bank · #14 partial banner (kept `${questions.length}/${totalQuestions}`, `missLine`→"missing:", `skipLine`) · #15 mind-map failure · #16 mind-map short (kept `${shortfalls.join('; ')}`) · #17 aiModelGuard timeout (kept `${MAX_TOTAL_MS / 1000}s`). Tone matches the FIX-BYTE neutralized set; no interpolation lost (each asserted in PB-H).

## 10. Known limitations (honest)

PB-H's token probes are case-sensitive literals (deliberate: they mirror the audited inventory); screens outside the three allowlisted lib files keep their general Hinglish UI flavor (out of scope per the prior round's PO decision — only the AI-stack fallback strings were ordered neutralized). The sanitizer hardening covers the two reproduced regressions; exotic markdown still relies on the persona contract + askAI's stripMarkdown.

## 11. Git/GitHub compliance

Work only on `arena/01a0b92e-student-os-main`; exactly ONE commit starting `FIX-BYTE2:`; pushed to arena only; verified via `git ls-remote` + `gh api`; recovery `de3cd72`, main `d85953e`, PR #2 open/unmerged — all untouched.

## 12. Pending (PO-side, unchanged by this round)

Storage gate SQL (FIX-J §5) → `FIX-J_STORAGE_GATE_APPLIED` → device QA §7 (blockers: real uploads + 403 isolation) · Recovery transfer of `b36840b` (unpinned executor) · FIX-BYTE device items PB1/PB5–PB10.

## 13. STOP

FIX-BYTE2 committed and pushed for PO review. No further work performed.
