-- Revert the general-purpose Program Calendar mode.
update public.calendar_programs set mode = 'combined' where mode = 'other';
update public.calendar_sessions set mode = 'weight_training' where mode = 'other';

alter table public.calendar_programs drop constraint if exists calendar_programs_mode_check;
alter table public.calendar_programs add constraint calendar_programs_mode_check
    check (mode in ('running', 'weight_training', 'combined'));

alter table public.calendar_sessions drop constraint if exists calendar_sessions_mode_check;
alter table public.calendar_sessions add constraint calendar_sessions_mode_check
    check (mode in ('running', 'weight_training', 'rest'));
