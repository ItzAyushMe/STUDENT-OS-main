# 🎓 StudentOS

**Level Up Your Life. One Quest at a Time.**

A free, gamified, AI-powered all-in-one study app for Indian students (Class 6 → college).
Built with **React Native + Expo** (one codebase → Android, iOS, Web) and **Supabase** (Postgres, auth, storage, row-level security), with an AI layer that switches between **Google Gemini** and **Groq (Llama 3.3)** with a single setting.

> Non-commercial, made for fellow students. Warm, encouraging, lightly Hinglish — *“Shaabaash!”*

---

## ✨ Features

| Tab | What's inside |
|---|---|
| 🏠 **Home** (Gamer mode) | XP counter, level badge, streak 🔥, tier progress, today's main + side quests, habit status, **AI status banner** (know instantly if Professor Byte needs a key), **personalized AI morning message** (class + today's plan + weak areas), quote of the day, “Start My Day” (+5 XP), daily challenge, quick actions |
| 📚 **Study** (Light mode) | **Track-scoped Syllabus map** — 🏫 My Class (default, Class 6–12 + college, per-class NCERT-style datasets) / 🏅 My Olympiad (IOQM, IMO, NSO, NSEP, NSEC) / 🎯 My Exam (JEE, NEET, NTSE) — your class ALWAYS wins over the exam track. Smart Schedule (**priority: class → olympiad → exam**, school-exam aware with 2-week buffers, revision waves, mock days, **timed practice**, buffer days, AI catch-up plan), Deadline Sheet (mission board, danger zone, school-exam-aware auto-planning), **Professor Byte** AI tutor, flashcards with spaced repetition + AI deck generation, quiz arena (quick / standard / daily / boss battle — AI questions from YOUR syllabus), content locker with AI summaries |
| ⏱️ **Focus** (Light mode) | Pomodoro 25/5 · 15/3 · 90/20 · custom, smooth circular ring, ambient sounds (rain/ocean/lofi/white noise), **Focus Shield** (triggers on app/tab switch, 30s “are you sure?” delay + distraction log), **empathetic quote every 20 minutes** of deep work, focus history & weekly bar chart, post-session reflection (1–5 + note) |
| 💪 **Life** (Light mode) | Habit tracker (morning/afternoon/evening, weekly dots, per-habit streaks, 🧊 streak freeze, **edit + remove habits**, **AI habit suggestions** based on your class), gym tracker (4 prebuilt plans, sets/reps/weight logging, PRs, **responsive stacked layout on narrow phones**, weekly consistency), daily wisdom (morning quote, evening mood check-in, weekly AI reflection) |
| 🏆 **Guild** (Gamer mode) | Friends (username requests + QR), weekly leaderboard (resets Monday, XP breakdown by study/habit/gym/social, 7 tiers), activity feed with cheers, **Daily Arena** (AI questions from YOUR class syllabus, global daily ranking), battles (**class-aware AI questions** vs a friend, winner bonus) |

**XP engine** (all rules centralized in `src/config/constants.js`):

| Action | XP |
|---|---|
| Focus session | 1 XP per minute (25 min = 25 XP) |
| Complete a study quest | +30 |
| Finish a chapter / topic | +100 |
| Quiz ≥ 90% | +50 (plus +20/+40 for finishing) |
| Habit done | +10 |
| Workout logged | +30 |
| Daily login (“Start My Day”) | +5 |
| Create / review flashcard | +10 / +15 |
| Arena: per correct / finish | +10 / +20 |
| Battle: fought / won | +25 / +60 |

Levels: 100 XP each (configurable). Tiers: 🥉 Bronze 0–5k · 🥈 Silver 5–15k · 🥇 Gold 15–30k · 💎 Diamond 30–60k · 👑 Master 60–100k · 🌟 Legendary 100–150k · ⚡ Grandmaster 150k+. Streaks survive one missed day with a 🧊 freeze (max 3, earn 1 per 7-day streak).

### 🧠 The AI is the engine (not a bolt-on chatbot)

