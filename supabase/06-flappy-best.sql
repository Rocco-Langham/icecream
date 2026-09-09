-- SparxMaths Casino — Flappy high scores.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (This is the SIXTH script. It assumes 01-schema.sql has already been run.)
--
-- One column on the existing scores row, exactly like the streak columns in 03:
-- a personal best belongs to a player the same way their chips do, and there is
-- only ever one of them.
--
--   flappy_best  most pipes cleared in a single run, ever
--
-- Pipes rather than chips won: the multiplier is a function of pipes cleared, so
-- pipes rank the same players in the same order while staying comparable between
-- someone betting 5 and someone betting 500.

alter table public.scores
  add column if not exists flappy_best int not null default 0;

-- No policy changes needed: this is a column on scores, which is already covered
-- by "read own or friends scores" / "update own scores" from 01. That means the
-- Flappy board sees exactly the same people as the profit board — you and your
-- accepted friends, nobody else.

-- ============================================================
-- TEARDOWN
-- ============================================================
-- alter table public.scores
--   drop column if exists flappy_best;
