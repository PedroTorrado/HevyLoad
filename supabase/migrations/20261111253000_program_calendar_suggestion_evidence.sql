alter table public.calendar_program_suggestions
    add column if not exists evidence text not null default '';
