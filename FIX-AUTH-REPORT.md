# FIX-AUTH REPORT — Google sign-in on Android + standalone (no-Metro) APK

Round: FIX-AUTH (NEW Y audit handoff, launch day 2026-10-01). Branch: `arena/01a0b92e-student-os-main`.
Executed on tip: `a73a650` (see §3 drift declaration). Status: implemented, committed, pushed. STOPPED — the two remaining root causes are PO-executed gates (§7), never agent actions.

## 1. Root causes → what this round does

| RC | Class | Resolution |
|----|-------|-----------|
| RC1 — Supabase discards `redirect_to` (falls back to Site URL = localhost:3000) | CONFIG | **PO-executed** dashboard gate (§7). Code-side evidence locked: OA2 probe asserts ZERO `localhost` literals anywhere in `src/` (walked recursively) — localhost can only enter from the dashboard. Optional honest-error improvement implemented: GoTrue's `error_description` (e.g. the unallowlisted-redirect reason) now surfaces in the failure message. |
| RC2 — parser reads only `?query`, never `#fragment` (implicit OAuth tokens live in the fragment) | CODE | **FIXED**: new pure `src/lib/oauthParams.js` → `parseOAuthParams(url)` parses BOTH `?query` and `#fragment` into one object (fragment wins duplicates, percent-decoding with `+`→space, never throws, `{}` on null/junk). `auth.js` native branch swapped to it — the ONLY logic change this round. |
| RC3 — installed APK was a dev-client build (Metro-dependent) | BUILD | **Config landed, build is PO-executed**: `eas.json` (preview = internal distribution + `buildType: "apk"`, NO `developmentClient`, NO development profile) + `app.json` `extra.eas.projectId` = the EXISTING id `c3d81764-bd95-4478-adbc-7a8be8f22e3a` (never re-init). The preview APK embeds its JS bundle — no Metro, no localhost, no dev server. |

## 2. Commit

