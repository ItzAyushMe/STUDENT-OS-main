# FIX-RELEASE Report

**Round:** FIX-RELEASE (NEW Y release-blocker B1 remediation)
**Branch:** `arena/01a0b92e-student-os-main` only
**Baseline:** commit `2920ce9` (the exact commit audited by NEW Y; worktree confirmed identical to the remote commit before editing — the PO's earlier uncommitted local eas.json edit was NOT present in this sandbox, so nothing was overwritten or lost)

## Change
Added explicit:
"environment": "preview"

to the preview EAS build profile in `eas.json`. The profile is now:

```json
"preview":    { "environment": "preview", "distribution": "internal", "android": { "buildType": "apk" } },
```

This binds the preview build to the EAS **preview** environment, so `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (already configured by the PO in that environment) are baked into the APK at build time.

## Reason
The previous standalone APK did not contain the Supabase build-time configuration. Without `"environment": "preview"` in the committed profile, `eas build --profile preview` does not pull the EAS preview environment variables, so `process.env.EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` are absent from the bundle, `isSupabaseConfigured` is false, and the app runs in Local Mode (blocker B1). The audited remote commit `2920ce9` still had the old preview profile; the fix had to be committed, not local.

## Scope
Only eas.json was modified for implementation. One line changed (git diff: 1 insertion, 1 deletion). All other contents preserved verbatim:

- `cli`: `{ "version": ">= 24.8.0", "appVersionSource": "remote" }` — unchanged
- `preview.distribution`: `"internal"` — unchanged
- `preview.android.buildType`: `"apk"` — unchanged
- `production`: `{ "autoIncrement": true }` — unchanged
- `submit`: `{ "production": {} }` — unchanged
- No `developmentClient`, no `development` profile (FIX-AUTH invariants intact)

No secrets: no env values were read, created, changed, printed, or committed. The EAS variables already exist (PO-configured) and were not touched. No EAS command was run.

No other file was touched: NOT supabase.js, auth.js, OAuth code, package.json, package-lock.json, app.json, schema, or any feature code. Pre-existing untracked `FIX-H-REPORT.md` left untracked, per standing rule.

## Verification
Exact safe checks performed (all from the committed tree at `2920ce9` + the one-line edit):

1. **JSON syntax** — `JSON.parse(eas.json)` succeeds (node assert script).
2. **Exact binding** — `eas.build.preview.environment === "preview"` asserted.
3. **Preservation asserts** — `distribution === "internal"`, `android.buildType === "apk"`, `production deepEqual { autoIncrement: true }`, `submit deepEqual { production: {} }`, `cli` unchanged, preview key count === 3 (nothing extra). Result: `ALL EAS.JSON CHECKS PASS`.
4. **Safe logic/config suite** — `npm run test:logic`: **114 PASS / 0 FAIL**, `ALL LOGIC TESTS PASSED ✅`, exit 0. Includes probe **OA3**, which parses eas.json and asserts the preview profile shape (internal + apk, no developmentClient, no development profile, production autoIncrement) — it passes with the new `environment` key, confirming no regression to the FIX-AUTH invariants.
5. **`git diff`** — exactly one hunk in `eas.json`, one line changed; no other modified file.
6. **`git status`** — only `M eas.json` plus the new report file and the pre-existing untracked `FIX-H-REPORT.md`; nothing unexpected appeared.
7. **No EAS build was started, awaited, or run by NEW X** — build remains PO-executed.

## Commit
One commit, prefix `FIX-RELEASE:`, message: `FIX-RELEASE: bind preview build to EAS preview environment`

SHA: a commit cannot contain its own SHA (the hash is computed from the content, so embedding it is circular). The exact resulting SHA is recorded in NEW X's final chat report and in `git log --oneline -1` on `arena/01a0b92e-student-os-main`.

Staged individually (never `git add .`): `eas.json`, `FIX-RELEASE-REPORT.md`.

## Files changed
1. `eas.json` — modified (1 line)
2. `FIX-RELEASE-REPORT.md` — created (this report)

## Next step (PO-side)
Rebuild: `eas build -p android --profile preview` from the FIX-RELEASE commit (the arena tip — SHA in the final chat report / `git log`), sideload the new APK, and confirm the app no longer shows Local Mode / "Google sign-in (needs Supabase)" — i.e., blocker B1 cleared. Device QA §8 of FIX-AUTH-REPORT.md still applies (defining acceptance: launch with no Metro running).
