-- ============================================================
-- StudentOS — Supabase schema (PostgreSQL)
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor ->
-- New query -> paste -> Run). Safe to re-run (idempotent).
--
-- Row-Level Security: every user can only read/write their own
-- rows, except shared data (leaderboard, arena results, friends)
-- which is readable by authenticated users as noted.
-- ============================================================

-- ---------- helper ----------
create extension if not exists "pgcrypto";

-- ============================================================
-- USERS (public profile — one row per auth user)
-- ============================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  email text,
  display_name text,
  avatar_url text,
  class_level text,
  board text,
  competitive_exam text,
  olympiad text,
  olympiad_date date,
  school_exams jsonb default '[]',
  priorities jsonb default null, -- { order, enabled, timeSplit } for the scheduler
  arc jsonb default null,        -- { id: winter|summer|hard75, start_date, day } study arc opt-in
  custom_exercises jsonb default '[]', -- user-added gym exercises
  exam_date date,
  daily_study_hours numeric default 2,
  preferred_time text,
  prep_level text,
  days_off jsonb default '[]',
  commitments text,
  total_xp integer default 0,
  current_streak integer default 0,
  longest_streak integer default 0,
  streak_freezes integer default 2,
  last_active_date date,
  level integer default 1,
  tier text default 'Bronze',
  privacy text default 'friends',          -- public | friends | private
  onboarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.users enable row level security;

drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
  on public.users for select to authenticated using (true);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
  on public.users for insert to authenticated with check (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users for update to authenticated using (auth.uid() = id);

-- ============================================================
-- SYLLABUS
-- ============================================================
create table if not exists public.syllabus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  chapter text not null,
  topic text,
  subtopic text,
  track text default 'class' check (track in ('class','olympiad','exam') or track like 'custom:%'), -- custom priority tracks (v1.0.2)
  weightage integer default 3 check (weightage between 1 and 5),
  estimated_hours numeric default 4,
  status text default 'locked' check (status in ('locked','in_progress','completed')),
  progress_percent integer default 0 check (progress_percent between 0 and 100),
  deadline date,
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table public.syllabus enable row level security;

drop policy if exists "syllabus_own" on public.syllabus;
create policy "syllabus_own"
  on public.syllabus for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- SCHEDULE (time-blocked sessions / quests)
-- ============================================================
create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_time text,
  end_time text,
  subject text,
  topic text,
  session_type text default 'study' check (session_type in ('study','revision','practice','quiz','mock','gym','break')),
  track text default 'class' check (track in ('class','olympiad','exam') or track like 'custom:%'), -- custom priority tracks (v1.0.2)
  status text default 'pending' check (status in ('pending','completed','skipped')),
  duration_minutes integer default 45,
  priority text default 'normal',
  created_at timestamptz default now()
);

alter table public.schedule enable row level security;

drop policy if exists "schedule_own" on public.schedule;
create policy "schedule_own"
  on public.schedule for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- FOCUS SESSIONS
-- ============================================================
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz,
  end_time timestamptz,
  duration_minutes integer default 25,
  mode text default 'classic',            -- classic | sprint | deep | custom
  topic text,
  focus_rating integer check (focus_rating between 1 and 5),
  reflection text,
  xp_earned integer default 0,
  distractions integer default 0,
  created_at timestamptz default now()
);

alter table public.focus_sessions enable row level security;

drop policy if exists "focus_own" on public.focus_sessions;
create policy "focus_own"
  on public.focus_sessions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- HABITS
-- ============================================================
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text default 'academic' check (category in ('academic','health','mental','productivity')),
  icon text default '🎯',
  part text default 'morning',            -- morning | afternoon | evening
  target_time text,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table public.habits enable row level security;

drop policy if exists "habits_own" on public.habits;
create policy "habits_own"
  on public.habits for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- HABIT LOGS (one row per habit per day; frozen saves streaks)
-- ============================================================
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  completed boolean default false,
  frozen boolean default false,
  completed_at timestamptz,
  streak_count integer default 0,
  -- app data layer stamps every inserted row with created_at (BUG #1 fix)
  created_at timestamptz default now()
);

alter table public.habit_logs enable row level security;

drop policy if exists "habit_logs_own" on public.habit_logs;
create policy "habit_logs_own"
  on public.habit_logs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists habit_logs_user_date on public.habit_logs (user_id, date);

