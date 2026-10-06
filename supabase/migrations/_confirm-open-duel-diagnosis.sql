-- ─────────────────────────────────────────────
-- READ-ONLY CONFIRMATION. Changes nothing.
--
-- Run this BEFORE applying 20261004000003, to confirm the diagnosis.
--
-- THE ONE THING TO LOOK AT is query 2. If the live open_duel() really is
-- doing matchmaking, its body will MENTION pairing words ('opponent_id',
-- 'matched') and will NOT contain an insert of its own row. A correct
-- open_duel() does the reverse.
--
-- Expected if my diagnosis is right: query 2 shows an insert, and query 3
-- shows the stranded rows.
-- ─────────────────────────────────────────────

-- ── 1. What open_duel overloads actually exist ─────────────────────────────
-- Confirms the return type, which is why CREATE OR REPLACE cannot work and
-- 20261004000003 drops first.
select p.oid::regprocedure::text as signature,
       pg_get_function_result(p.oid) as returns
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'open_duel'
 order by 1;

-- ── 2. THE SMOKING GUN: the live body of open_duel ─────────────────────────
-- Read the prosrc cell.
--
-- CORRECT  -> contains "insert into" for stake_challenges, sets status
--             'playing', has NO matchmaking.
-- PATCHED  -> contains 'matched' and 'opponent_id', and either has no insert
--             or does not return its own new id.
select pg_get_function_identity_arguments(p.oid) as args,
       p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'open_duel';

-- ── 3. Which of the signals this body shows ────────────────────────────────
-- Same position() trick as 20261004000000, because Postgres uses POSIX ARE
-- and has no {m,n} interval quantifiers -- a v1 of the diagnostic died on that.
select pg_get_function_identity_arguments(p.oid) as args,
       position('insert into' in p.prosrc) > 0         as inserts_a_row,
       position('opponent_id' in p.prosrc) > 0       as mentions_opponent,
       position('matched' in p.prosrc) > 0           as mentions_matched,
       position('gen_random_uuid' in p.prosrc) > 0   as mints_own_id,
       length(p.prosrc)                              as body_len
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'open_duel';

-- ── 4. THE STRANDED MONEY ──────────────────────────────────────────────────
-- Rows the patched open_duel() created or marked: status='matched' but
-- settled_at is null, which means they claim a pairing but no money ever
-- moved. Their stakes are debited and unrecoverable through the UI.
--
-- THIS IS THE NUMBER THAT DECIDES IF YOU NEED THE CLEANUP.
-- If it is 0, skip the cleanup entirely and just apply 20261004000003.
select count(*)                                   as stranded_rows,
       coalesce(sum(stake), 0)                    as stranded_value,
       array_agg(distinct status)                 as statuses,
       array_agg(distinct game_id)                as games,
       min(created_at)                            as oldest,
       max(created_at)                            as newest
  from public.stake_challenges
 where settled_at is null
   and status = 'matched';

-- ── 5. Who owns that money ─────────────────────────────────────────────────
-- Every distinct player holding a stranded row, so you know the blast radius
-- before deciding what to do. Public profiles are readable by all users, so
-- the join is safe to run here.
select sc.user_id,
       count(*)            as stranded_rows,
       sum(sc.stake)       as stranded_value
  from public.stake_challenges sc
 where sc.settled_at is null
   and sc.status = 'matched'
 group by sc.user_id
 order by stranded_value desc;

-- ── 6. Proof the four restored functions are actually the right ones ───────
-- The rpc pre-flight in the test run already passed for all seven, but this
-- confirms they are the bodies 20261004000001 installed -- i.e. settled_at
-- really is in use, and the lookup really does filter on stake.
select p.oid::regprocedure::text as signature,
       position('settled_at' in p.prosrc) > 0 as uses_settled_at,
       position('c.stake   = mine.stake' in p.prosrc) > 0 as filters_stake,
       position('user_id = me' in p.prosrc) > 0    as scopes_to_caller
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('settle_duel', 'cancel_duel', 'tie_duel', 'forfeit_duel')
 order by 1;

-- ── 7. Does the four-function overload set look right? ─────────────────────
-- 20261004000001 rebuilds exactly eight signatures: four direct + four jsonb
-- wrappers. More than eight means a hand-patch survived its drop block.
select p.proname,
       count(*) as overloads
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('settle_duel', 'cancel_duel', 'tie_duel', 'forfeit_duel')
 group by p.proname
 order by p.proname;