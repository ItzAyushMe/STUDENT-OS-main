# FIX-J REPORT — Content Locker completion (uploads, XP guard, dedupe, search, metadata, malformed rows, ordering)

Round: FIX-J (per handoff — the ONLY spec). Branch: `arena/01a0b92e-student-os-main`. Base: `aaff30e` (accepted FIX-H battles).
Status: implemented, committed, pushed. STOPPED at the PO gate — nothing merged, main/recovery untouched.

## 1. What was implemented (handoff J1–J7 → where)

| ID | Requirement | Where |
|----|-------------|-------|
| J1 | Real file uploads: PDF / PNG·JPG·WEBP / MP3·M4A·WAV, ≤10 MB, validated BEFORE any network call, private bucket `content`, object name `{auth.uid()}/{uuid}.{ext}` | `src/lib/contentLocker.js` (validateUpload, storageObjectName, PICKER_MIME/EXT tables, MAX_UPLOAD_BYTES) + `ContentScreen.js` (pickFile / uploadBody / saveFile / signedUrlFor) |
| J2 | NOTE_CREATE once/day via existing xpOnce key `'note'` (hasEarnedToday/markEarnedToday); first save +5, later saves 0 XP but still succeed; save never depends on XP; no second guard mechanism | `applyNoteXp` (pure decision `noteXpDecision` + fully injected effects) used by BOTH `add()` and `saveFile()` AFTER the row insert |
| J3 | Dedupe: same normalized URL (case/scheme/trailing-slash-insensitive) for links; same title+text (case/whitespace-insensitive) for notes; message exactly "Already saved in your locker"; no insert; re-save works after delete | `normalizeUrl` / `urlDedupeKey` / `dedupeKeyOf` / `findDuplicate`; `add()` checks before insert and returns with zero writes |
| J4 | Client-side substring search over title/text/subject, composes with the type chip; no server search, no schema change | `matchesSearch` / `filterItems`; search Input bound to `query`; `shown = filterItems(items, { type: filter, query })` |
| J5 | Optional subject + chapter/topic fed from ACTIVE syllabus rows (S5 `activeSyllabusRows`, archived excluded); fills existing subject/topic columns; persisted + shown on card | `syllabusChoices` (double-filters archived itself); subject Input + subject chips + chapter chips in the Add modal; card renders `subject · topic` |
| J6 | Reject empty-after-trim title, non-http(s) links, invalid file type/size; malformed DB rows render a fallback card, never crash | visible gates in `add()`/`pickFile()`/`saveFile()`; `safeCard()` is a total function (null/junk/unknown type/missing fields → renderable card); list uses `key={item?.id || row-${idx}}`; `open()` guards URLs through `normalizeUrl` |
| J7 | Persistence cloud+local across reload; delete removes row AND storage object; created_at desc stable; Note/Link unbroken | unchanged `db` layer (supabase/AsyncStorage); `remove()` deletes the storage object FIRST and aborts visibly on failure; `sortItemsDesc` (created_at DESC, id tie-break) applied on every load |

## 2. Commit

- ONE commit, prefix `FIX-J:` — see `git log` on `arena/01a0b92e-student-os-main` (SHA recorded in the push verification below).
- Staged file-by-file (NO `git add .`): `package.json`, `package-lock.json`, `supabase/schema.sql`, `src/lib/contentLocker.js`, `src/screens/study/ContentScreen.js`, `scripts/logic-test.mjs`, `FIX-J-REPORT.md`.
- Excluded: `FIX-H-REPORT.md` (untracked scheduler-round artifact), `dist/` (gitignored build output, deleted).

## 3. Dependency addition (declared, as authorized)

- `expo-document-picker@~57.0.2` — the ONLY package change. `package-lock.json` diff contains nothing else. No `app.json`/`eas.json` changes were needed (the picker is autolinked by Expo; nothing demanded config changes, so no STOP was triggered).
- Installed via `npm install --save-prefix="~"` because `npx expo install` fails in the sandbox (TLS) — same resolved version either way.
- Audio playback reuses the EXISTING `expo-audio` (~57.0.4) and web `HTMLAudioElement` — no new audio dependency.

## 4. Storage gate — FILE ONLY, never executed by the agent

`supabase/schema.sql` now formalizes the previously commented "(Optional) STORAGE bucket" block (same bucket id, same policy text, plus `drop policy if exists` for idempotency):

```sql
insert into storage.buckets (id, name, public)
  values ('content', 'content', false)
  on conflict (id) do nothing;

drop policy if exists "content_storage_own" on storage.objects;
create policy "content_storage_own"
  on storage.objects for all to authenticated
  using (bucket_id = 'content' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'content' and (storage.foldername(name))[1] = auth.uid()::text);
```

- PO runs this AFTER reviewing this commit and BEFORE device tests. Pre-checks: `select id, public from storage.buckets;` and `select policyname from pg_policies where schemaname = 'storage';`.
- The app NEVER creates buckets, never generates public URLs, contains no `service_role` key, and reads only via short-lived signed URLs (TTL 300 s, never persisted).

## 5. Tests — `npm run test:logic` (the only test command)

