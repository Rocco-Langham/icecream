-- SparxMaths Casino — codes that only pay under a condition.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (SEVENTH script. Assumes 01 and 05 have been run.)
--
-- BROKE123 gives you 15 chips, but only when you have none left. That "only
-- when" has to be the database's decision for the same reason the chip value
-- is: anything the page decides, the page can be edited to decide differently.
--
--   max_bank  the highest balance you may hold and still claim this code.
--             NULL means no condition, which is every existing code.
--
-- Read the honest limit though: scores.bank is still written by the player's
-- own browser, so this stops the check being edited out in dev tools, not a
-- determined cheat. Setting your own balance to 0 to qualify does work — and
-- costs you every chip you had, for 15 back, which is its own deterrent.

alter table public.codes
  add column if not exists max_bank bigint;

insert into public.codes (code, chips, label, max_bank)
values ('BROKE123', 15, 'Emergency top-up', 0)
on conflict (code) do update
  set chips    = excluded.chips,
      label    = excluded.label,
      max_bank = excluded.max_bank,
      active   = true;

-- ---------- claim a code ----------
-- Same function as 05 with the balance test added. Returns jsonb:
-- {ok:true, chips, label, bank} or {ok:false, error:...} where error is one of
-- not_signed_in | invalid | already | not_eligible.
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code public.codes%rowtype;
  v_bank bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select * into v_code
    from public.codes
   where upper(code) = upper(btrim(p_code))
     and active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- FOR UPDATE holds the row for the rest of this function, which is one
  -- transaction — so the balance cannot move between passing the test and
  -- being paid.
  if v_code.max_bank is not null then
    select bank into v_bank
      from public.scores
     where user_id = v_user
       for update;

    if v_bank is null or v_bank > v_code.max_bank then
      return jsonb_build_object('ok', false, 'error', 'not_eligible',
                                'max_bank', v_code.max_bank);
    end if;
  end if;

  -- The insert is the gate. If this account already holds this code the
  -- primary key rejects it and nothing is paid.
  begin
    insert into public.redemptions (user_id, code) values (v_user, v_code.code);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already');
  end;

  -- Same transaction as the insert, so a claim can never be recorded without
  -- paying out, nor pay out twice.
  update public.scores
     set bank = bank + v_code.chips,
         peak = greatest(peak, bank + v_code.chips),
         updated_at = now()
   where user_id = v_user
  returning bank into v_bank;

  return jsonb_build_object('ok', true, 'chips', v_code.chips,
                            'label', v_code.label, 'bank', v_bank);
end $$;

grant execute on function public.redeem_code(text) to authenticated;

-- ============================================================
-- TEARDOWN
-- ============================================================
-- delete from public.redemptions where code = 'BROKE123';
-- delete from public.codes where code = 'BROKE123';
-- alter table public.codes drop column if exists max_bank;
-- ...then re-run 05-code-redemptions.sql to restore the earlier function.
