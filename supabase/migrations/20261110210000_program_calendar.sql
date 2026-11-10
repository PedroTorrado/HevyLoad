-- Additive, independently removable storage for externally-authored training plans.
-- To remove this feature, run supabase/rollback/20261110210000_program_calendar.sql.

create table if not exists public.calendar_programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    mode text not null check (mode in ('running', 'weight_training', 'combined', 'other')),
    start_date date not null,
    duration_weeks integer not null check (duration_weeks between 1 and 104),
    source_prompt text not null,
    definition jsonb not null,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists calendar_programs_user_updated_idx
    on public.calendar_programs (user_id, updated_at desc);

create table if not exists public.calendar_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null references public.calendar_programs(id) on delete cascade,
    session_date date not null,
    mode text not null check (mode in ('running', 'weight_training', 'other', 'rest')),
    title text not null,
    details jsonb not null default '{}'::jsonb,
    status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
    completion_notes text,
    completed_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists calendar_sessions_user_date_idx
    on public.calendar_sessions (user_id, session_date);

create index if not exists calendar_sessions_program_date_idx
    on public.calendar_sessions (program_id, session_date);

alter table public.calendar_programs enable row level security;
alter table public.calendar_sessions enable row level security;

create policy "Users can view their calendar programs"
    on public.calendar_programs for select
    using (auth.uid() = user_id);

create policy "Users can create their calendar programs"
    on public.calendar_programs for insert
    with check (auth.uid() = user_id);

create policy "Users can update their calendar programs"
    on public.calendar_programs for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their calendar programs"
    on public.calendar_programs for delete
    using (auth.uid() = user_id);

create policy "Users can view their calendar sessions"
    on public.calendar_sessions for select
    using (auth.uid() = user_id);

create policy "Users can create their calendar sessions"
    on public.calendar_sessions for insert
    with check (auth.uid() = user_id);

create policy "Users can update their calendar sessions"
    on public.calendar_sessions for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their calendar sessions"
    on public.calendar_sessions for delete
    using (auth.uid() = user_id);
