drop table if exists public.strava_oauth_states;
drop table if exists public.strava_connections;

drop index if exists public.workouts_source_id_idx;
alter table public.workouts drop column if exists source_id;
alter table public.workouts drop column if exists source;
