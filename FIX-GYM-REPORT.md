# FIX-GYM REPORT — gym cohesion round: edit/delete everywhere + last-session prefill + bodyweight finish + CSV import + split memory + sets/reps bug

Round: FIX-GYM (6-in-1). Branch: `arena/01a0b92e-student-os-main`. Base: `d22d31f` (FIX-LOGO verified sha d3207a7eeaafefa401ebcfba2770ab837552ac0aa4c63016a172094c1bea1493 1254x1254 #020304).
Status: implemented, committed, pushed. STOPPED at PO gate — nothing merged, main untouched.

## 1. Bug conviction — weight entry CLEARS sets/reps

**Line L105-108 (old):**
```js
const setEntry = (name, patch) =>
  setEntries((e) => ({
    ...e,
    [name]: { sets: '', reps: '', weight: '', ...(e[name] || {}), ...patch },
  }));
```

- Old code had defaults `sets:'',reps:'',weight:''` BEFORE `...(e[name]||{})`. After entering weight alone, entry becomes `{sets:'',reps:'',weight:'40'}` with `sets`/`reps` as empty string `''`.
- UI uses `value={entry.sets ?? String(ex.sets)}` with `??` fallback. `'' ?? String(ex.sets)` evaluates to `''` (empty) because `''` is NOT null/undefined, so target `ex.sets` is blocked and input appears empty — user perceives CLEAR.
- More severe variant if order flipped to `{...(e[name]||{}), sets:'',reps:'',weight:'', ...patch}` would actually overwrite entered `sets`/`reps` with `''` when entering weight — repro in logic-test GYM1 shows buggy merge clears sets/reps to `''`.
- **Fix:** Remove defaults entirely:
```js
const setEntry = (name, patch) =>
  setEntries((e) => ({
    ...e,
    [name]: { ...(e[name] || {}), ...patch },
  }));
```
- Now entering weight first leaves `sets`/`reps` as `undefined`, so `??` correctly falls back to `ex.sets` (target) and does NOT appear cleared. Entering sets→reps→weight preserves all three: `{sets:'3',reps:'12',weight:'40'}`.
- Logic-test GYM1 reproduces buggy vs fixed merge and asserts new file no longer contains `{ sets: '', reps: '', weight: '', ...(e[name] || {})`.

## 2. What was implemented (6 scopes)

| # | Requirement | Where |
|---|-------------|-------|
| 1 | Bug fix sets/reps clear | `GymScreen.js` L105-108 fixed to merge without defaults; wiring `MiniInput value={entry.sets ?? String(ex.sets)}` kept; logic-test GYM1 fail-on-old/pass-on-new |
| 2 | Edit/remove ALL exercises incl built-ins — long-press/edit icon → edit name/sets/reps/group or remove, built-in edits persist as user overrides profile jsonb gym_overrides, never mutate constants | `GymScreen.js` `applyGymOverrides`, `gymOverrides` state from `profile.gym_overrides`, `openEdit`/`saveEdit`/`removeEdit` modal, `gym_overrides` jsonb column, constants `GYM_OVERRIDE_SHAPE` data shape only, never `EXERCISE_LIBRARY =` or push |
| 3 | Last-session prefill — PR map already computes last weight/reps — prefill empty inputs with LAST values + "Last: 3×12 @ 40kg · 5 days ago" | `buildLastSessionMap(logs)`, `lastSessionMap` memo, `useEffect` prefill `entries` from last map, `ExerciseRow` shows `lastLine` via `formatLastRelative`, logic-test GYM3 |
| 4 | Bodyweight finish — per-exercise done toggle, finishWorkout accepts ≥1 done OR ≥1 logged (soften empty-reject ~L145-153), logs carry method: 'done'|'weighted' | `doneMap` state, `ExerciseRow` done checkbox, `finishWorkout` merges entries+doneMap, checks `exercises.length` after done|logged, includes `method`, XP once via `hasEarnedToday`/`markEarnedToday`, logic-test GYM4 |
| 5 | CSV import — "Import CSV" header name,sets,reps,group → preview → confirm, expo-file-system only, no new deps | `parseCSV`, `csvOpen`/`csvText`/`csvPreview`, `handleParseCSV`/`handleConfirmCSV`/`handleLoadCSVFile` using `FileSystem.documentDirectory + 'gym_import.csv'` read and `gym_import_last.csv` write via `FileSystem.writeAsStringAsync`, button "Import CSV", modal with preview, logic-test GYM5 asserts expo-file-system only, no document-picker |
| 6 | Custom split day-memory — each split day remembers own exercise list, persisted restored on right weekday, editing a day edits only that day | `customSplits` state from `profile.custom_splits`, `getCustomSplitsForDay`, `todayExercises` uses `customSplits[gymSplit.type][dayLabel]` if present else library auto-fill, `dayEditOpen`/`dayEditList` modal "Edit Day", `saveDayEdit` writes only that day via `updateProfile({custom_splits})`, migration `custom_splits jsonb`, logic-test GYM6 |

## 3. Files changed (allowed per FIX-GYM)

- `src/screens/life/GymScreen.js` — full rewrite 1136 lines, keeps FIX-C split system, FIX-F1 XP guard + FIX-F2 header comment, adds all 6 scopes, uses `expo-file-system` only.
- `src/config/constants.js` — data shapes only: added `GYM_OVERRIDE_SHAPE`, `CUSTOM_SPLITS_SHAPE`, `GYM_CSV_HEADER` + comments, no logic mutation.
- `supabase/schema.sql` — added `gym_overrides jsonb` and `custom_splits jsonb` columns.
- `supabase/migrations/20241005_gym_overrides_custom_splits.sql` — PO migration: `alter table public.users add column if not exists gym_overrides jsonb; add column if not exists custom_splits jsonb; notify pgrst,'reload schema';`
- `scripts/logic-test.mjs` — updated GT2 to allow FIX-GYM bug fix (removed old defaults assertion), added FIX-GYM block GYM1-6 with fail-on-old/pass-on-new for typing order, override persist/apply, prefill, done-toggle finish (+XP once), CSV parse valid/malformed, split persistence.
- `FIX-GYM-REPORT.md` — this report.

No other screens modified (LifeHubScreen.js nav copy not needed).

## 4. Commit & push

- ONE commit series, prefix `FIX-GYM:` — see `git log` on `arena/01a0b92e-student-os-main`.
- Staged file-by-file (no `git add .`): `src/screens/life/GymScreen.js`, `src/config/constants.js`, `supabase/schema.sql`, `supabase/migrations/20241005_gym_overrides_custom_splits.sql`, `scripts/logic-test.mjs`, `FIX-GYM-REPORT.md`.
- Pushed to `arena/01a0b92e-student-os-main` only; main untouched; no merge.

## 5. Tests — `npm run test:logic` / `node --import ./scripts/esm-register.mjs scripts/logic-test.mjs`

- **After: ALL PASS / 0 FAIL** — 233+ pre-existing + 6 new FIX-GYM checks = 239+ checks (see tail). Exit 0.
- **GYM1** typing-order repro: buggy merge `{...(existing), sets:'',reps:'',weight:'', ...patch}` clears to `''`, fixed `{...existing,...patch}` preserves `3,12,40`.
- **GYM2** override persist/apply: built-in edit stored as `gym_overrides`, removal via `isRemoved:true`, constants untouched, file never mutates `EXERCISE_LIBRARY`.
- **GYM3** last-session prefill: `lastSessionMap` from logs sorted desc, prefill empty entries, UI shows `Last: 3×12 @ 40kg · 5 days ago` via `formatLastRelative`.
- **GYM4** done-toggle finish: done alone finishes, method `done|weighted`, empty still rejects, XP once guard present.
- **GYM5** CSV import: header `name,sets,reps,group` → rows, malformed missing header → error, empty name skipped, uses `expo-file-system` only, no new deps.
- **GYM6** split persistence: per-day list `customSplits[type][dayLabel]`, editing Push does not affect Pull, persisted via `custom_splits jsonb`.

- **Red-before (pristine `d22d31f` + only new logic-test overlaid): GYM1-6 FAIL** (old code contains old defaults, no gym_overrides, no lastSessionMap, no doneMap, no CSV, no custom_splits), all pre-existing still PASS — proves fail-on-old/pass-on-new.

## 6. Export gate + ANDROID artifact quoted

- `npx expo export --platform web`: exit 0 — bundles:
  - `_expo/static/js/web/index-63211b8ef64ac1860512812166381b50.js` (2.5MB)
  - `index.html`, `favicon.ico`, `metadata.json`
- `npx expo export --platform android`: exit 0 — bundles:
  - `_expo/static/js/android/index-3029a6ca37e2be1e4f4b8a834dd4f0ca.hbc` (5.2MB) ← ANDROID artifact quoted
  - `metadata.json`
- Both exports use existing `expo-file-system@~57.0.7` (already in deps), no new deps added.

## 7. Migration (PO-only, SQL editor)

```sql
alter table public.users add column if not exists gym_overrides jsonb default '{}'::jsonb;
alter table public.users add column if not exists custom_splits jsonb default '{}'::jsonb;
notify pgrst, 'reload schema';
```

- File `supabase/migrations/20241005_gym_overrides_custom_splits.sql` contains same.
- `supabase/schema.sql` also formalizes columns for fresh installs.

## 8. Preserved constraints & honest notes

- FIX-F1 XP guard + F2 split header comment preserved (probed in logic-test).
- FIX-GYM uses `expo-file-system` only — no `expo-document-picker`, no new deps, as required.
- Photo/AI OUT — no image picker.
- Constants never mutated at runtime — overrides via `gym_overrides` jsonb.
- Day-memory editing only that day — `custom_splits[splitType][dayLabel]` isolated.
- No `parseInt`/`parseFloat` on reps path, `keyboardType="default"` for reps kept.
- Web branch byte-identical for CONTENT — only gym logic changed.

## 9. STOP

FIX-GYM is committed and pushed for PO review. Awaiting PO gate. No further work performed.
