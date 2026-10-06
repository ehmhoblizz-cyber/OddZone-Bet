-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000002_unblock_return_type_conflicts.sql
--
-- UNBLOCKS 20261001000000_reconcile_live_schema.sql, which keeps failing with:
--
--   ERROR: 42P13: cannot change return type of existing function
--   HINT:  Use DROP FUNCTION <name>(<args>) first.
--
-- It has now failed on ensure_profile(text,text) and then on wallet_balance().
-- Rather than discovering them one at a time, this drops EVERY function that
-- 20261001000000 is about to define, in one pass.
--
-- ── WHY THIS IS NECESSARY ─────────────────────────────────────────────────
-- Postgres treats a function's return type as part of its identity. CREATE OR
-- REPLACE can change the body but can NEVER change the return type -- only a
-- DROP followed by a CREATE can. The live database has hand-patched versions of
-- these functions whose return types differ from the ones the migrations
-- declare, so the migration cannot apply until they are gone.
--
-- ── WHY THIS IS SAFE ──────────────────────────────────────────────────────
-- 1. It only drops FUNCTIONS. It never touches a table, a column, a row or a
--    view, so no data can be lost.
-- 2. Every function dropped here is immediately recreated by 20261001000000
--    (and, for the four duel RPCs, again by
--    20261004000001_restore_odddzone_duel_functions.sql). Run those next.
-- 3. The GRANTs are re-issued by those same migrations, so dropping does not
--    leave a hole in the browser role.
-- 4. CASCADE is used deliberately. The only dependants are the
--    profiles_touch_updated_at trigger and the grants; 20261001000000 recreates
--    that trigger immediately after recreating the function. Nothing else in
--    this project depends on any of them.
-- 5. SAFE TO RUN MORE THAN ONCE. A second run finds nothing, says so, and
--    changes nothing.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--   1. this file
--   2. 20261001000000_reconcile_live_schema.sql
--   3. 20261003000001_duel_search_and_solo.sql
--   4. 20261004000001_restore_odddzone_duel_functions.sql
--
-- Step 2 has NOT succeeded on your database yet, so the columns it adds
-- (stake_challenges.refund_amount / .winner_id, bets.creator_score /
-- .opponent_score) are still missing. Step 4's pre-flight will keep refusing
-- until step 2 actually completes.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_dropped  text := '';
  r          record;
  v_name     text;
  v_targets  text[] := array[
    'ensure_profile',            -- (text, text)
    'wallet_balance',            -- ()
    'open_duel',                 -- (text, bigint, bigint)
    'settle_duel',               -- (text, bigint)
    'cancel_duel',               -- (text)
    'tie_duel',                  -- (text)
    'forfeit_duel',              -- (text)
    'record_deposit',            -- (bigint, text)
    'expire_stale_challenges',   -- (integer)
    'touch_updated_at'           -- () returns trigger
  ];
begin
  foreach v_name in array v_targets loop
    for r in
      select p.oid::regprocedure as sig,
             pg_get_function_result(p.oid) as returns
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = v_name
    loop
      -- The return type is the entire reason for the drop, so it is logged.
      -- Seeing it here is how we confirm the hand-patch.
      v_dropped := v_dropped
        || format('    %s  returns %s', r.sig, r.returns)
        || E'\n';
      execute format('drop function if exists %s cascade', r.sig);
    end loop;
  end loop;

  if v_dropped = '' then
    raise notice 'UNBLOCK: none of the target functions exist in public. Nothing was dropped.';
  else
    raise notice 'UNBLOCK: dropped so 20261001000000 can recreate them:%', E'\n' || v_dropped;
    raise notice 'UNBLOCK: NOW RUN 20261001000000, then 20261003000001, then 20261004000001.';
  end if;
end $$;
