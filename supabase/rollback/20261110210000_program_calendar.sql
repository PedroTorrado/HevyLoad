-- Rollback for 20261110210000_program_calendar.sql.
-- This intentionally removes only the objects introduced by that migration.

drop table if exists public.calendar_sessions;
drop table if exists public.calendar_programs;
