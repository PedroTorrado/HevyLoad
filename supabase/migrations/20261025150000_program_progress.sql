-- Track when a program was activated and how each logged workout maps onto it.

alter table public.training_programs
    add column if not exists activated_at timestamptz;

update public.training_programs
set activated_at = coalesce(activated_at, updated_at)
where is_active = true;

create or replace function public.activate_training_program(program_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.training_programs
    set is_active = false, updated_at = now()
    where user_id = auth.uid() and is_active = true;

    update public.training_programs
    set is_active = true, activated_at = now(), updated_at = now()
    where id = program_id and user_id = auth.uid();
end;
$$;

create table if not exists public.program_session_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null references public.training_programs(id) on delete cascade,
    workout_id uuid not null references public.workouts(id) on delete cascade,
    week_index integer not null check (week_index >= 1),
    session_key text not null,
    phase text not null check (phase in ('build', 'deload')),
    counted boolean not null default true,
    muscle_coverage numeric not null,
    avg_rpe_delta numeric,
    volume_ratio numeric not null,
    adjustments jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (program_id, workout_id)
);

create index if not exists program_session_logs_program_idx
    on public.program_session_logs (program_id, created_at);

alter table public.program_session_logs enable row level security;

create policy "Users can view their program session logs"
    on public.program_session_logs for select
    using (auth.uid() = user_id);

create policy "Users can create their program session logs"
    on public.program_session_logs for insert
    with check (auth.uid() = user_id);

create policy "Users can delete their program session logs"
    on public.program_session_logs for delete
    using (auth.uid() = user_id);