- **After (working tree): 101 PASS / 0 FAIL, exit 0** — 83 pre-existing checks + 18 new FIX-J checks (J0, J1a, J1b, J1*, J1†, J2, J2*, J3, J3*, J4, J4*, J5, J5*, J6, J6*, J7, J7*, JREG).
- **Red-before (pristine `aaff30e` + only the new `scripts/logic-test.mjs` overlaid): all 18 J-checks FAIL** ("contentLocker.js import failed" — the module does not exist at the base commit; dynamic-import pattern records red instead of crashing), every pre-existing check still passes there. The tests genuinely fail on old code and pass on new.
- Pure checks prove the DECISIONS (validation, path shape, guard arithmetic, dedupe keys, search, choices, normalization, totality of safeCard, ordering) with injected fakes — no network, no device.
- `npx expo export --platform web`: exit 0 — the modified screen bundles; loose probes confirm the J strings ("Already saved in your locker", "Aaj ka note XP mil chuka") land in the bundle. `dist/` deleted afterwards (gitignored).

## 6. DEVICE / PO-RUNTIME items — NOT verified by me (labelled as wiring probes in the suite)

These are source-wiring probes only; they do NOT pretend to prove device behaviour:
1. Real upload of a PDF/image/audio on a physical device (web export proves bundling, not native upload).
2. Storage isolation 403 test: user B requesting a signed URL for user A's object must be denied by `content_storage_own`.
3. Picker cancel → no row, no upload, no XP.
4. Cloud + local persistence across app reload; delete-removes-storage-object on device.
5. Audio playback toggle on device (expo-audio path).

## 7. Declared deviations

1. **Native upload body**: handoff/notes suggested storage-js docs' base64→ArrayBuffer route for React Native; that needs `expo-file-system`, a SECOND dependency outside this round's authorization. Chosen instead: web → the picker's real `File`/Blob; native → hand-built `FormData` whose file part is the RN `{uri, name, type}` descriptor under the EMPTY field name — exactly the multipart shape storage-js itself builds for Blobs, and storage-js passes a FormData body through untouched (verified in the installed client's `src/packages/StorageFileApi.ts`; Android reads uri parts via `RequestBodyUtil`, iOS via `RCTNetworking`). If PO device testing rejects this path, the fallback fix is adding `expo-file-system` in a FUTURE authorized round.
2. **expo-av is absent** from this repo (handoff assumption was wrong); `expo-audio` ~57.0.4 is the existing audio lib and was reused.
3. **Local-mode file uploads are disabled** with the honest `LOCAL_UPLOAD_MESSAGE` (cloud-only; notes/links keep saving offline exactly as before — proven by the JREG probe that `add()` has no cloud gate).
4. **`jpeg` kept as a `jpg` alias** in the allowlist (matches the repo's existing detectType behaviour).
5. **"+5 XP per save." empty-state wording updated** to "Pehle save par +5 XP (din mein ek baar)." — the old copy became dishonest under the J2 daily cap. No committed test probe constrained that string (verified before changing).
6. **`urlDedupeKey` lowercases the whole normalized URL** (path included) — J3's "case-insensitive" applied to the dedupe KEY only; `normalizeUrl` itself preserves path case for display/open.

## 8. Preserved constraints (committed probes)

All hard-constraint probe strings survive in `ContentScreen.js`: FIX-F6 + "silent failure audit" (add/remove catches still visible), the FIX-D2 full-screen reader (`noteOpen`, `fullReaderOpen`, `full-screen note reader`, `maxHeight="92%"`, `maxHeight: 520`, `position: 'absolute'`, `zIndex: 9999`, `selectable`, `numberOfLines`, `ScrollView`). JREG asserts them, so a future round cannot silently drop them.

## 9. Security review

- Private bucket only; signed URLs with 300 s TTL created on open, never stored in rows (rows store the object NAME).
- Object names are `{uid}/{uuid}.{ext}` with uid ALWAYS the first path segment (`firstSegmentIsUser` proven; junk ids/extensions sanitized; no uid → no path → upload refused).
- No `getPublicUrl`, no `createBucket`, no `service_role` anywhere in this round (probes assert absence).
- No live DDL/Storage calls were made by the agent at any point.

## 10. Not touched (scope discipline)

No new tables/columns; `content` DDL unchanged; exam-picker UI, import-any-track, rollover (done as S5), AI features, battle/scheduler code, and the rest of the locker design beyond Add/list/search are untouched. The FIX-J schema text is exactly the gated storage block (probe-asserted).

## 11. Git/GitHub compliance

- Work only on `arena/01a0b92e-student-os-main`; exactly ONE commit starting `FIX-J:`; pushed to that branch only; no cherry-pick/merge/reset/force; `recovery/v1.0.6-studentos` and `main` untouched; PR #2 untouched; no PR settings modified.

## 12. Known limitations (honest)

- The logic suite proves pure decisions and source wiring — NOT UI rendering or native upload bytes (section 6).
- `hasEarnedToday` on a fresh cloud install falls back to the AsyncStorage device marker (existing xpOnce behaviour, unchanged by this round): the daily note-XP cap is per-device, same as the battle key.
- Search is substring-only over title/text/subject by design (J4); URLs are intentionally not searched (probe-asserted).

## 13. STOP

FIX-J is committed and pushed for PO review. Awaiting the PO gate: review this commit → run the storage DDL (section 4) → device tests (section 6). No further work performed.
