-- SparxMaths Casino — redeemable codes, and a 1000-chip starting balance.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (FOURTH script. Assumes 01-schema.sql has already been run.)

-- Which codes this player has already redeemed, e.g. ["RELEASE26!"].
-- A list on the existing scores row rather than its own table: it is a small
-- set, it is only ever read for one player at a time, and it then rides the
-- same read/write policies and the same sync as the chips it grants.
alter table public.scores
  add column if not exists redeemed jsonb not null default '[]'::jsonb;

-- New players now start on 1000 rather than 100. This only changes the default
-- for rows created from here on; nobody's existing balance is touched.
alter table public.scores alter column bank set default 1000;
alter table public.scores alter column peak set default 1000;

-- ============================================================
-- TEARDOWN
-- ============================================================
-- alter table public.scores drop column if exists redeemed;
-- alter table public.scores alter column bank set default 100;
-- alter table public.scores alter column peak set default 100;
