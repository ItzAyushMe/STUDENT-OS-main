-- FIX-GYM migration: gym cohesion round — edit/delete everywhere + last-session prefill + bodyweight finish + CSV import + split memory
-- Adds gym_overrides jsonb (built-in edits as overrides) and custom_splits jsonb (per-day memory)
alter table public.users add column if not exists gym_overrides jsonb default '{}'::jsonb;
alter table public.users add column if not exists custom_splits jsonb default '{}'::jsonb;
-- also ensure custom_exercises already exists (from earlier migration)
-- reload pgrst
notify pgrst, 'reload schema';
