-- xyzcasino — let the server stamp scores.updated_at.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (TWELFTH script. Safe to run more than once.)
--
-- IF YOU HIT "function public.scores_touch_updated_at() does not exist":
-- run PART 1 on its own, press Run, then run PART 2. The editor splits a
-- script on semicolons, and a function body has semicolons inside it, so a
-- long script can get cut in the wrong place and the function never gets
-- created. Running the two halves separately sidesteps that entirely.
--
-- WHY THIS EXISTS
--
-- updated_at is what decides which save wins when a device syncs. The browser
-- compares the stamp on the row against the stamp it last left there: if the
-- row is newer, somebody else wrote and the cloud wins; if it is not, this
-- device is at least as current and its save goes up. That is the rule that
-- keeps a stats reset from being undone by the next sync.
--
-- The weakness was where the stamp came from. The browser minted it with its
-- own clock, so the comparison was only as good as the clocks of every device
-- involved. A phone an hour fast stamps every save an hour into the future:
-- its row then looks newer than anything a correctly-set laptop writes
-- afterwards, so the laptop keeps deciding the cloud is ahead and pulling,
-- and a whole session on the laptop is thrown away each time it syncs. Set a
-- clock slow and the mirror image happens — that device overwrites saves that
-- genuinely came after its own.
--
-- After this script the column is written by Postgres, on one clock, whatever
-- any device believes the time to be. now() is the start of the transaction,
-- so every row in a single statement gets the same stamp.
--
-- The function ignores whatever the client sent — that is the whole point, so
-- that the value comes from one clock and nowhere else. An upsert arrives as
-- INSERT ... ON CONFLICT DO UPDATE, so the trigger is declared for both paths;
-- the column's own default only ever applied to inserts that omitted the
-- value, which the app's upsert does not.
--
-- The claim functions in 05, 07 and 09 set updated_at = now() themselves. That
-- becomes redundant rather than wrong — the trigger sets it again to the same
-- transaction time — so they are left alone.
--
-- NOTHING BREAKS IF YOU DO NOT RUN THIS. The browser still sends a stamp of
-- its own and reads back whatever actually landed, so it works against a table
-- with or without this trigger. Running it removes the clock-skew hazard; not
-- running it leaves the app exactly as it is today.


-- ============================================================
-- PART 1 — the function
-- ============================================================

create or replace function public.scores_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ============================================================
-- PART 2 — the trigger
-- ============================================================

drop trigger if exists scores_set_updated_at on public.scores;

create trigger scores_set_updated_at
  before insert or update on public.scores
  for each row execute function public.scores_touch_updated_at();


-- ============================================================
-- CHECK IT TOOK
-- ============================================================
-- This should return one row naming the trigger:
--
--   select tgname from pg_trigger
--   where tgrelid = 'public.scores'::regclass and not tgisinternal;
--
-- Then save something in the app and run this twice a minute apart — the
-- stamp should move, and agree with the server's clock, not the browser's:
--
--   select user_id, hands, updated_at, now() - updated_at as age
--   from public.scores where user_id = auth.uid();

-- ============================================================
-- TEARDOWN
-- ============================================================
-- drop trigger if exists scores_set_updated_at on public.scores;
-- drop function if exists public.scores_touch_updated_at();
