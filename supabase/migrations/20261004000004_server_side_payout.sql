-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000004_server_side_payout.sql
--
-- CLOSES A BALANCE-MINTING HOLE IN open_duel().
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- open_duel(p_game_id, p_stake, p_payout) took the PAYOUT from the client and
-- stored it verbatim:
--
--     insert into public.stake_challenges (id, user_id, game_id, stake, payout, ...)
--     values (new_id::uuid, me, p_game_id, p_stake, p_payout, 0, 'playing');
--
-- and settle_duel() then paid exactly that number out of thin air:
--
--     update public.profiles set wallet_balance = wallet_balance + mine.payout
--
-- A tampered client -- one console line, no DevTools form editing required --
-- calls open_duel with p_stake = 100 and p_payout = 10000000, wins the duel, and
-- credits itself ten million naira that no deposit ever produced. forfeit_duel()
-- pays opp_row.payout on the same stored value, so the same forged row drains
-- through either path.
--
-- The preset-stake check added in 20261001000000 section 6a does NOT close this.
-- It validates p_stake. p_payout was never validated by anything at all -- and
-- nothing in the schema ties payout to stake, so the two are independent inputs
-- to a money-moving write.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- The payout is DERIVED, never supplied:
--
--     payout := floor(p_stake * 2 * (1 - rake))
--
-- matching RAKE_PERCENT = 10 in index.html. It is computed once, stored on the
-- row, and every later read of that row's payout (settle_duel, forfeit_duel, the
-- bets mirror) is unchanged -- so this only removes the ability to lie about the
-- number at creation time.
--
-- ── WHY THE 3-ARGUMENT SIGNATURE SURVIVES ───────────────────────────────────
-- PostgREST resolves .rpc() by name AND argument list. Two overloads of
-- different arity cannot both accept one call, so a 3-arg form plus a 2-arg form
-- is not PGRST203 ambiguity -- same reasoning as the jsonb wrappers in
-- 20261004000001.
--
-- The 3-argument form is kept as a FORWARDER that discards p_payout, for two
-- reasons:
--
--   1. Every already-deployed page in every open browser tab calls
--      client.rpc('open_duel', { p_game_id, p_stake, p_payout }) at
--      index.html:4058. Dropping the signature outright would turn the hole into
--      an outage for anyone who had not reloaded.
--   2. It means no client needs a coordinated deploy to become safe. An old tab
--      that still sends a forged p_payout gets it ignored, not honoured.
--
-- The forwarded body is where the money logic lives -- one copy only, so the two
-- signatures can never disagree.
--
-- ── WHY DROP BEFORE CREATE ──────────────────────────────────────────────────
-- Return type changes need DROP, not CREATE OR REPLACE. Dropped WITHOUT CASCADE
-- so a genuine dependency aborts this migration loudly instead of silently
-- taking the dependant with it. Nothing depends on open_duel -- the client
-- calls it over HTTP, which is not a dependency.
--
-- ── ALSO FIXED HERE: TWO LISTS THAT HAD DRIFTED ─────────────────────────────
-- Both were rejecting legal client input while the client happily offered it.
--
--   a) stake presets. index.html offered 500/1000/2000/5000 as buttons AND a
--      free-text "Custom" box with min="200" and step="100" that accepted any
--      number. The database accepted only {100, 500, 1000, 2000, 5000}. So
--      typing a legal ₦1,500 threw "not an approved preset" from the server AFTER
--      the player pressed the button, and the ₦100 preset -- deliberately added
--      when the range check was replaced -- was unreachable. The client has been
--      changed to match this list; this list is unchanged.
--
--   b) approved game ids. GAME_CATALOG (index.html:1678) has ten games, and
--      block-blast is one of the four on the Popular rail. The whitelist had
--      nine and omitted it, so staking Block Blast -- the game's whole point --
--      was rejected. The comment here claimed "the nine ids there", which was
--      true when written and stopped being true when block-blast was added.
--      Adding a game to the catalog without adding it here silently bricks
--      staking for that game, so this list must stay in sync.
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
-- open_duel(text, bigint) -- the real implementation. p_payout does not exist
-- here at all, so there is nothing for a caller to lie with.
-- ═══════════════════════════════════════════════════════════════════════════
create function public.open_duel(
  p_game_id text,
  p_stake   bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  bal      bigint;
  new_id   text;
  payout   bigint;
  c_rake   numeric := 0.10;
begin
  if me is null then
    raise exception 'You must be signed in to stake real money.';
  end if;

  -- ── Membership test against the approved presets ───────────────────────────
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

  -- ── Approved game ids ─────────────────────────────────────────────────────
  --
  -- game_id is a bare text column. Without this check any string opens a "duel"
  -- -- a real row with a real debit behind it -- and that row can never match an
  -- opponent, so the stake is stranded until the stale sweep cleans it up.
  --
  -- MUST be kept in sync with GAME_CATALOG in index.html. Duplicated on purpose:
  -- the client list is UX and is client-tamperable, so the database is the
  -- authority on what a real game is.
  --
  -- block-blast was missing here: it is in the catalog and on the Popular rail,
  -- so every Block Blast stake was rejected until this line was added.
  if not exists (
       select 1
         from unnest(array[
                'star-shooter-3d', 'pacman', 'pipe-hopper', 'breakout',
                'cave-runner', 'memory-match', 'neon-serpent', 'hextris',
                'piano-tiles', 'block-blast'
              ]) as allowed(game_id)
        where allowed.game_id is not distinct from p_game_id
     ) then
    raise exception
      'Game % is not an approved game id.', coalesce(p_game_id, 'null');
  end if;

  -- ── THE FIX: the payout is derived here and nowhere else ──────────────────
  --
  -- Both sides stake p_stake, so the gross pot is 2 * p_stake and the winner
  -- takes it net of a 10% rake -- the same figure the client's Stake & Payout
  -- Breakdown panel displays, so the number shown before the click is still the
  -- number that lands.
  --
  -- Stored once on the row. settle_duel() and forfeit_duel() keep reading
  -- mine.payout / opp_row.payout unchanged, and both are now reading a value no
  -- caller could influence.
  --
  -- bigint throughout: p_stake * 2 overflows integer arithmetic well before any
  -- legal stake does, and a silently wrapped payout is a paying-out-the-wrong-
  -- amount bug.
  payout := floor(p_stake * 2 * (1 - c_rake))::bigint;

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

  -- This row belongs to ME and to nobody else, and it is left in 'playing' --
  -- the unpaired, unplayed state that settle_duel(), tie_duel(),
  -- forfeit_duel() and claim_duel_opponent() all search for. open_duel() does no
  -- matchmaking; pairing is claim_duel_opponent()'s job.
  insert into public.stake_challenges (id, user_id, game_id, stake, payout, score, status)
  values (new_id::uuid, me, p_game_id, p_stake, payout, 0, 'playing');

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Stake – ' || p_game_id, 'stake', p_stake,
          'Waiting for an opponent. Reference: ' || new_id);

  return jsonb_build_object(
    'challenge_id', new_id,
    'stake',       p_stake,
    'payout',      payout,
    'balance',     bal - p_stake
  );
end;
$$;

revoke all on function public.open_duel(text, bigint) from public;
grant execute on function public.open_duel(text, bigint) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- open_duel(text, bigint, bigint) -- compatibility forwarder.
--
-- p_payout is accepted and IGNORED. The parameter is named exactly so an
-- existing caller sending {'p_game_id': ..., 'p_stake': ..., 'p_payout': ...}
-- resolves cleanly; there is deliberately no default value that would make this
-- form reachable without it, because a forged payout must be a visible no-op
-- rather than a silent one.
--
-- Retiring this: once every open tab has been reloaded and index.html no longer
-- sends p_payout (it now sends only p_game_id and p_stake), this overload can be
-- dropped in a later migration with no client impact.
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
begin
  return public.open_duel(p_game_id, p_stake);
end;
$$;

revoke all on function public.open_duel(text, bigint, bigint) from public;
grant execute on function public.open_duel(text, bigint, bigint) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache, LAST -- PostgREST re-reads pg_proc on this
-- signal, so anything created after it would be missing from the cache.
-- ═══════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';