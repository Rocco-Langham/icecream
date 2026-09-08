-- SparxMaths Casino — daily play streaks.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (This is the THIRD script. It assumes 01-schema.sql has already been run.)
--
-- Three columns on the existing scores row rather than a new table: a streak
-- belongs to a player exactly like their chips do, and there is only ever one.
--
--   streak_count  days in a row up to and including streak_last
--   streak_best   the highest streak_count ever reached
--   streak_last   the last day played, as a local-calendar day number
--                 (days since 1970-01-01). Storing a number rather than a date
--                 keeps the "was that yesterday?" test to last = today - 1,
--                 with no timezone maths on either side.

alter table public.scores
  add column if not exists streak_count int not null default 0,
  add column if not exists streak_best  int not null default 0,
  add column if not exists streak_last  int;

-- No policy changes needed: these are columns on scores, which is already
-- covered by "read own or friends scores" / "update own scores" from 01.

-- ============================================================
-- TEARDOWN
-- ============================================================
-- alter table public.scores
--   drop column if exists streak_count,
--   drop column if exists streak_best,
--   drop column if exists streak_last;
