alter table public.workouts
    add column if not exists activity_data jsonb;
