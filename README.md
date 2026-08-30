# 🎓 StudentOS

**Level Up Your Life. One Quest at a Time.**

A free, gamified, AI-powered all-in-one study app for Indian students (Class 6 → college).
Built with **React Native + Expo** (one codebase → Android, iOS, Web) and **Supabase** (Postgres, auth, storage, row-level security), with an AI layer that switches between **Google Gemini** and **Groq (Llama 3.3)** with a single setting.

> Non-commercial, made for fellow students. Warm, encouraging, lightly Hinglish — *“Shaabaash!”*

---

## ✨ Features

| Tab | What's inside |
|---|---|
| 🏠 **Home** (Gamer mode) | XP counter, level badge, streak 🔥, tier progress, today's main + side quests, habit status, quote of the day, “Start My Day” (+5 XP), daily challenge, quick actions |
| 📚 **Study** (Light mode) | Syllabus map (subjects → chapters, ✅/🔄/🔒 + weightage ⭐), Smart Schedule (daily time-blocks, weekly grid, monthly calendar with mock/revision highlights), Deadline Sheet (mission board, danger zone, auto-planning from exam date), **Professor Byte** AI tutor, flashcards with spaced repetition, quiz arena (quick / standard / daily / boss battle), content locker with AI summaries |
| ⏱️ **Focus** (Light mode) | Pomodoro 25/5 · 15/3 · 90/20 · custom, smooth circular ring, ambient sounds (rain/ocean/lofi/white noise), **Focus Shield** (soft nudge + 30s delay + distraction log), focus history & weekly bar chart, post-session reflection (1–5 + note) |
| 💪 **Life** (Light mode) | Habit tracker (morning/afternoon/evening, weekly dots, per-habit streaks, 🧊 streak freeze), gym tracker (4 prebuilt plans, sets/reps/weight logging, PRs, weekly consistency), daily wisdom (morning quote, evening mood check-in, weekly AI reflection) |
| 🏆 **Guild** (Gamer mode) | Friends (username requests + QR), weekly leaderboard (resets Monday, XP breakdown by study/habit/gym/social, 7 tiers), activity feed with cheers, **Daily Arena** (same 5 questions for everyone, global daily ranking), battles (same timed quiz vs a friend, winner bonus) |

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
