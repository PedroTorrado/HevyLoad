create table if not exists public.training_programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    goal text not null,
    schedule_mode text not null check (schedule_mode in ('rolling', 'calendar')),
    sessions_per_week integer not null check (sessions_per_week between 2 and 6),
    block_length_weeks integer not null check (block_length_weeks in (4, 6, 8)),
    progression_style text not null check (progression_style = 'hybrid'),
    definition jsonb not null,
    is_active boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists training_programs_user_updated_idx
    on public.training_programs (user_id, updated_at desc);

create unique index if not exists training_programs_one_active_per_user_idx
    on public.training_programs (user_id)
    where is_active = true;

alter table public.training_programs enable row level security;

create policy "Users can view their training programs"
    on public.training_programs for select
    using (auth.uid() = user_id);

create policy "Users can create their training programs"
    on public.training_programs for insert
    with check (auth.uid() = user_id);

create policy "Users can update their training programs"
    on public.training_programs for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their training programs"
    on public.training_programs for delete
    using (auth.uid() = user_id);

create or replace function public.activate_training_program(program_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.training_programs
    set is_active = false, updated_at = now()
    where user_id = auth.uid();

    update public.training_programs
    set is_active = true, updated_at = now()
    where id = program_id and user_id = auth.uid();
end;
$$;