Exactly ONE commit, prefix `FIX-AUTH:`, on the arena tip current at execution time (`a73a650`), arena only, pushed, verified. Six files staged individually (no `git add .`), full diff inspected pre-commit:
`src/lib/oauthParams.js` (new, ~50 lines with docs, ZERO imports), `src/lib/auth.js` (+12/−2: import, parser swap, error_description detail, comments — nothing removed), `app.json` (+5: the extra.eas block only), `eas.json` (new, exactly the handoff's minimal JSON), `scripts/logic-test.mjs` (+133: OA block), `FIX-AUTH-REPORT.md`.

## 3. Declared drift: audit SHA vs execution tip

NEW Y audited at `c64900b`; arena moved to `a73a650` (FIX-BYTE2) after the audit. FIX-BYTE2 touched only AI-lib strings/regexes/tests — **zero overlap** with any FIX-AUTH file (auth.js, app.json, oauthParams, eas.json all identical at both SHAs). Consequence: the suite baseline is **111**, not the handoff's 109 → after this round: **114** (111 + OA1 + OA2 + OA3). The handoff's own rule "the arena tip current at that time" governs; red-before was run on the actual pre-commit tip `a73a650`.

## 4. Untouched (MUST-NOT list, verified by diff + probes)

`src/lib/supabase.js`, `src/context/AuthContext.js`, `src/screens/auth/AuthScreen.js`, `src/lib/db.js`, `supabase/schema.sql`, `package.json`/`package-lock.json` (ZERO dependency change — no expo-dev-client, no expo-auth-session, no google-signin package; OA3 asserts all three absent and the reused expo-web-browser/expo-linking pre-existing), the web branch of signInWithGoogle (`window.location.origin` + detectSessionInUrl, probe-asserted), email/password + guest/local flows, F5 identity guard, recovery's own eas.json, main, PR #2. The superseded `parseQueryParams` definition is KEPT (remove-nothing rule; probe-asserted).

## 5. Parser contract (OA1, deterministic)

Fragment-only implicit response → access_token/refresh_token/expires_in/token_type; `?code=` → code (the future PKCE path needs no parser change); mixed query+fragment → one merged object, fragment wins duplicate keys; `error`/`error_description` captured for the honest-error message; values percent-decoded, `+` treated as space; malformed escapes degrade to raw values; null/undefined/''/42/{}/[]/'not a url'/'#&&&=' → `{}` and never throws.

## 6. Tests — `npm run test:logic` (the only test command)

- **After: 114 PASS / 0 FAIL, exit 0.**
- **Red-before (pristine `a73a650` + only the new test file overlaid): OA1, OA2, OA3 all FAIL** (module-absent signature: `oauthParams.js` does not exist pre-round; auth.js still calls `parseQueryParams`; app.json/eas.json lack the EAS config). The other 111 pass there.
- Build sanity (the only build command this round permits me): `npx expo export --platform web` → **exit 0**. `dist/` deleted (gitignored). No EAS command was run — ever.

## 7. PO-executed gates (parallel, per the critical path — NEW X runs NONE of these)

1. **Supabase Dashboard → Authentication → URL Configuration (RC1, the primary fix):** ADD exactly `studentos://auth-callback` to Redirect URLs, KEEPING every existing entry (the web flow needs its origins). Site URL → the real production web URL when known (fallback only). Do NOT touch the Google provider settings. Then relay **`FIX-AUTH_SUPABASE_URLS_SET`**.
2. **Google Cloud (read-only verification, no change expected):** the OAuth client used by Supabase already authorizes `https://<ref>.supabase.co/auth/v1/callback` (web sign-in works today). NEVER add `studentos://` to Google Cloud.
3. **Env baking:** `eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value <url>` and same for `EXPO_PUBLIC_SUPABASE_ANON_KEY` (+ any EXPO_PUBLIC_* from `.env.example` you want baked), scoped to the build environment. Publishable anon key ONLY — never a service key. `.env` stays gitignored (OA3-asserted); no secret was ever committed or requested.
4. **Build:** `eas build -p android --profile preview` → download the APK → sideload.

## 8. Device QA (PO, on the freshly built preview APK — after gate ①)

1. Install → launch with Wi-Fi only, **no Metro running** (the defining acceptance). 2. "Continue with Google" → consent → returns signed in, profile loads. 3. Kill + relaunch → session persists. 4. Email+password still works. 5. Sign out → sign in again. 6. Web build Google sign-in unchanged. 7. Guest/local mode unchanged. 8. Second account sees only its own data (F5/RLS unchanged). 9. Cancel at consent → honest error, no crash, no ghost session.

## 9. Honest risk note (accepted for v1, per the audit)

The implicit-token-via-custom-scheme pattern means any Android app could theoretically register `studentos://` and try to catch the redirect; tokens are short-lived and RLS limits the blast radius. The hardening path is supabase-js PKCE (`flowType: 'pkce'` + `exchangeCodeForSession`) — explicitly OUT OF SCOPE for launch and NOT implemented (the parser already captures `code`, so that future round needs no parser change).

## 10. Observed, NOT touched (out of this round's allowlist)

`auth.js` still contains Hinglish copy outside the native-branch fix (`Google sign-in cancel ho gaya.`, the web branch's `Google sign-in nahi chala: …`) and email/password messages (`Email aur password dono chahiye.` etc.). The FIX-AUTH allowlist scoped auth.js to the native branch with remove-nothing; a copy sweep of auth screens is a separate PO decision (OA2 probe documents this deliberately).

## 11. Security checks (this commit)

No secrets in the repo (`.env` gitignored, only `.env.example` tracked); no service_role/getPublicUrl additions; only EXPO_PUBLIC_* (publishable) usage unchanged; RLS/db/schema untouched; zero new attack surface in code — the parser is total and side-effect-free.

## 12. Git/GitHub compliance

Arena only; one `FIX-AUTH:` commit; pushed and verified via `git ls-remote` + `gh api`; recovery (`51f121e` + any PO-side movement), main (`d85953e`), PR #2 untouched; no reset --hard/clean/force; no PRs; no deployment commands of any kind.

## 13. STOP

FIX-AUTH committed and pushed. Critical path now: PO gates ①②③④ (§7) → NEW Y audit → `eas build -p android --profile preview` (PO) → device QA (§8) → launch. No further work performed.