Every AI feature routes through one swappable service (`src/lib/aiService.js` → Gemini/Groq with auto-fallback + model fallback) and always knows **who you are**: class, board, exam, olympiad and prep level are injected into every prompt.

| Where | What the AI does |
|---|---|
| Home | Personalized morning message referencing your real schedule + weak areas |
| Scheduler | Class-aware planning (class → olympiad → exam priority) + AI catch-up advice on reschedule |
| Quizzes / Arena / Battles | Questions generated from YOUR class syllabus chapters — never generic trivia |
| Flashcards | Auto-generate decks from any topic |
| Habits | Suggests tiny class-relevant habits that complement existing ones |
| Syllabus | Generates/import per-track syllabus sets for any class 6–12 + college |
| Wisdom | Weekly reflection with wins + next week's plan |
| Tutor | Professor Byte: explains, solves, quizzes, motivates |

School exams (mid-terms/finals) can be added in **Onboarding → step 3** or **Settings → My School Exams** — the scheduler then finishes your class syllabus ~2 weeks before each exam, with revision waves, mock tests, timed practice and buffer days.

---

## 🚀 Quick start

Requirements: **Node 18+** and npm.

```bash
npm install
npx expo start          # press w for web, scan QR with Expo Go for Android/iOS
```

Sanity-check the core engines any time (XP, streaks, schedule planner, arena determinism):

```bash
npm run test:logic
```

With no `.env` at all, the app runs in **Local Mode** — everything works offline on the device (guest/local accounts, demo rivals in the Guild, bundled question bank for quizzes/arena). Add Supabase + AI keys whenever you're ready; nothing else changes.

---

## ☁️ Supabase setup (cloud accounts, sync, real friends)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**. This creates all 15 tables with row-level security (each student can only touch their own rows; leaderboard/arena/friends data is shared as needed).
3. Copy your **Project URL** and **anon public key** from **Settings → API**.
4. Create `.env` in the project root:

```bash
cp .env.example .env
```

```env
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

5. Restart `npx expo start`. New users can now sign up with email/password. Profile rows are created automatically on first login.

**Google sign-in (optional):** in Supabase → Authentication → Providers, enable Google and add your client ID/secret. Then add your app's redirect URL to **Authentication → URL Configuration**:
- Web: `http://localhost:8081` (and your deployed URL)
- Android/iOS deep link: `studentos://auth-callback`

**Email confirmations:** Authentication → Providers → Email → disable “Confirm email” if you want instant sign-in during testing.

---

## 🤖 AI setup (Gemini + Groq)

All AI features go through one module — `src/lib/aiService.js` — with automatic fallback: if the primary provider fails, the other is tried.

1. Get keys:
   - Google Gemini: https://aistudio.google.com/apikey (model `gemini-2.0-flash`)
   - Groq: https://console.groq.com/keys (model `llama-3.3-70b-versatile`)
2. Add to `.env`:

```env
EXPO_PUBLIC_GEMINI_API_KEY=AIza...
EXPO_PUBLIC_GROQ_API_KEY=gsk_...
```

**Switching providers** — pick whichever you like:

- `.env`: `EXPO_PUBLIC_AI_PROVIDER=groq` (or `gemini`)
- Config: `AI_PROVIDER` in `src/config/constants.js`
- **At runtime:** Settings screen (gear icon on Home) → provider toggle + paste keys + “Test AI” button

Without keys, AI features (tutor chat, AI quizzes/decks/summaries/reflections) show a friendly message instead of crashing, while offline engines (deterministic schedule planner, bundled question bank, flashcard quizzes) keep everything usable.

> ⚠️ `EXPO_PUBLIC_*` keys are embedded in the app bundle (standard for client-side Gemini/Groq usage). Use key restrictions on the Google console for production.

---

## 📦 v1.0.2 — Community Fix Pack

Eleven reported bugs + the big feature requests, all in:

