-- SparxMaths Casino — the dev console's "reset codes".
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (TENTH script. Assumes 05 has been run.)
--
-- A claim lives in public.redemptions, which has no delete policy on purpose —
-- 05 moved it server-side precisely so a claim could not be undone from the
-- browser. So clearing one has to be a function, and that function has to be
-- fussy about who is calling it.
--
-- WHY THE ALLOWLIST
-- Without one this is a 500-chip printer for anybody: sign in, call
-- reset_redemptions, claim RELEASE26! again, repeat. The dev console is no
-- protection, because the endpoint is reachable without it. So the function
-- checks the caller against a list only you can add to — from this SQL editor,
-- never from the app.
--
-- It only ever deletes the CALLER's own rows, so even an allowlisted account
-- cannot reset anybody else.

create table if not exists public.dev_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- RLS on with no policies at all: nothing reachable from the app can read this
-- table or write to it. The function below runs as its owner, which is not
-- subject to those policies, and is the only thing that ever consults it.
alter table public.dev_users enable row level security;

-- ---------- PUT YOUR OWN USERNAME HERE AND RUN THIS LINE ----------
-- Until you do, "reset codes" will answer "your account is not on the dev list".
insert into public.dev_users (user_id)
select id from public.profiles where username = 'CHANGE_ME'
on conflict (user_id) do nothing;

-- ---------- clear the caller's own claims ----------
-- Returns jsonb: {ok:true, cleared:n} or {ok:false, error:...}
-- where error is one of not_signed_in | not_dev.
create or replace function public.reset_redemptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_n    int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  if not exists (select 1 from public.dev_users where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'not_dev');
  end if;

  delete from public.redemptions where user_id = v_user;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'cleared', v_n);
end $$;

grant execute on function public.reset_redemptions() to authenticated;

-- ============================================================
-- HANDY
-- ============================================================
-- Who is on the list:
--   select p.username, d.added_at from public.dev_users d
--     join public.profiles p on p.id = d.user_id;
-- Take someone off:
--   delete from public.dev_users where user_id =
--     (select id from public.profiles where username = 'SOMEBODY');

-- ============================================================
-- TEARDOWN
-- ============================================================
-- drop function if exists public.reset_redemptions();
-- drop table if exists public.dev_users;