-- ============================================================
-- FLASHCARDS (spaced repetition)
-- ============================================================
create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text,
  topic text,
  front_text text not null,
  back_text text not null,
  card_type text default 'qa',            -- qa | definition | formula | concept
  mastery_level integer default 0 check (mastery_level between 0 and 5),
  next_review timestamptz default now(),
  times_reviewed integer default 0,
  created_at timestamptz default now()
);

alter table public.flashcards enable row level security;

drop policy if exists "flashcards_own" on public.flashcards;
create policy "flashcards_own"
  on public.flashcards for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- QUIZ RESULTS (arena/battle rows are readable for rankings)
-- ============================================================
create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text,
  topic text,
  mode text default 'quick',              -- quick | standard | daily | boss | arena | battle
  total_questions integer default 5,
  correct_answers integer default 0,
  accuracy integer default 0,
  time_taken integer default 0,
  xp_earned integer default 0,
  weak_topics jsonb default '[]',
  created_at timestamptz default now()
);

alter table public.quiz_results enable row level security;

drop policy if exists "quiz_own" on public.quiz_results;
create policy "quiz_own"
  on public.quiz_results for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "quiz_arena_read" on public.quiz_results;
create policy "quiz_arena_read"
  on public.quiz_results for select to authenticated
  using (mode in ('arena','battle'));     -- global daily arena/battle boards

create index if not exists quiz_results_mode_date on public.quiz_results (mode, created_at);

-- ============================================================
-- CONTENT (notes / links / files + AI summaries)
-- ============================================================
create table if not exists public.content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text default 'note' check (type in ('pdf','image','link','note','youtube','audio')),
  url text,
  text text,
  subject text,
  topic text,
  ai_summary text,
  file_size numeric,
  created_at timestamptz default now()
);

alter table public.content enable row level security;

drop policy if exists "content_own" on public.content;
create policy "content_own"
  on public.content for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- FRIENDS
-- ============================================================
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,  -- requester
  friend_id uuid not null references auth.users(id) on delete cascade, -- requestee
  friend_name text,
  status text default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz default now(),
  unique (user_id, friend_id)
);

alter table public.friends enable row level security;

drop policy if exists "friends_participants" on public.friends;
create policy "friends_participants"
  on public.friends for select to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "friends_insert_own" on public.friends;
create policy "friends_insert_own"
  on public.friends for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "friends_update_own" on public.friends;
create policy "friends_update_own"
  on public.friends for update to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "friends_delete_own" on public.friends;
create policy "friends_delete_own"
  on public.friends for delete to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);

-- ============================================================
-- LEADERBOARD (weekly, resets Monday — app upserts weekly rows)
-- ============================================================
create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  total_xp integer default 0,
  study_xp integer default 0,
  habit_xp integer default 0,
  gym_xp integer default 0,
  social_xp integer default 0,
  rank integer,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

alter table public.leaderboard enable row level security;

drop policy if exists "leaderboard_read_all" on public.leaderboard;
create policy "leaderboard_read_all"
  on public.leaderboard for select to authenticated using (true);

drop policy if exists "leaderboard_write_own" on public.leaderboard;
create policy "leaderboard_write_own"
  on public.leaderboard for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists leaderboard_week on public.leaderboard (week_start, total_xp desc);

-- ============================================================
-- DEADLINES (mission board snapshots; syllabus.deadline is the
-- source of truth — this table stores ad-hoc exam deadlines)
-- ============================================================
create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_type text,
  topic text,
  deadline_date date,
  status text default 'pending' check (status in ('pending','in_progress','completed','missed')),
  priority text default 'normal',
  created_at timestamptz default now()
);

alter table public.deadlines enable row level security;

drop policy if exists "deadlines_own" on public.deadlines;
create policy "deadlines_own"
  on public.deadlines for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- XP EVENTS (append-only log powering streaks + weekly boards)
-- ============================================================
create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  category text default 'misc',           -- study | habit | gym | social | misc
  amount integer not null default 0,
  label text,
  meta jsonb,
  created_at timestamptz default now()
);

alter table public.xp_events enable row level security;

