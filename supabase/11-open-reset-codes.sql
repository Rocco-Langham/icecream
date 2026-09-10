-- SparxMaths Casino — open "reset codes" to everyone.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (ELEVENTH script. Replaces the function from 10-reset-codes.sql.)
--
-- 10 put an allowlist in front of reset_redemptions. This takes it out: any
-- signed-in account may now clear its own claims.
--
-- BE CLEAR ABOUT WHAT THAT MEANS. Dev mode only exists in the browser — the
-- server has no idea whether the console is open — so "anyone in dev mode" and
-- "anyone signed in" are the same set of people here. Anybody who finds this
-- endpoint can claim RELEASE26! as often as they like, 500 chips a time, and
-- that will show up on the friends leaderboard as profit.
--
-- What is still enforced, and matters more:
--   * you may only clear your OWN claims, never anyone else's
--   * you must be signed in at all
--
-- To put the gate back, re-run 10-reset-codes.sql.

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

  -- auth.uid() and nothing else: whoever is calling, the blast radius is their
  -- own row set. This is the one check that does not come out.
  delete from public.redemptions where user_id = v_user;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'cleared', v_n);
end $$;

grant execute on function public.reset_redemptions() to authenticated;

-- The allowlist is now unused. Dropped rather than left lying around looking
-- like it still does something.
drop table if exists public.dev_users;

-- ============================================================
-- TEARDOWN
-- ============================================================
-- Re-run 10-reset-codes.sql, which recreates dev_users and the gated function.
