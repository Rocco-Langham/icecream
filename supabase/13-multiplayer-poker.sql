-- SparxMaths Casino — tables for multiplayer poker.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (THIRTEENTH script. Safe to run more than once.)
--
-- IF ANY PART FAILS: run the parts one at a time, in order. The editor splits
-- a script on semicolons, and a function body has semicolons inside it, so a
-- long script can be cut in the wrong place. (That is what broke script 12.)
--
-- HOW THE GAME IS SHARED
--
-- Whoever creates a table is the host. Their browser owns the deck, deals the
-- cards, applies everyone's moves and publishes the result. Everyone else
-- draws what the host published and sends their moves back. There is no
-- server-side referee -- the same honour system the rest of this app already
-- runs on, deliberately, because the alternative is porting the whole hand
-- engine into the database.
--
-- WHAT THAT MEANS, PLAINLY. The host's browser holds the undealt deck and
-- every player's cards, so a host who goes looking can see them. Play with
-- people you trust, and take turns hosting. Everyone else is kept honest by
-- the split below, which is worth doing even here because it costs nothing:
--
--   poker_rooms   public state -- board, pot, stacks, whose turn. Everyone at
--                 the table reads it. Nothing secret is ever written here.
--   poker_hole    one row per player per hand, holding THAT player's two
--                 cards. The policy lets you read your own row and nobody
--                 else's, so an opponent's cards are never sent to your
--                 browser at all -- not in a response you could go digging
--                 through, not anywhere. Only the host can write them.
--   poker_actions what each player did. Append-only, so the host can replay
--                 a hand if their tab was asleep when a move landed.
--
-- A closed room is readable only by the people sitting at it. An open one is
-- readable by anyone signed in, because you have to be able to see a table
-- before you can join it.

-- ============================================================
-- PART 1 — the tables
-- ============================================================

