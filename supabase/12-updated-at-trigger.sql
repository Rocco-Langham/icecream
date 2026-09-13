-- SparxMaths Casino — let the server stamp scores.updated_at.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (TWELFTH script. Safe to run more than once.)
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
-- The claim functions in 05, 07 and 09 set updated_at = now() themselves. That
-- becomes redundant rather than wrong — the trigger sets it again to the same
-- transaction time — so they are left alone.
--
-- NOTHING BREAKS IF YOU DO NOT RUN THIS. The browser still sends a stamp of
-- its own and reads back whatever actually landed, so it works against a table
-- with or without this trigger. Running it removes the clock-skew hazard; not
-- running it leaves the app exactly as it is today.

create or replace function public.scores_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Ignore whatever the client sent. The point of the trigger is that this
  -- value comes from one clock, so an inserted or updated row is stamped here
  -- and nowhere else. An upsert arrives as INSERT ... ON CONFLICT DO UPDATE,
  -- which fires this on both paths, and the column's own default only ever
  -- applied to inserts that omitted it -- which the app's upsert does not.
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists scores_set_updated_at on public.scores;

create trigger scores_set_updated_at
  before insert or update on public.scores
  for each row
  execute function public.scores_touch_updated_at();

-- Check it took: run this, save something in the app, and run it again. The
-- stamp should move, and it should agree with the server's clock rather than
-- with the browser's.
--
--   select user_id, hands, updated_at, now() - updated_at as age
--   from public.scores
--   where user_id = auth.uid();

-- To undo:
--   drop trigger if exists scores_set_updated_at on public.scores;
--   drop function if exists public.scores_touch_updated_at();