| # | Fix |
|---|---|
| 1 | **`created_at` schema crash** — `habit_logs` was missing the column the data layer stamps on every insert. `schema.sql` now creates it + an idempotent MIGRATIONS section at the bottom fixes **existing** projects (just re-run the file in the SQL editor). |
| 2 | **Syllabus had only Science/Maths** — every class (6–12) now has English, Hindi, Computer Science/AI and full SST (History, Political Science, Geography, Economics) with real NCERT chapters. |
| 3 | **Priorities rework** — hide/eye toggle removed (all tracks always visible, **0% = skip**), custom tracks can be added (optionally claiming subjects so those chapters get their own budget) and removed with a confirm. Saving now offers to regenerate the schedule immediately. |
| 4 | **Gym custom exercises** — add your own (persisted on the profile), remove with ✕, sets/reps/weight logging works for them too. |
| 5 | **Locker links didn't open** — URLs are normalized (`https://` prepended when missing) on open *and* on save. |
| 6/10/11 | **Smart Schedule & Deadline Sheet** — deterministic engine always generates (never AI-dependent); AI only advises. Groq is the primary provider with automatic Gemini fallback, retry-with-backoff, strict JSON contracts, and visible loading/error+retry states. The Schedule screen shows the live priority order so it's obvious the setting applied. |
| 7 | **No demo bots online** — demo feed now also gated to Local Mode (leaderboard/friends already were), an "ONLINE MODE" indicator sits at the top of the Guild, and cloud mode with no friends shows an honest "invite your classmates" empty state. |
| 8 | **Groq primary + no Markdown** — `llama-3.3-70b-versatile` is the default and the persona bans markdown; a `stripMarkdown` safety net cleans any that slips through. |
| 9 | **Half-complete screens** — all load paths end in data, an empty state, or an error+retry card; nothing hangs. |
| — | **AI Test Builder** (Study hub): 2-set printable tests, question banks and per-chapter mind maps with a difficulty dial (0–200%), chapter picker and MCQ/VSAQ/SAQ/LAQ breakdown. Web builds export via Print → Save as PDF. |
| — | **Study Arcs** — after onboarding you can opt into Winter Arc (90d), Summer Arc (60d) or 75-Day Hard; the schedule's daily hours get boosted and a themed progress banner tracks your run. |
| — | **Onboarding trimmed** to Class 9–12 (board-exam focus). Existing Class 6–8 profiles keep working. |
| — | **Delete account** in Settings (double confirm, wipes all rows + local data). |
| — | **Free Library: Class 10 CBSE teacher pack** — the community's favourite free teachers per subject (Alakh Pandey, Prashant Kirad, Shobhit Nirwan, Digraj Singh Rajput, Sunlike Study, Dear Sir, Hindi Adhyapak, Magnet Brains, PW notes). |
| — | **Back button** always lands on the section hub (Life/Study/Focus), never jumps to Home. |

New quote in the pool: *"Nothing feels easy when you are lazy, everything feels easy when you are crazy."*

## 🌐 Going Online (Production Setup) — v1.0

The app is already cloud-ready — going online is **configuration, not code**. Two modes, switched automatically by whether Supabase is configured:

| | 📱 Local Mode (default) | ☁️ Cloud Mode (the real online app) |
|---|---|---|
| Trigger | `.env` has no Supabase URL/key | `.env` has `EXPO_PUBLIC_SUPABASE_URL` + anon key |
| Storage | Device-only (AsyncStorage) | PostgreSQL |
| Auth | Guest / device accounts | Email + Google sign-in |
| Guild players | Demo rivals (Arjun, Priya…) | Real friends from the database |
| Sync | Not synced | Synced across devices |

Demo rivals are gated behind Local Mode (`isRemote()` in `src/screens/guild/GuildScreen.js`) — they vanish automatically in Cloud Mode.

### Steps

