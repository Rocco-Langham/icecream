-- SparxMaths Casino — codes that can be claimed more than once.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (NINTH script. Assumes 07-conditional-codes.sql has been run first.)
--
-- BROKE123 is a rescue, not a prize, so being able to claim it once ever was
-- the wrong shape: go broke a second time and you were stuck. It is now
-- repeatable, and the condition does the limiting instead — claiming takes you
-- from 0 chips to 15, which immediately disqualifies you until you have lost
-- them again. There is no cooldown to tune and no way to stockpile.
--
--   codes.repeatable   claimable again and again, subject to its condition
--   redemptions.times  how many claims this account has made of this code
--
-- For a repeatable code the redemptions row stops being the gate and becomes a
-- tally. For every other code it is still the gate, and the primary key is
-- still what enforces it.

alter table public.codes
  add column if not exists repeatable boolean not null default false;

alter table public.redemptions
  add column if not exists times int not null default 1;

update public.codes set repeatable = true where code = 'BROKE123';

-- ---------- claim a code ----------
-- Returns jsonb: {ok:true, chips, label, bank, times} or {ok:false, error:...}
-- where error is one of not_signed_in | invalid | already | not_eligible.
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_code  public.codes%rowtype;
  v_bank  bigint;
  v_times int := 1;
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
  -- transaction. That is what makes a repeatable code safe to hammer: a second
  -- request waits here, and by the time it is let through the first has already
  -- paid, so the balance it tests against is 15, not 0.
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

  if v_code.repeatable then
    -- a tally, not a gate: the condition above is what limits this one
    insert into public.redemptions (user_id, code)
    values (v_user, v_code.code)
    on conflict (user_id, code) do update
      set times       = redemptions.times + 1,
          redeemed_at = now()
    returning times into v_times;
  else
    -- the insert IS the gate. If this account already holds this code the
    -- primary key rejects it and nothing is paid.
    begin
      insert into public.redemptions (user_id, code) values (v_user, v_code.code);
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'already');
    end;
  end if;

  -- Same transaction as the insert, so a claim can never be recorded without
  -- paying out, nor pay out twice.
  update public.scores
     set bank = bank + v_code.chips,
         peak = greatest(peak, bank + v_code.chips),
         updated_at = now()
   where user_id = v_user
  returning bank into v_bank;

  return jsonb_build_object('ok', true, 'chips', v_code.chips,
                            'label', v_code.label, 'bank', v_bank,
                            'times', v_times);
end $$;

grant execute on function public.redeem_code(text) to authenticated;

-- ============================================================
-- TEARDOWN
-- ============================================================
-- update public.codes set repeatable = false where code = 'BROKE123';
-- alter table public.codes drop column if exists repeatable;
-- alter table public.redemptions drop column if exists times;
-- ...then re-run 07-conditional-codes.sql to restore the earlier function.
