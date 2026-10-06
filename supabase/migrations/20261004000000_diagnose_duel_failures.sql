-- ─────────────────────────────────────────────
-- READ-ONLY DIAGNOSTIC v2. Changes nothing.
--
-- v1 FAILED with:  ERROR: 2201B: invalid regular expression: invalid repetition
-- count(s). That was my bug. Postgres uses POSIX ARE, which has NO support for
-- {m,n} interval quantifiers -- only {m}. v2 uses position() instead.
--
-- WHY YOU NEED v2
--
-- Step 9 returned:
--   {"won":false,"is_tie":false,"matched":true,"winner_id":null,"opponent_score":null}
--
-- A is staked 300, B is staked 700, and the function reported them MATCHED. But
-- EVERY version of settle_duel() in this repo filters `and c.stake = mine.stake`.
-- None of them can produce that result.
--
-- The response also carries a `winner_id` key. No version in this repo returns a
-- key by that name -- they return `payout`, `refunded`, `your_score`.
--
-- So the live settle_duel() is a body that exists in NEITHER migration file. It
-- has been hand-patched on the server, which is also why it referenced a
-- stake_challenges.creator_score column that no migration ever creates.
--
-- Run these one at a time, in order, in the SQL Editor.
-- ─────────────────────────────────────────────

-- ── 1. Every overload actually in the live database ─────────────────────────
-- This is the authoritative list. `pg_get_function_identity_arguments` is the
-- exact string a `drop function` would need.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       n.nspname as schema,
       p.oid
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('settle_duel','cancel_duel','tie_duel','forfeit_duel',
                    'open_duel','claim_duel_opponent','begin_solo_play',
                    'wallet_balance','ensure_profile','record_deposit')
order by p.proname, args;

-- ── 2. The ACTUAL live body of settle_duel ─────────────────────────────────
-- This is the whole point of the diagnostic: read what the server really runs.
-- Copy the prosrc cell -- it is the smoking gun.
select p.oid,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosrc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'settle_duel';

-- ── 3. Does the live body touch stake_challenges.creator_score? ────────────
-- position() returns 0 when absent, so no regular expressions are involved.
select pg_get_function_identity_arguments(p.oid) as args,
       position('creator_score' in p.prosrc) > 0       as mentions_creator_score,
       position('stake_challenges' in p.prosrc) > 0   as mentions_stake_challenges,
       position('stake = mine.stake' in p.prosrc) > 0 as filters_on_stake,
       position('winner_id' in p.prosrc) > 0          as mentions_winner_id,
       length(p.prosrc) as body_len
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'settle_duel';

-- ── 3. The actual columns, so 42703 can be read directly ───────────────────
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stake_challenges','bets')
order by table_name, ordinal_position;

-- ── 5. Row counts by status ────────────────────────────────────────────────
select status, count(*) as rows,
       array_agg(distinct game_id) as games,
       array_agg(distinct stake)  as stakes
from public.stake_challenges
group by status
order by status;