1. **Create the database**: supabase.com → New project (region: Mumbai/Singapore) → **SQL Editor** → paste the whole `supabase/schema.sql` → Run. Already have a project? Re-run the file — the MIGRATIONS section at the bottom is idempotent and patches older databases (adds `habit_logs.created_at`, `users.arc`, `users.custom_exercises`). This creates all tables with Row-Level Security. *(Skipping this is the #1 cause of "backend doesn't work".)*
2. **Flip to Cloud Mode**: `cp .env.example .env`, then from Supabase → Settings → API paste:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   ```
   Add your AI keys too (`EXPO_PUBLIC_GEMINI_API_KEY` / `EXPO_PUBLIC_GROQ_API_KEY`).
3. **Enable Google sign-in**: Supabase → Authentication → Providers → Google → Enable; create OAuth credentials in Google Cloud Console (Web application) with the redirect URI Supabase shows (`https://YOUR-PROJECT-ref.supabase.co/auth/v1/callback`); paste Client ID/Secret into the Supabase provider screen. Add your app URLs under Authentication → URL Configuration (web: `http://localhost:8081` + your deployed URL; mobile: `studentos://auth-callback`).
4. **(Optional) pure online release**: set `EXPO_PUBLIC_CLOUD_ONLY=1` in `.env` — guest login is hidden, demo rivals never render, and without a backend the auth screen shows clear setup instructions instead of falling back to local data.
5. **Restart**: `npx expo start -c` (env vars load at startup only).
6. **Verify**: sign in with Google → complete onboarding → add a habit → see the row appear in Supabase's Table Editor. Guild shows real/empty friends state, no demo rivals.

### Build & release

```bash
npm install -g eas-cli
eas login                    # free Expo account
eas build:configure
eas build -p android --profile preview    # installable APK to share
eas build -p android --profile production # Play Store AAB
```

Web: `npx expo export --platform web` → deploy `dist/` to Vercel/Netlify (enable SPA fallback). Add an Android package id in `app.json` (e.g. `com.yourname.studentos`) before building.

## 🔑 Google Sign-In setup (Supabase cloud mode)

StudentOS ships with the full Google OAuth flow wired (`src/lib/auth.js`). To switch it on in YOUR Supabase project:

1. **Supabase → Authentication → Providers → Google** → enable it.
2. **Google Cloud Console** (console.cloud.google.com, free): create OAuth credentials → "Web application".
   - Add the **Authorized redirect URI** Supabase shows you (looks like `https://PROJECT-ref.supabase.co/auth/v1/callback`).
3. Copy the Google **Client ID** and **Client Secret** into the Supabase provider screen.
4. Make sure your `.env` has the Supabase URL + anon key (see `.env.example`) — Google sign-in only exists in cloud mode.
5. In the app: Auth screen → **Continue with Google**. On web it redirects and returns with the session; on mobile it opens the auth popup.

No hardcoded keys anywhere — everything reads from `EXPO_PUBLIC_*` env vars. The app runs fully in Local Mode without them.

## 📱 Building the Android APK

**Easiest — EAS Build (cloud, no Android Studio needed):**

```bash
npm install -g eas-cli
eas login                    # free Expo account
eas build:configure
eas build -p android --profile preview
```

Add to `app.json` before building (EAS asks automatically too):

```json
"android": { "package": "com.yourname.studentos" }
```

`--profile preview` produces an **installable APK** (share the link, sideload on any phone). Use `--profile production` for the Play Store (AAB).

**Local build (needs Android Studio + SDK):**

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

**Test on your phone instantly:** install [Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent), run `npx expo start`, scan the QR code.

## 🍎 iOS

```bash
eas build -p ios            # requires Apple Developer account for device install
```

## 🌐 Web build & deploy

```bash
npx expo export --platform web     # outputs static site to dist/
npx serve dist                     # local preview
```

Deploy `dist/` to any static host (Vercel, Netlify, GitHub Pages — add a SPA fallback to `index.html`).

---

## 🗂️ Project structure

```
├── App.js                        # entry — fonts + providers + navigator
├── app.json                      # Expo config (name, icons, package id)
├── .env.example                  # environment template
├── supabase/schema.sql           # all 15 tables + RLS policies
├── scripts/generate-sounds.mjs   # procedural ambient sounds/SFX generator
├── assets/                       # icons + sounds
└── src/
    ├── config/
    │   ├── constants.js          # APP_NAME, tagline, AI_PROVIDER, XP rules, tiers,
    │   │                         #   onboarding options, habit presets, gym plans,
    │   │                         #   quotes, syllabus presets
    │   └── theme.js              # dual theme (GAMER dark-neon / LIGHT minimal)
    ├── lib/
    │   ├── supabase.js           # client (or null in local mode)
    │   ├── db.js                 # ONE data API -> Supabase or AsyncStorage
    │   ├── auth.js               # email/password + Google + guest
    │   ├── aiService.js          # the ONLY AI module (Gemini + Groq + fallback + cache)
    │   ├── aiFeatures.js         # every AI feature (tutor, quizzes, decks, summaries…)
    │   ├── xpService.js          # XP / level / tier / streak engine
    │   ├── scheduleGenerator.js  # offline smart schedule + deadlines + rescheduling
    │   ├── quizBank.js           # 60+ bundled questions, date-seeded Daily Arena
    │   ├── soundService.js       # ambient loops + SFX (expo-audio / HTMLAudio)
    │   ├── starterData.js        # first-run seeding (habits, syllabus)
    │   ├── guildData.js          # leaderboard sync, demo rivals (local mode)
    │   ├── alert.js              # cross-platform alerts
    │   └── utils.js              # dates, seeded randomness, formatting
    ├── context/                  # Theme, Settings, Auth, Game (XP/level-ups), Focus
    ├── hooks/useIsOnline.js
    ├── components/
    │   ├── ui/                   # Screen, headers, buttons, cards, inputs, chips…
    │   ├── gamer/                # pixel text, XP counter, badges, confetti, overlays
    │   └── focus/ShieldOverlay.js
    └── screens/
        ├── auth/ onboarding/     # login + 5-step setup + reveal
        ├── home/                 # gamer dashboard
        ├── study/                # hub, syllabus, topic, schedule, deadlines,
        │                         #   tutor chat, flashcards, deck, quiz, content
        ├── focus/                # pomodoro + stats
        ├── life/                 # hub, habits, gym, wisdom
        ├── guild/                # feed/leaderboard/friends, arena, battles
        └── settings/
```

---

## 🎨 Design system (dual theme)

- **Gamer mode** (Home + Guild + XP UI + nav bar): `#0D1117` background, `#161B22` surfaces, `#21262D` cards, neon purple `#7C3AED`, cyan `#06B6D4`, green `#10B981`, XP gold `#FFD700`, **Press Start 2P** pixel font for headings/XP, subtle glow on active nav items.
- **Light mode** (Study / Focus / Life): `#F8FAFC` background, `#FFFFFF` surfaces, `#F1F5F9` cards, purple `#6D28D9`, cyan `#0891B2`, **Inter** body font — calm, no neon, no pixel.
- Screens declare their mode (`useTheme('light')`); the switch fades in over ~280 ms.
- Animations are deliberately lightweight (native-driver `Animated`, ~22-particle confetti, bouncing flame, SVG progress ring) so the app stays smooth on low-end Android phones.

## ⚡ Offline & performance notes

- **Local Mode** makes the whole app usable with zero setup; core tools (syllabus, schedule, timer, habits, flashcards, quizzes from the bank/your cards, gym, wisdom) never need internet.
- Offline banner on Home; AI calls check connectivity first and degrade gracefully.
- Lists are memoized row components; animations use `useNativeDriver`; no heavy 3D or continuously-running animations; sounds are tiny procedurally-generated WAVs.

## 🧪 Troubleshooting

| Problem | Fix |
|---|---|
| `expo` commands fail with TLS/network errors in CI | prefix with `EXPO_OFFLINE=1` |
| Web shows blank page | check the browser console; make sure `npm install` ran with `react-dom` + `react-native-web` present |
| “AI keys missing hai” | add keys in `.env` **and restart** `expo start` (env vars are baked at bundle time), or use the Settings screen for runtime keys |
| Google sign-in loops | add the exact redirect URLs in Supabase → Auth → URL Configuration |
| Reset everything (local mode) | Settings → Reset local data |

---

Made with ❤️, chai and a lot of `+XP`. Free forever — padhai rakhna, game strong rakhna! 🚀
