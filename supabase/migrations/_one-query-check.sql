-- ─────────────────────────────────────────────
-- ONE QUERY. Read this, paste it in, run it, send me the single row back.
--
-- This answers the only open question: does the live open_duel() create a row
-- for the caller, or does it pair instead?
--
--   verdict = 'PAIRED, NO OWN ROW'  -> my diagnosis is right. Apply
--                                      20261004000003_restore_open_duel_no_pairing.sql
--   verdict = 'OK, INSERTS OWN ROW' -> I am wrong about the cause. Do NOT apply
--                                      20261004000003. Send me this output and
--                                      we look somewhere else.
--
-- READ-ONLY. Changes nothing. Safe to run.
-- ─────────────────────────────────────────────

select
  case
    when position('insert into' in p.prosrc) = 0
      then 'PAIRED, NO OWN ROW'
    when position('opponent_id' in p.prosrc) > 0
      or position('''matched''' in p.prosrc) > 0
      then 'PAIRED, NO OWN ROW'
    else 'OK, INSERTS OWN ROW'
  end as verdict,

  -- the same answer, as raw evidence, so the verdict above is auditable
  position('insert into' in p.prosrc)       > 0 as inserts_a_row,
  position('opponent_id' in p.prosrc)     > 0 as mentions_opponent_id,
  position('''matched''' in p.prosrc)     > 0 as mentions_matched,
  position('gen_random_uuid' in p.prosrc) > 0 as mints_own_id,
  position('wallet_balance' in p.prosrc)  > 0 as debits_the_stake,
  length(p.prosrc)                            as body_length,

  pg_get_function_result(p.oid)                as returns,

  -- how many overloads exist; 1 is what a correct open_duel looks like
  (select count(*)::int
     from pg_proc q
     join pg_namespace m on m.oid = q.pronamespace
    where m.nspname = 'public' and q.proname = 'open_duel') as overload_count

  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'open_duel'
 order by 1
 limit 1;