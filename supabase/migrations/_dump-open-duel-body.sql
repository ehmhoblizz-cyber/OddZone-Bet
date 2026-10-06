-- ─────────────────────────────────────────────
-- READ-ONLY. Changes nothing. Safe to run.
--
-- PRINTS THE open_duel BODY IN CHUNKS, so it can be read on the SQL editor
-- instead of being scrolled through one enormous cell.
--
-- WHAT WE ALREADY KNOW (from the DECLARE block you pasted):
--   v_bal_col    TEXT   -> probes information_schema for the balance column
--                         and EXECUTE's a built UPDATE against it. Same defect
--                         described in 20261004000001's header as #4: the real
--                         column is wallet_balance, and the probe returns NULL
--                         when the table is empty, so a credit can silently
--                         vanish.
--   v_existing   RECORD -> a record variable, consistent with matchmaking
--                         against an existing waiting challenge.
--   v_new_id     UUID   -> mints an id, consistent with inserting a row.
--
-- So it is definitively NOT any version in this repo. Still unknown: whether
-- it ALSO inserts a row of its own, which decides the fix.
--
-- ── HOW TO READ ────────────────────────────────────────────────────────────
-- Each row is one 400-character slice, numbered from 1, in order.
--
-- The two things to look for:
--   INSERT INTO ... stake_challenges  -> does it create MY OWN row?
--   RETURN jsonb_build_object(...)    -> does the response carry a 'matched'
--                                        key? That key is what made step 2 of
--                                        the test log return "matched":true,
--                                        and NO version of open_duel in this
--                                        repo emits it.
--
-- Only the long body is printed: the jsonb wrapper is a one-line forwarder and
-- would be pure noise here.
-- ─────────────────────────────────────────────

select
  (g / 400)                             + 1 as slice_no,
  (g % 400)                             + 1 as char_from,
  least((g % 400) + 400, length(p.prosrc)) as char_to,
  substring(p.prosrc from (g % 400) + 1 for 400) as body_slice
  from pg_proc p
  join pg_namespace ns
    on ns.oid = p.pronamespace
  cross join generate_series(0, length(p.prosrc) - 1, 400) as g
 where ns.nspname = 'public'
   and p.proname = 'open_duel'
   and length(p.prosrc) > 400
 order by length(p.prosrc) desc, g;