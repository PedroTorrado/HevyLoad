create table if not exists public.calendar_program_suggestions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null references public.calendar_programs(id) on delete cascade,
    suggestion_date date,
    title text not null,
    summary text not null,
    changes jsonb not null default '{}'::jsonb,
    priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
    created_at timestamptz not null default now()
);

create index if not exists calendar_program_suggestions_program_idx
    on public.calendar_program_suggestions (program_id, suggestion_date);

alter table public.calendar_program_suggestions enable row level security;

create policy "Users can view their calendar suggestions"
    on public.calendar_program_suggestions for select
    using (auth.uid() = user_id);

create policy "Users can create their calendar suggestions"
    on public.calendar_program_suggestions for insert
    with check (auth.uid() = user_id);

create policy "Users can delete their calendar suggestions"
    on public.calendar_program_suggestions for delete
    using (auth.uid() = user_id);