drop policy if exists "xp_events_own" on public.xp_events;
create policy "xp_events_own"
  on public.xp_events for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- friends can read each other's XP events (activity feed)
drop policy if exists "xp_events_friends_read" on public.xp_events;
create policy "xp_events_friends_read"
  on public.xp_events for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friends f
      where f.status = 'accepted'
        and (
          (f.user_id = auth.uid() and f.friend_id = xp_events.user_id)
          or (f.friend_id = auth.uid() and f.user_id = xp_events.user_id)
        )
    )
  );

create index if not exists xp_events_user_date on public.xp_events (user_id, created_at desc);

-- ============================================================
-- MOOD LOGS (daily wisdom / mental health check-ins)
-- ============================================================
create table if not exists public.mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood integer check (mood between 1 and 5),
  note text,
  ai_reply text,
  created_at timestamptz default now()
);

alter table public.mood_logs enable row level security;

drop policy if exists "mood_logs_own" on public.mood_logs;
create policy "mood_logs_own"
  on public.mood_logs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- WORKOUT LOGS (gym tracker)
-- ============================================================
create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  plan_name text,
  exercises jsonb default '[]',           -- [{name, sets, reps, weight}]
  xp_earned integer default 30,
  created_at timestamptz default now()
);

alter table public.workout_logs enable row level security;

drop policy if exists "workout_logs_own" on public.workout_logs;
create policy "workout_logs_own"
  on public.workout_logs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- (Optional) STORAGE bucket for content files
-- Run manually if you plan to upload PDFs/images from the app.
-- ============================================================
-- insert into storage.buckets (id, name, public)
--   values ('content', 'content', false)
--   on conflict (id) do nothing;
--
-- create policy "content_storage_own"
--   on storage.objects for all to authenticated
--   using (bucket_id = 'content' and (storage.foldername(name))[1] = auth.uid()::text)
--   with check (bucket_id = 'content' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Done! 🎉
-- ============================================================

-- ============================================================
-- MIGRATIONS (idempotent — safe to run on an EXISTING project)
-- Re-running this whole file on an old database applies these too.
-- ============================================================

-- BUG #1 (v1.0.1): the app data layer (src/lib/db.js) stamps every
-- inserted row with created_at. habit_logs was the only table missing
-- the column, so every habit save failed with
-- "Could not find the 'created_at' column of 'habit_logs'".
alter table public.habit_logs
  add column if not exists created_at timestamptz default now();

-- Defensive: make sure every table the app writes to has created_at.
alter table public.users        add column if not exists created_at timestamptz default now();
alter table public.syllabus     add column if not exists created_at timestamptz default now();
alter table public.schedule     add column if not exists created_at timestamptz default now();
alter table public.focus_sessions add column if not exists created_at timestamptz default now();
alter table public.habits       add column if not exists created_at timestamptz default now();
alter table public.flashcards   add column if not exists created_at timestamptz default now();
alter table public.quiz_results add column if not exists created_at timestamptz default now();
alter table public.content      add column if not exists created_at timestamptz default now();
alter table public.friends      add column if not exists created_at timestamptz default now();
alter table public.leaderboard  add column if not exists created_at timestamptz default now();
alter table public.deadlines    add column if not exists created_at timestamptz default now();
alter table public.xp_events    add column if not exists created_at timestamptz default now();
alter table public.mood_logs    add column if not exists created_at timestamptz default now();
alter table public.workout_logs add column if not exists created_at timestamptz default now();

-- v1.0.2: study arc (Winter Arc / Summer Arc / 75-Day Hard) opt-in
alter table public.users add column if not exists arc jsonb;

-- v1.0.2: custom priority tracks / custom gym exercises
alter table public.users add column if not exists custom_exercises jsonb;

-- v1.0.2 audit HIGH-2: allow custom priority tracks (track like 'custom:%')
-- in schedule/syllabus. Without this, generating a schedule with a custom
-- track fails on the CHECK constraint in Cloud Mode.
alter table public.schedule drop constraint if exists schedule_track_check;
alter table public.schedule add constraint schedule_track_check
  check (track in ('class','olympiad','exam') or track like 'custom:%');
alter table public.syllabus drop constraint if exists syllabus_track_check;
alter table public.syllabus add constraint syllabus_track_check
  check (track in ('class','olympiad','exam') or track like 'custom:%');
