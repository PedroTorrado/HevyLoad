alter table public.workouts
    add column if not exists route_data jsonb;
