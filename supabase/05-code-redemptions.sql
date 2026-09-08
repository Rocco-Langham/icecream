-- SparxMaths Casino — enforce "one claim per account" in the database.
-- Run this in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- (FIFTH script. Assumes 01 and 04 have been run.)
--
-- WHY THIS EXISTS
-- Until now a claim was remembered in a jsonb list on the player's own scores
-- row, which the player's own browser writes. The check "have I claimed this?"
-- ran in JavaScript, so emptying that list in dev tools made every code
-- claimable again. Nothing on the server disagreed.
--
-- The fix moves both halves server-side:
--   * codes        - what a code is worth, so the browser cannot name its own price
--   * redemptions  - one row per (account, code), PRIMARY KEY enforced
--   * redeem_code()- checks, inserts and pays in ONE transaction
--
-- The primary key is the actual guarantee. Two clicks racing each other both
-- try to insert the same pair; the database lets exactly one win.

-- ---------- what codes exist and what they pay ----------
create table if not exists public.codes (
  code   text primary key,
  chips  bigint  not null default 0,
  label  text    not null default '',
  active boolean not null default true
);

insert into public.codes (code, chips, label)
values ('RELEASE26!', 500, 'Release bonus')
on conflict (code) do nothing;

-- ---------- who has claimed what ----------
create table if not exists public.redemptions (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  code        text not null references public.codes(code)  on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, code)          -- <- one claim per account per code
);

alter table public.codes       enable row level security;
alter table public.redemptions enable row level security;

-- Players may read the code list and their own claim history. Note there is
-- deliberately NO insert/update/delete policy on either table: the only way to
-- write a redemption is through the function below, which runs as its owner.
create policy "codes readable" on public.codes
  for select to authenticated using (active);

create policy "see own redemptions" on public.redemptions
  for select to authenticated using (user_id = auth.uid());

-- ---------- claim a code ----------
-- Returns jsonb: {ok:true, chips, label, bank} or {ok:false, error:...}
-- where error is one of not_signed_in | invalid | already.
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

-- ---------- retire the old client-owned list ----------
-- Two sources of truth for the same fact is how they drift apart. The
-- redemptions table is now the only one.
alter table public.scores drop column if exists redeemed;

-- ============================================================
-- TEARDOWN
-- ============================================================
-- drop function if exists public.redeem_code(text);
-- drop table if exists public.redemptions;
-- drop table if exists public.codes;
-- alter table public.scores add column if not exists redeemed jsonb not null default '[]'::jsonb;
