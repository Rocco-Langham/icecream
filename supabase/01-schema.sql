-- SparxMaths Casino — Supabase schema
-- Paste the whole file into: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to run once. If you need to start over, see the teardown block at the bottom.

-- ============================================================
-- 1. TABLES
-- ============================================================

-- One public identity per player. Friends find each other by username.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

-- One stats row per player. `net` holds the same shape as the game's gameNet
-- object, e.g. {"slots": 1240, "flappy": -1180}.
create table public.scores (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bank bigint not null default 100,
  hands int not null default 0,
  won bigint not null default 0,
  big bigint not null default 0,
  peak bigint not null default 100,
  net jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per friendship pair. status flips from 'pending' to 'accepted'
-- when the addressee approves.
create table public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================
-- With RLS on and no policies, every query returns nothing. The policies
-- below are what make the tables readable/writable at all.

alter table public.profiles    enable row level security;
alter table public.scores      enable row level security;
alter table public.friendships enable row level security;

-- SECURITY DEFINER matters here: the scores policy queries friendships, which
-- has its own RLS. Without this the two policies recurse and every read fails.
create or replace function public.is_friend(other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = other)
        or (f.addressee = auth.uid() and f.requester = other))
  );
$$;

-- ---- profiles: everyone signed in can read, you can only write your own ----
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

create policy "insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- scores: your own row, plus any accepted friend's row ----
-- This single policy IS the friends leaderboard: the filtering happens in the
-- database, so the client cannot ask for a stranger's scores.
create policy "read own or friends scores" on public.scores
  for select to authenticated
  using (user_id = auth.uid() or public.is_friend(user_id));

create policy "insert own scores" on public.scores
  for insert to authenticated with check (user_id = auth.uid());

create policy "update own scores" on public.scores
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- friendships: see your own, request as yourself, only you can accept ----
create policy "see own friendships" on public.friendships
  for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

create policy "send requests" on public.friendships
  for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');

create policy "addressee accepts" on public.friendships
  for update to authenticated
  using (addressee = auth.uid())
  with check (addressee = auth.uid() and status = 'accepted');

create policy "either side removes" on public.friendships
  for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ============================================================
-- 3. GIVE EVERY NEW SIGNUP A PROFILE + SCORES ROW
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username',
                           'player' || substr(new.id::text, 1, 6)));
  insert into public.scores (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TEARDOWN — only if you need to wipe and re-run the above
-- ============================================================
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.is_friend(uuid);
-- drop table if exists public.friendships;
-- drop table if exists public.scores;
-- drop table if exists public.profiles;
