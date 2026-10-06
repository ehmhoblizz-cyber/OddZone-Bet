-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000003_restore_open_duel_no_pairing.sql
--
-- FIXES THE ROOT CAUSE BEHIND EVERY FAILING CHECK IN THE DUEL TEST RUN.
--
-- ── THE SYMPTOM ────────────────────────────────────────────────────────────
-- Step 3 of _test-duel-flow.mjs:
--
--   PASS  B opened a duel :: {"stake":1000,"payout":1800,"balance":0,
--                             "matched":true,
--                             "challenge_id":"92dfadef-a017-4ef8-85ed-71cab3529ab8"}
--
-- ...and step 1 had just returned that SAME id for A:
--
--   PASS  challenge_id returned :: 92dfadef-a017-4ef8-85ed-71cab3529ab8
--
-- B did not get a challenge of its own. B was handed A's row.
--
-- ── WHAT THE LIVE open_duel() ACTUALLY DOES ────────────────────────────────
-- It performs MATCHMAKING inside open_duel(): on B's call it finds A's waiting
-- challenge, pairs the two, and returns A's challenge_id rather than inserting
-- a row owned by B.
--
-- That body exists in NO file in this repository:
--
--   20260928000000_create_bets_tables.sql  -> inserts a row, no matchmaking
--   20261001000000_reconcile_live_schema.sql -> inserts a row, no matchmaking
--
-- Both define the same contract this migration restores. It is a fourth
-- hand-patched body, alongside the settle_duel one that
-- 20261004000001_restore_odddzone_duel_functions.sql already replaced.
--
-- ── WHY ONE FAULT PRODUCED NINETEEN FAILURES ──────────────────────────────
-- Every check that failed is downstream of B never owning a row:
--
--   step 3  B settles cid2, which is A's row. settle_duel scopes its read to
--           `and user_id = me`, so it raises 'Challenge % not found for this
--           user.' Nothing settles, so nobody is paid.
--   step 4  follows from step 3: B was never credited, so B is still 0.
--   step 5  follows from step 3: since nothing ever settled, A's re-settle
--           correctly returns 200 {'status':'queued'}. The assertion expected a
--           rejection, which only exists after a successful settle.
--   step 6  B has no money (step 4), so open_duel raises 'Insufficient
--           balance'. o3.body.challenge_id is then undefined, and
--           JSON.stringify DROPS undefined keys -- so cancel_duel is posted
--           with an EMPTY object and PostgREST answers PGRST202, which reads
--           like a missing function but is a missing argument.
--   step 7  the identical cascade: t2 failed on balance, so the settle call
--           went out without p_challenge_id and PGRST202'd again.
--   step 8b both opens returned the same row, so tie_duel found no opponent
--           with `user_id <> me` and returned matched=false.
--   step 8c identical, for forfeit_duel.
--
-- Steps 9, 10, 11 and every schema pre-flight passed throughout, which is the
-- tell: a missing function or a missing column cannot leave those green.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- Restore the open_duel() that every other file already describes and that the
-- client was written against:
--
--   1. Insert ONE new row owned by the caller, status='playing'.
--   2. Debit the stake in the same transaction.
--   3. Return THIS row's id.
--   4. Do no matchmaking. Pairing is somebody else's job.
--
-- index.html (4058-4103) reads only `challenge_id` and `balance` from this
-- response and then calls beginDuelSearch() -> claim_duel_opponent(). It never
-- reads a 'matched' key from open_duel. So removing the pairing from open_duel
-- costs the client nothing -- that key was never part of its contract.
--
-- ── NOTHING BREAKS BY MAKING PAIRING HAPPEN LATER ──────────────────────────
-- Every consumer of a second waiting row already searches for one itself:
--
--   settle_duel()   unpaired branch: `c.opponent_id is null
--                    and c.status in ('playing','queued')`
--   tie_duel()      same shape
--   forfeit_duel()  same shape, and its comment already notes 'playing' is the
--                    unpaired unplayed state open_duel produces
--   claim_duel_opponent()  enters the queue, then pairs on game + stake
--
-- So the row this migration starts in 'playing' is findable by all four. That
-- is why 20261001000000 section 6 was written that way and why the restored
-- 20261004000001 functions bank, tie and settle against it correctly.
--
-- ── WHY DROP BEFORE CREATE ─────────────────────────────────────────────────
-- Postgres cannot change a function's return type with CREATE OR REPLACE, and
-- the live body was hand-patched. 20261004000002 drops these same functions for
-- exactly this reason; this one is separated out because the return-type clash
-- is confined to open_duel and does not need to hold up the reconcile file.
--
-- Dropped WITHOUT CASCADE on purpose: if anything genuinely depends on
-- open_duel the migration fails loudly and rolls back, rather than silently
-- deleting the dependant. Nothing depends on it -- the client calls it over
-- HTTP, which is not a dependency.
--
-- ── WHY A NEW FILE AND NOT AN EDIT TO 20261001000000 ────────────────────────
-- 20261001000000 has already been applied to the live database (its columns
-- passed this run's schema pre-flight). Editing it would not change what is
-- deployed. Migrations are forward-only; this file is the forward fix.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'open_duel'
  loop
    execute format('drop function if exists %s', r.sig);
    raise notice 'dropped %', r.sig;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- open_duel(text, bigint, bigint) -- debit the stake, create MY row, pair
-- nothing.
--
-- Body reproduced from 20261001000000_reconcile_live_schema.sql section 6,
-- which is the same contract as 20260928000000 section "open_duel" with the
-- three live-schema repairs applied: uuid ids instead of the rejected
-- 'CHLG-...' text form, the approved-stake membership test, and the
-- approved-game-id test. All three are kept, and all three are load-bearing
-- against real money.
-- ═══════════════════════════════════════════════════════════════════════════
create function public.open_duel(
  p_game_id text,
  p_stake   bigint,
  p_payout  bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  bal    bigint;
  new_id text;
begin
  if me is null then
    raise exception 'You must be signed in to stake real money.';
  end if;

  -- ── Membership test against the approved presets ──────────────────────────
  --
  -- A range check only ever BOUNDED the amount; a client could still post any
  -- integer inside it (333, 777, 1234), which is exactly the shape of value a
  -- preset economy exists to rule out. Membership, not range: 100 is below the
  -- old 200 floor, so this deliberately widens the bottom and the range check
  -- must not survive alongside it.
  --
  -- exists() over unnest() with an equality predicate, so a null p_stake yields
  -- false rather than a null result that would skip the IF and reach the debit
  -- with a null stake. p_stake is compared as bigint against bigint, never text.
  if not exists (
       select 1
         from unnest(array[100::bigint, 500, 1000, 2000, 5000]) as allowed
        where allowed = p_stake
     ) then
    raise exception
      'Stake % is not an approved preset. Choose one of: 100, 500, 1000, 2000, 5000.',
      coalesce(p_stake::text, 'null');
  end if;

  -- ── Approved game ids ────────────────────────────────────────────────────
  --
  -- game_id is a bare text column. Without this check any string opens a "duel"
  -- -- a real row with a real debit behind it -- and that row can never match an
  -- opponent, so the stake is stranded until the stale sweep cleans it up.
  --
  -- MUST be kept in sync with GAME_CATALOG in index.html. Duplicated on purpose:
  -- the client list is UX and is client-tamperable, so the database is the
  -- authority on what a real game is.
  if not exists (
       select 1
         from unnest(array[
                'star-shooter-3d', 'pacman', 'pipe-hopper', 'breakout',
                'cave-runner', 'memory-match', 'neon-serpent', 'hextris',
                'piano-tiles'
              ]) as allowed(game_id)
        where allowed.game_id is not distinct from p_game_id
     ) then
    raise exception
      'Game % is not an approved game id.', coalesce(p_game_id, 'null');
  end if;

  -- Lock the profile row so two duels opened at once cannot both pass the
  -- balance check against the same starting balance.
  select wallet_balance into bal
    from public.profiles
   where id = me
     for update;

  if bal is null then
    raise exception 'No wallet found. Please reload the page and try again.';
  end if;

  if bal < p_stake then
    raise exception 'Insufficient balance. You have % naira.', bal;
  end if;

  -- ── The id must be a real uuid ────────────────────────────────────────────
  -- 20260928 built 'CHLG-' || <timestamp> || '-' || <rand> and inserted it
  -- directly. This project's stake_challenges.id is a uuid column and Postgres
  -- has NO implicit text->uuid assignment cast in an INSERT, so the whole call
  -- was rejected:
  --     column "id" is of type uuid but expression is of type text   (42804)
  -- It cannot be the human-readable CHLG- form either: that is not a valid
  -- uuid, so casting it would fail 22P02 instead. gen_random_uuid() is built in
  -- on Supabase, so no extension is needed.
  --
  -- The client treats this as an opaque string and nothing displays it.
  new_id := gen_random_uuid()::text;

  update public.profiles
     set wallet_balance = wallet_balance - p_stake
   where id = me;

  -- THE FIX, in one line: this row belongs to ME and to nobody else, and it is
  -- left in 'playing' -- the unpaired, unplayed state that settle_duel(),
  -- tie_duel(), forfeit_duel() and claim_duel_opponent() all search for.
  --
  -- Nothing below this point pairs anybody. Previously B's call found A's
  -- waiting row and returned A's id, so B owned nothing to settle, tie,
  -- forfeit or cancel -- see the header note for the nineteen failures that
  -- followed from it.
  insert into public.stake_challenges (id, user_id, game_id, stake, payout, score, status)
  values (new_id::uuid, me, p_game_id, p_stake, p_payout, 0, 'playing');

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Stake – ' || p_game_id, 'stake', p_stake,
          'Waiting for an opponent. Reference: ' || new_id);

  return jsonb_build_object(
    'challenge_id', new_id,
    'stake',       p_stake,
    'payout',      p_payout,
    'balance',     bal - p_stake
  );
end;
$$;

revoke all on function public.open_duel(text, bigint, bigint) from public;
grant execute on function public.open_duel(text, bigint, bigint) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache, LAST, for the same reason
-- 20261004000001 does it last: PostgREST re-reads pg_proc on this signal, so
-- anything created after it would be missing from the cache it builds.
-- ═══════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';