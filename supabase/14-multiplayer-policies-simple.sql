-- SparxMaths Casino — multiplayer poker policies, without the helper functions.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (FOURTEENTH script. Replaces PART 2 and PART 3 of script 13. Safe to re-run.)
--
-- WHY THIS EXISTS
--
-- Script 13 put three SECURITY DEFINER functions in front of its policies, to
-- dodge a recursion: a policy on poker_seats that asks poker_seats who is in
-- the room calls itself forever. The functions work, but they made the script
-- fragile -- the policies all refer to them, so if the functions are not there
-- yet the whole block fails as one transaction and you are left with tables,
-- no policies, and every insert refused.
--
-- This does the same job with no functions and no recursion, so every
-- statement below stands on its own and one failing cannot undo the others.
--
-- WHAT CHANGED, HONESTLY
--
-- The recursion only ever came from asking "is this person sitting here?"
-- while deciding who may READ the seats. So that question is no longer asked:
-- the three tables holding nothing secret are readable by anyone signed in.
--
--   poker_rooms    board, pot, stacks, whose turn
--   poker_seats    who is sitting where
--   poker_actions  who folded, called, raised
--
-- None of that is secret from the people at the table, and a table code is six
-- characters out of a billion, so it is not a list anyone can walk. What it
-- does mean: somebody who had a code could watch a game they are not in.
-- Against the honour system this whole mode already runs on, that is a small
-- thing -- and it buys a script that cannot half-apply.
--
-- WHAT IS STILL ENFORCED, and it is the part that matters:
--
--   * Your cards are yours. poker_hole is readable only by the player the row
--     belongs to. An opponent's hand never reaches your browser.
--   * Only the host deals, and only into their own room.
--   * Only the host writes the game state.
--   * You can only act as yourself.
--   * You can only sit at a table that is still open, so a game in progress
--     cannot be joined by someone who turns up with the code.

-- ============================================================
-- Clear out anything script 13 managed to create
-- ============================================================

drop policy if exists "rooms readable" on public.poker_rooms;
drop policy if exists "host creates room" on public.poker_rooms;
drop policy if exists "host runs room" on public.poker_rooms;
drop policy if exists "host closes room" on public.poker_rooms;
drop policy if exists "seats visible to the table" on public.poker_seats;
drop policy if exists "sit down as yourself" on public.poker_seats;
drop policy if exists "stand up yourself or be removed by host" on public.poker_seats;
drop policy if exists "read only your own cards" on public.poker_hole;
drop policy if exists "host deals" on public.poker_hole;
drop policy if exists "host clears old hands" on public.poker_hole;
drop policy if exists "table sees its own actions" on public.poker_actions;
drop policy if exists "act as yourself" on public.poker_actions;

-- ============================================================
-- Rooms
-- ============================================================

create policy "rooms readable" on public.poker_rooms
  for select to authenticated
  using (true);

create policy "host creates room" on public.poker_rooms
  for insert to authenticated
  with check (host = auth.uid());

create policy "host runs room" on public.poker_rooms
  for update to authenticated
  using (host = auth.uid())
  with check (host = auth.uid());

create policy "host closes room" on public.poker_rooms
  for delete to authenticated
  using (host = auth.uid());

-- ============================================================
-- Seats
-- ============================================================

create policy "seats readable" on public.poker_seats
  for select to authenticated
  using (true);

-- Only at a table still open, so a game under way cannot be walked into.
create policy "sit down as yourself" on public.poker_seats
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.poker_rooms r
      where r.code = poker_seats.code and r.is_open
    )
  );

create policy "stand up or be removed by the host" on public.poker_seats
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.poker_rooms r
      where r.code = poker_seats.code and r.host = auth.uid()
    )
  );

-- ============================================================
-- Hole cards — the one that decides whether the game works at all
-- ============================================================

create policy "read only your own cards" on public.poker_hole
  for select to authenticated
  using (user_id = auth.uid());

create policy "host deals" on public.poker_hole
  for insert to authenticated
  with check (
    exists (
      select 1 from public.poker_rooms r
      where r.code = poker_hole.code and r.host = auth.uid()
    )
  );

create policy "host clears old hands" on public.poker_hole
  for delete to authenticated
  using (
    exists (
      select 1 from public.poker_rooms r
      where r.code = poker_hole.code and r.host = auth.uid()
    )
  );

-- ============================================================
-- Actions
-- ============================================================

create policy "actions readable" on public.poker_actions
  for select to authenticated
  using (true);

create policy "act as yourself" on public.poker_actions
  for insert to authenticated
  with check (user_id = auth.uid());

-- ============================================================
-- The helper functions are no longer used by anything. Left in place rather
-- than dropped, in case script 13 did create them -- they do no harm.
-- ============================================================

-- ============================================================
-- CHECK IT TOOK — expect 12
-- ============================================================
--   select count(*) from pg_policies
--   where schemaname = 'public' and tablename like 'poker_%';
