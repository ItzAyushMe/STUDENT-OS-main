-- FIX-HABIT-XP migration: habit difficulty with XP scaling
alter table public.habits add column if not exists difficulty text default 'medium';
notify pgrst, 'reload schema';