create table if not exists public.poker_rooms (
  code       text primary key,
  host       uuid not null references auth.users(id) on delete cascade,
  buyin      int not null default 250,
  hand_no    int not null default 0,
  is_open    boolean not null default true,
  state      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.poker_seats (
  code     text not null references public.poker_rooms(code) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  seat_no  int  not null,
  name     text,
  joined_at timestamptz not null default now(),
  primary key (code, user_id),
  unique (code, seat_no)
);

create table if not exists public.poker_hole (
  code    text not null references public.poker_rooms(code) on delete cascade,
  hand_no int  not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  cards   jsonb not null,
  primary key (code, hand_no, user_id)
);

create table if not exists public.poker_actions (
  id         bigserial primary key,
  code       text not null references public.poker_rooms(code) on delete cascade,
  hand_no    int  not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null,
  amount     int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists poker_actions_room_idx on public.poker_actions (code, hand_no, id);

alter table public.poker_rooms   enable row level security;
alter table public.poker_seats   enable row level security;
alter table public.poker_hole    enable row level security;
alter table public.poker_actions enable row level security;


-- ============================================================
-- PART 2 — who is sitting at a table
-- ============================================================
-- SECURITY DEFINER for the same reason is_friend needs it in script 01: the
-- policies below ask poker_seats who is in a room, and poker_seats has its own
-- policy that asks the same question. Without this they recurse and every read
-- fails.

create or replace function public.in_room(room text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.poker_seats s
    where s.code = room and s.user_id = auth.uid()
  );
$$;

create or replace function public.room_is_open(room text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.poker_rooms r
    where r.code = room and r.is_open
  );
$$;

create or replace function public.is_room_host(room text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.poker_rooms r
    where r.code = room and r.host = auth.uid()
  );
$$;


-- ============================================================
-- PART 3 — the policies
-- ============================================================

-- ---- rooms: open ones are findable, closed ones are for the players only ----
drop policy if exists "rooms readable" on public.poker_rooms;
create policy "rooms readable" on public.poker_rooms
  for select to authenticated
  using (is_open or host = auth.uid() or public.in_room(code));

drop policy if exists "host creates room" on public.poker_rooms;
create policy "host creates room" on public.poker_rooms
  for insert to authenticated
  with check (host = auth.uid());

-- Only the host advances the game. Everyone else changes the table by sending
-- an action, never by writing the state themselves.
drop policy if exists "host runs room" on public.poker_rooms;
create policy "host runs room" on public.poker_rooms
  for update to authenticated
  using (host = auth.uid())
  with check (host = auth.uid());

drop policy if exists "host closes room" on public.poker_rooms;
create policy "host closes room" on public.poker_rooms
  for delete to authenticated
  using (host = auth.uid());

-- ---- seats ----
drop policy if exists "seats visible to the table" on public.poker_seats;
-- Open rooms included, or the lobby could not show how many people are
-- already sitting at a table you have not joined yet.
create policy "seats visible to the table" on public.poker_seats
  for select to authenticated
  using (public.room_is_open(code) or public.in_room(code) or public.is_room_host(code));

-- Two conditions, and the second one matters as much as the first: a seat is
-- what grants read access to the room and its actions, so without the open
-- check anyone who guessed a code could seat themselves at a game already in
-- progress and start reading it. Closed means closed.
drop policy if exists "sit down as yourself" on public.poker_seats;
create policy "sit down as yourself" on public.poker_seats
  for insert to authenticated
  with check (user_id = auth.uid() and public.room_is_open(code));

drop policy if exists "stand up yourself or be removed by host" on public.poker_seats;
create policy "stand up yourself or be removed by host" on public.poker_seats
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_host(code));

-- ---- hole cards: yours and nobody else's ----
-- This is the one policy doing real work. Without it every player's cards
-- would travel to every browser at the table and the game would be over.
drop policy if exists "read only your own cards" on public.poker_hole;
create policy "read only your own cards" on public.poker_hole
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "host deals" on public.poker_hole;
create policy "host deals" on public.poker_hole
  for insert to authenticated
  with check (public.is_room_host(code));

drop policy if exists "host clears old hands" on public.poker_hole;
create policy "host clears old hands" on public.poker_hole
  for delete to authenticated
  using (public.is_room_host(code));

-- ---- actions ----
drop policy if exists "table sees its own actions" on public.poker_actions;
create policy "table sees its own actions" on public.poker_actions
  for select to authenticated
  using (public.in_room(code));

-- You may only ever act as yourself. The host still checks the move is legal
-- before applying it; this stops you sending one in somebody else's name.
drop policy if exists "act as yourself" on public.poker_actions;
create policy "act as yourself" on public.poker_actions
  for insert to authenticated
  with check (user_id = auth.uid() and public.in_room(code));


-- ============================================================
-- PART 4 — push changes to the table instead of polling for them
-- ============================================================
-- Realtime applies the policies above, so a player is only ever sent the rows
-- they were already allowed to read -- including, crucially, their own hole
-- cards and no one else's.

-- Wrapped so the script stays safe to run twice: adding a table that is
-- already published is an error, not a no-op.

do $pub$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'poker_rooms') then
    alter publication supabase_realtime add table public.poker_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'poker_seats') then
    alter publication supabase_realtime add table public.poker_seats;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'poker_hole') then
    alter publication supabase_realtime add table public.poker_hole;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'poker_actions') then
    alter publication supabase_realtime add table public.poker_actions;
  end if;
end $pub$;


-- ============================================================
-- CHECK IT TOOK
-- ============================================================
--   select tablename from pg_tables
--   where schemaname = 'public' and tablename like 'poker_%';
--
-- Expect four rows: poker_actions, poker_hole, poker_rooms, poker_seats.
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename like 'poker_%';
--
-- Expect the same four.

-- ============================================================
-- TEARDOWN
-- ============================================================
--   drop table if exists public.poker_actions;
--   drop table if exists public.poker_hole;
--   drop table if exists public.poker_seats;
--   drop table if exists public.poker_rooms;
--   drop function if exists public.in_room(text);
--   drop function if exists public.room_is_open(text);
--   drop function if exists public.is_room_host(text);
