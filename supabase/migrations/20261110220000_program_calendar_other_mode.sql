-- Allow general-purpose programs and sessions in the Program Calendar.
alter table public.calendar_programs drop constraint if exists calendar_programs_mode_check;
alter table public.calendar_programs add constraint calendar_programs_mode_check
    check (mode in ('running', 'weight_training', 'combined', 'other'));

alter table public.calendar_sessions drop constraint if exists calendar_sessions_mode_check;
alter table public.calendar_sessions add constraint calendar_sessions_mode_check
    check (mode in ('running', 'weight_training', 'other', 'rest'));
