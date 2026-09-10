-- SparxMaths Casino — remember which day's streak chips have been claimed.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (EIGHTH script. Assumes 01 and 03 have been run.)
--
-- The daily reward is no longer paid automatically — it waits behind a button
-- in the streak calendar. That means there is now a fact to remember that
-- streak_last cannot express: the day HAS been counted, but the chips have not
-- been taken yet.
--
--   streak_claimed  the day the reward was last claimed, in the same
--                   days-since-1970 form as streak_last
--
-- It travels with the streak for the same reason streak_last does: claim on
-- your phone, open the site on a laptop, and without this the laptop would
-- happily pay for the same day again.

alter table public.scores
  add column if not exists streak_claimed int;

-- No policy changes needed: another column on scores, already covered by
-- "read own or friends scores" / "update own scores" from 01.

-- ============================================================
-- TEARDOWN
-- ============================================================
-- alter table public.scores
--   drop column if exists streak_claimed;
