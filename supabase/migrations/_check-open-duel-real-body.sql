-- ─────────────────────────────────────────────
-- READ-ONLY. Changes nothing. Safe to run.
--
-- No verdicts, no CASE logic, no guessing. This just prints the bodies.
--
-- Why I stripped it down: the two previous versions of this query both
-- produced a WRONG answer -- one read the wrong function because of the sort
-- order, one had a syntax error. A query that COMPUTES a judgement can be
-- wrong in ways you then have to debug. A query that just PRINTS the thing
-- cannot mislead you. So this one shows the evidence and decides nothing.
--
-- HOW TO READ THE RESULT
--
--   Two rows come back, because open_duel has two overloads: the real
--   function and a jsonb wrapper.
--
--   The REAL one is the LONGER row -- the wrapper is a one-line forwarder,
--   roughly 120-160 characters.
--
--   In that longer body, look for ONE thing:
--
--       does it INSERT a row into stake_challenges?
--
--   YES -> open_duel is CORRECT and innocent. The bug is somewhere else --
--          most likely claim_duel_opponent, or the index.html path that calls
--          it right after open_duel. Send me the body and I will find the
--          real cause.
--   NO  -> open_duel really does pair instead of creating a row, which is
--          exactly the fault 20261004000003 fixes. Send me the body and I
--          will apply that migration.
--
-- Either way, paste the longer body back to me.
-- ─────────────────────────────────────────────

select
  length(p.prosrc)                          as body_length,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid)             as returns,
  p.prosrc                                  as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'open_duel'
 order by length(p.prosrc) desc;