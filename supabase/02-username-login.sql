-- SparxMaths Casino — allow logging in with a username instead of an email.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (This is a SECOND script. It assumes supabase-schema.sql has already been run.)
--
-- WHY THIS IS NEEDED
-- Supabase's signInWithPassword only accepts an email address. To let someone
-- type a username instead, the page has to translate username -> email BEFORE
-- signing in, i.e. while still logged out. That is what this function does.
--
-- THE TRADE-OFF, STATED PLAINLY
-- Because the caller is not yet signed in, this function must be callable by
-- the anonymous role. Anyone who can guess a username can therefore learn the
-- email address on that account. If you would rather not expose that, delete
-- this function and log in with email only (see the teardown at the bottom).

create or replace function public.email_for_username(u text)
returns text
language sql
security definer          -- reads auth.users, which clients cannot read directly
set search_path = public
stable
as $$
  select au.email
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(p.username) = lower(trim(u))   -- exact match only, no fuzzy search
  limit 1;
$$;

-- The login form runs while signed out, so anon needs execute rights.
grant execute on function public.email_for_username(text) to anon, authenticated;

-- ============================================================
-- TEARDOWN — run this if you decide against username login
-- ============================================================
-- revoke execute on function public.email_for_username(text) from anon, authenticated;
-- drop function if exists public.email_for_username(text);
