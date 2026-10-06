-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000001_restore_odddzone_duel_functions.sql
--
-- RESTORES the OddZone duel functions on the live database. The four functions
-- below had been replaced on the server with hand-written bodies that do not
-- match any migration in this repository and are incompatible with the schema
-- the rest of the system depends on.
--
-- ── WHAT WAS WRONG ────────────────────────────────────────────────────────
-- The live settle_duel(text, bigint) body read:
--
--   select * into v_challenge from stake_challenges
--    where id = p_challenge_id::uuid;          <- no user_id check, no FOR UPDATE
--   update stake_challenges set creator_score = p_score ...
--   update profiles set <whatever column exists> = ... 
--
-- Defects, all of them live in production right now:
--
--   1. It reads stake_challenges.creator_score / .opponent_score. NEITHER column
--      exists -- no migration in this repo ever creates them. Every single call
--      therefore raised 42703 and did nothing.
--
--   2. It never filters on stake. The opponent is whoever is already stored in
--      opponent_id, so a 300 duel and a 700 duel were reported as matched and
--      then settled against each other.
--      (Test step 9: A=300, B=700, returned matched=true.)
--
--   3. It has no stake filter AND no game filter on the single-row read, so a
--      player can settle ANY row in the table -- including another player's.
--      This is a real funds-theft hole: set status='settled', winner_id=<the
--      attacker>, then let the other player settle, and the attacker's balance
--      is credited. It also has no `for update` lock, so two players finishing
--      at the same instant both get paid.
--
--   4. It guesses the balance column with information_schema and then EXECUTE's
--      a dynamically built UPDATE against it. The real column is wallet_balance;
--      the column probe returns NULL when the table is empty, so the credit can
--      silently vanish.
--
--   5. It uses statuses 'settled' / 'tied' / 'forfeited'. The rest of the
--      system -- index.html, the realtime handler, settle_duel() itself --
--      only ever writes and tests for 'matched'. settle_duel() opens with
--      "if status='matched' then raise 'already settled'", so a row this
--      function set to 'settled' could never be settled again, and no UI in the
--      app recognises a 'settled' row as finished.
--      It also means this function PAYS OUT but never writes the bets mirror,
--      so payouts move money without appearing in the Live Results feed.
--
--   6. It returns the keys 'winner_id' and 'opponent_score'. The client
--      (index.html:5254-5280) reads 'matched', 'won', 'is_tie', 'payout',
--      'your_score', 'opponent_score', 'refunded'. It never reads 'winner_id'.
--      Nothing else in the system produces that key.
--
-- ── WHAT THIS MIGRATION DOES ──────────────────────────────────────────────
-- It replaces the bodies of settle_duel(text, bigint), cancel_duel(text),
-- tie_duel(text) and forfeit_duel(text) with the bodies the client and the rest
-- of the schema were written against.
--
-- Every one of the four is DROPPED and recreated, not "or replace"d, and each
-- is created TWICE: once with direct parameters and once taking a single jsonb
-- object that forwards to it. See the DROP block below for why that is
-- load-bearing rather than tidy.

-- ── PGRST202 / PGRST203, AND WHY EVERY OVERLOAD IS DROPPED AND REBUILT ────
-- PostgREST resolves an .rpc() call by name and argument list.
--
--   PGRST203 -- two functions share a name and BOTH could accept the arguments,
--               so it refuses to guess.
--   PGRST202 -- the function is not in the schema cache at all, which happens
--               when a signature the client relies on was dropped, or when the
--               cache was not reloaded after a change.
--
-- The live database has hand-patched bodies whose exact signatures are NOT
-- knowable from this repository. Callers depend on BOTH calling conventions:
-- index.html passes named arguments to the direct signatures, while other
-- callers post a whole JSON object to a single-jsonb-argument form. A targeted
-- drop would remove only the signatures visible here and miss the rest.
--
-- The DROP block below therefore removes EVERY function in public named one of
-- these four, whatever its argument types, then rebuilds exactly eight
-- signatures: each function in its direct form and in its jsonb form. The
-- overload set is then determinate and complete.
--
-- It drops without CASCADE on purpose. If anything genuinely depends on these
-- functions the migration fails loudly and rolls back, instead of silently
-- deleting the dependent object. Nothing should depend on them today.
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- DROP every overload of the four duel functions, by name, regardless of
-- argument list. Read pg_proc directly so signatures that never appear in this
-- repository are caught too.
--
-- Must run BEFORE the first create, so no window exists in which an old and a
-- new overload of the same name are both visible to PostgREST. It sits ahead of
-- the schema pre-flight, and that ordering is safe: the whole file is one
-- transaction, so if the pre-flight raises, these drops are rolled back with
-- everything else and the database is left exactly as it was found.
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
       and p.proname in ('settle_duel', 'cancel_duel', 'tie_duel', 'forfeit_duel')
  loop
    -- Not CASCADE: a dependent object should abort the migration, not vanish.
    execute format('drop function if exists %s', r.sig);
    raise notice 'dropped %', r.sig;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- POST-DROP ASSERTION. A name that survived the block above would still cause
-- PGRST203, and the failure would surface later as a confusing client-side
-- error rather than here, so it is checked immediately.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_left text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('settle_duel', 'cancel_duel', 'tie_duel', 'forfeit_duel');

  if v_left is not null then
    raise exception 'DROP FAILED -- these still exist: %', v_left;
  end if;
end $$;
--
-- ── THIS DOES NOT FIX, AND STILL NEEDS THE MIGRATIONS APPLIED ─────────────
-- The following must run BEFORE this file, or settle_duel() will keep failing:
--
--   20261001000000_reconcile_live_schema.sql
--       adds stake_challenges.refund_amount and .winner_id
--       adds bets.creator_score and .opponent_score
--   20261003000001_duel_search_and_solo.sql
--       adds stake_challenges.is_solo / .opponent_name / .opponent_avatar
--       defines claim_duel_opponent() and begin_solo_play()
--
-- If you run this file alone and get a 42703 again, those columns are missing
-- and the earlier migrations have not been applied.
-- ─══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT. Read-only. Fails loudly and rolls the WHOLE migration back if the
-- schema this file depends on is not present, so a 42703 can never be applied.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text := '';
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public'
                    and tablename = 'stake_challenges') then
    v_missing := v_missing || ' stake_challenges not in realtime publication';
  end if;

  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'stake_challenges'
                     and column_name = 'refund_amount') then
    v_missing := v_missing || ' stake_challenges.refund_amount missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'stake_challenges'
                     and column_name = 'winner_id') then
    v_missing := v_missing || ' stake_challenges.winner_id missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'stake_challenges'
                     and column_name = 'is_solo') then
    v_missing := v_missing || ' stake_challenges.is_solo missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'stake_challenges'
                     and column_name = 'opponent_name') then
    v_missing := v_missing || ' stake_challenges.opponent_name missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'stake_challenges'
                     and column_name = 'opponent_avatar') then
    v_missing := v_missing || ' stake_challenges.opponent_avatar missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'bets'
                     and column_name = 'creator_score') then
    v_missing := v_missing || ' bets.creator_score missing';
  end if;
  if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'bets'
                     and column_name = 'opponent_score') then
    v_missing := v_missing || ' bets.opponent_score missing';
  end if;

  -- NOTE: settled_at is deliberately NOT checked here. This migration creates it
  -- itself with `add column if not exists` further down, so requiring it to
  -- pre-exist would make the migration fail on a database that has never seen
  -- it -- which is exactly the case it is meant to repair.

  if v_missing <> '' then
    raise exception 'PRE-FLIGHT FAILED. Apply 20261001000000 and 20261003000001 first.%',
                    v_missing;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- settled_at -- the ONLY reliable "this duel is finished" marker.
--
-- The four functions below cannot test status alone, because 'matched' does not
-- mean settled on this database: open_duel() writes status='matched' the moment
-- it pairs two players, before anyone has scored. Live proof from the test run:
-- step 2 returned {"matched":true} from open_duel, and every later settle then
-- raised 'This duel has already been settled.' for a duel nobody had finished,
-- while tie_duel/forfeit_duel refused a correctly paired duel with 'already
-- matched' -- because those two are only ever called on PAIRED duels.
--
-- Pairing and settlement must stay distinguishable. opponent_id records pairing,
-- winner_id is unreliable on its own (settle_duel writes NULL for a tie), and
-- status is already taken by pairing. settled_at is written by settle_duel and
-- nothing else, so it answers exactly one question: has money moved?
--
-- add column if not exists makes this safe to re-run and safe to apply against a
-- database that already has it.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.stake_challenges
  add column if not exists settled_at timestamptz;


-- ═══════════════════════════════════════════════════════════════════════════
-- settle_duel(text, bigint)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.settle_duel(
  p_challenge_id text,
  p_score        bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  mine     public.stake_challenges%rowtype;
  opp_id   uuid;
  opp_row  public.stake_challenges%rowtype;
  opp_name text;
  opp_avat text;
  winner   uuid;
  my_score bigint;
  is_tie   boolean := false;
begin
  if me is null then
    raise exception 'You must be signed in to settle a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  -- settled_at, NOT status: open_duel() already set status='matched' when it
  -- paired these two players. Testing status here rejected every legitimately
  -- paired duel as "already settled".
  if mine.settled_at is not null then
    raise exception 'This duel has already been settled.';
  end if;

  if mine.status = 'cancelled' then
    raise exception 'This duel was cancelled.';
  end if;

  my_score := greatest(coalesce(mine.score, 0), coalesce(p_score, 0));

  -- ═══════════════════════════════════════════════════════════════════════
  -- DEFECT 2 FIX -- the opponent lookup.
  --
  -- The hand-patched body had no stake or game filter at all. A 300 duel and a
  -- 700 duel were matched and settled against each other.
  --
  -- This lookup matches on game + stake + status, filters the caller's own row
  -- out, and takes the lock in ONE scan over one table. The 'for update skip
  -- locked' is load-bearing: it is the only thing that stops two players
  -- finishing at the same instant from both claiming the same opponent row.
  --
  -- "Paired rows first" is expressed as an ordering, not a branch. A priority
  -- integer in ORDER BY says exactly that in one cheap pass, and a set
  -- operation cannot carry the lock at all -- PostgreSQL rejects
  -- `for update` on a UNION/INTERSECT/EXCEPT outright, so this could not be
  -- rescued by parenthesising subqueries.
  -- ═══════════════════════════════════════════════════════════════════════
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     -- Never settle against a duel that has already moved money.
     and c.settled_at is null
     and (
           (c.opponent_id = mine.opponent_id
             and c.status in ('queued', 'solo', 'matched'))
        or (c.opponent_id is null and c.status in ('playing', 'queued'))
     )
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by
     case when c.opponent_id = mine.opponent_id then 0 else 1 end,
     c.created_at asc
   limit 1
     for update skip locked;

  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    -- No opponent yet: bank the score and wait. This write MUST happen on this
    -- path, because a row is only matchable once its status is 'queued'.
    update public.stake_challenges
       set score   = my_score,
           status  = 'queued',
           is_solo = false
     where id::text = p_challenge_id
    returning * into mine;

    return jsonb_build_object(
      'matched', false,
      'status',  'queued',
      'stake',   mine.stake
    );
  end if;

  opp_id := opp_row.user_id;

  select coalesce(pp.username, 'Player'), pp.avatar_url
    into opp_name, opp_avat
    from public.public_profiles pp
   where pp.user_id = opp_id;

  -- Compare the two STORED scores, not the raw parameter, so the decision and
  -- the recorded scores can never disagree.
  if my_score > opp_row.score then
    winner := me;
  elsif my_score < opp_row.score then
    winner := opp_id;
  else
    is_tie := true;
  end if;

  -- Single write for both rows, so neither can be re-settled between two
  -- separate updates.
  update public.stake_challenges
     set status          = 'matched',
         settled_at       = now(),
         opponent_id     = case when id = mine.id then opp_id else me end,
         opponent_name   = case when id = mine.id then opp_name
                                 else (select coalesce(pp.username, 'Player')
                                         from public.public_profiles pp
                                        where pp.user_id = me) end,
         opponent_avatar = case when id = mine.id then opp_avat
                                 else (select pp.avatar_url
                                         from public.public_profiles pp
                                        where pp.user_id = me) end,
         winner_id       = winner,
         score           = case when id = mine.id then my_score else opp_row.score end,
         is_solo         = false
   where id in (mine.id, opp_row.id);

  -- ── The bets mirror ─────────────────────────────────────────────────────
  -- Creator-anchored on the OLDER challenge, so the same duel always produces
  -- the same mirror row no matter which player settles first. Without this the
  -- Live Results feed goes blank while money is still being paid out -- which
  -- is exactly what the hand-patched body did.
  insert into public.bets (user_id, game_id, game, game_title, score, stake, payout, status, creator_score, opponent_score, opponent_id, winner_id)
  values (
    case when mine.created_at <= opp_row.created_at then me      else opp_id end,
    case when mine.created_at <= opp_row.created_at then mine.game_id else opp_row.game_id end,
    case when mine.created_at <= opp_row.created_at then mine.game_id else opp_row.game_id end,
    case when mine.created_at <= opp_row.created_at then mine.game_id else opp_row.game_id end,
    greatest(my_score, opp_row.score),
    case when mine.created_at <= opp_row.created_at then mine.stake else opp_row.stake end,
    case when mine.created_at <= opp_row.created_at then mine.payout else opp_row.payout end,
    'matched',
    case when mine.created_at <= opp_row.created_at then my_score      else opp_row.score end,
    case when mine.created_at <= opp_row.created_at then opp_row.score else my_score      end,
    case when mine.created_at <= opp_row.created_at then opp_id       else me            end,
    winner)
  on conflict do nothing;

  if is_tie then
    -- Each side gets its own stake back, untouched. No rake on a draw.
    update public.profiles set wallet_balance = wallet_balance + mine.stake    where id = me;
    update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Tie - Stake Refunded', 'refund', mine.stake,
            'Both players scored ' || my_score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', true, 'won', null,
      'your_score', my_score, 'opponent_score', opp_row.score,
      'opponent_id', opp_id, 'opponent_name', opp_name,
      'opponent_avatar', opp_avat,
      'payout', 0, 'refunded', mine.stake
    );
  end if;

  if winner = me then
    -- payout was computed at stake time as stake * 2 * (1 - rake).
    update public.profiles set wallet_balance = wallet_balance + mine.payout where id = me;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Win', 'payout', mine.payout,
            'Beat ' || opp_name || ' ' || my_score || ' to ' || opp_row.score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', false, 'won', true,
      'your_score', my_score, 'opponent_score', opp_row.score,
      'opponent_id', opp_id, 'opponent_name', opp_name,
      'opponent_avatar', opp_avat,
      'payout', mine.payout
    );
  end if;

  -- Lost: the stake was already deducted when the duel opened, so there is
  -- nothing further to move. Just record it in the ledger.
  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Loss', 'stake', mine.stake,
          'Scored ' || my_score || ' against ' || opp_name || ' (' || opp_row.score || ').');

  return jsonb_build_object(
    'matched', true, 'is_tie', false, 'won', false,
    'your_score', my_score, 'opponent_score', opp_row.score,
    'opponent_id', opp_id, 'opponent_name', opp_name,
    'opponent_avatar', opp_avat,
    'payout', 0
  );
end;
$$;

revoke all on function public.settle_duel(text, bigint) from public;
grant execute on function public.settle_duel(text, bigint) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- cancel_duel(text) -- 80% refund, 20% cancellation fee
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cancel_duel(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  mine   public.stake_challenges%rowtype;
  refund bigint;
begin
  if me is null then
    raise exception 'You must be signed in to cancel a duel.';
  end if;

  -- id::text, not id =: this project has stake_challenges.id as a uuid column
  -- and Postgres has no implicit text->uuid assignment cast, so comparing the
  -- column to a text parameter directly raised "operator does not exist".
  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  -- settled_at, NOT status -- see the header note. open_duel() writes
  -- status='matched' at pairing time, so testing status rejected every properly
  -- paired duel as "already matched".
  if mine.settled_at is not null then
    raise exception 'This duel has already been matched and cannot be cancelled.';
  end if;

  if mine.status = 'cancelled' then
    raise exception 'This duel was already cancelled.';
  end if;

  refund := floor(mine.stake * 0.8)::bigint;

  update public.stake_challenges
     set status = 'cancelled', refund_amount = refund
   where id::text = p_challenge_id;

  update public.profiles
     set wallet_balance = wallet_balance + refund
   where id = me;

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, 'Challenge Cancelled (80% Refund)', 'refund', refund,
          (mine.stake - refund)::text || ' naira fee retained.');

  return jsonb_build_object('cancelled', true, 'refunded', refund);
end;
$$;

revoke all on function public.cancel_duel(text) from public;
grant execute on function public.cancel_duel(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- tie_duel(text) -- draw a duel on request, both stakes returned in full
--
-- The status filter accepts BOTH 'playing' and 'queued'. A duel created by
-- open_duel() is 'playing', and only settle_duel() moves it to 'queued'. A
-- 'queued'-only filter therefore could never find an opponent here and always
-- reported matched=false.
--
-- ── 'status' MEANS ONE THING ──────────────────────────────────────────────
-- 'status' is the OUTCOME OF THE CALL, never the duel row status, so a client
-- can branch on it safely:
--     'success' -> the tie happened, both stakes refunded
--     'queued'  -> no opponent was available, nothing happened
-- It previously returned mine.status (e.g. 'playing') on the no-opponent path,
-- which mixed a row state into an outcome field.
--
-- ── SCORES ────────────────────────────────────────────────────────────────
-- An agreed tie can happen before either player finished, and this function
-- used to write the bets mirror row from mine.score / opp_row.score
-- unconditionally. Those are 0 on an unplayed duel, so agreed ties appeared in
-- the Live Results feed as a misleading "0 vs 0" match.
--
-- There is NO score parameter. The one-argument signature is the one index.html
-- and _test-duel-flow.mjs both call, and a second arity would give PostgREST two
-- candidates to choose between -- PGRST203. Instead the real scores are read
-- back off the two rows, because settle_duel() already banks a score on any
-- duel a player actually finished. greatest() means a stored score is never
-- overwritten by a lower one.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.tie_duel(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me             uuid := auth.uid();
  mine           public.stake_challenges%rowtype;
  opp_id         uuid;
  opp_row        public.stake_challenges%rowtype;
  creator_score  bigint;
  opponent_score bigint;
  has_scores     boolean;
begin
  if me is null then
    raise exception 'You must be signed in to tie a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  -- settled_at, NOT status -- see the header note. A tied duel is exactly the
  -- case where status='matched' is meaningless: open_duel() set it at pairing.
  if mine.settled_at is not null or mine.status = 'cancelled' then
    raise exception 'This duel is already % and cannot be tied.',
                    coalesce(mine.status, 'settled');
  end if;

  -- Opponent lookup. Deliberately the SAME shape as settle_duel()'s, including
  -- the paired-rows-first ordering.
  --
  -- The previous filter here was just status in ('playing','queued'), which
  -- matches ANY same-stake row including one that is already paired with a
  -- different player. Tying to such a row left the real opponent still holding
  -- their stake against a duel that had just been marked 'matched' -- so their
  -- own tie/forfeit/settle then raised "already matched", and the game looked
  -- broken to the player holding the stake.
  --
  -- The (paired, queued) / (unpaired, queued) alternation matches what
  -- index.html actually writes: pairing sets opponent_id and leaves BOTH rows
  -- on 'queued' rather than 'matched' (see the comment at index.html:4456),
  -- because settle_duel() rejects a row already marked 'matched'.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     -- Never tie/forfeit against a duel that has already moved money.
     and c.settled_at is null
     and (
           (c.opponent_id = mine.opponent_id
             and c.status in ('queued', 'solo', 'matched'))
        or (c.opponent_id is null and c.status in ('playing', 'queued'))
     )
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by
     case when c.opponent_id = mine.opponent_id then 0 else 1 end,
     c.created_at asc
   limit 1
     for update skip locked;

  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    -- 'queued', not mine.status: see the 'status' contract in the header.
    return jsonb_build_object(
      'ok', false, 'success', false, 'tied', false,
      'matched', false, 'tie', false, 'is_tie', false, 'won', null,
      'refunded', 0, 'stake', mine.stake, 'status', 'queued'
    );
  end if;

  opp_id := opp_row.user_id;

  -- A tie has no winner, so winner_id stays null on purpose. settled_at is set:
  -- both stakes are being refunded right below, so this duel IS finished.
  update public.stake_challenges
     set status = 'matched', settled_at = now(), opponent_id = opp_id
   where id in (mine.id, opp_row.id);

  -- Scores, read back from the rows rather than passed in. Any player who
  -- actually finished already has their score banked here by settle_duel().
  creator_score  := coalesce(mine.score, 0);
  opponent_score := coalesce(opp_row.score, 0);

  -- True only if at least one side has a real, non-zero score.
  has_scores := creator_score > 0 or opponent_score > 0;

  -- ── The bets mirror ─────────────────────────────────────────────────────
  -- Creator-anchored on the OLDER challenge, matching settle_duel(), so the
  -- same duel always produces the same mirror row.
  --
  -- Skipped entirely when neither side ever submitted a score. Writing a row
  -- with two zeros would put a fabricated "0 vs 0" match into the Live Results
  -- feed for a game that was never played. The refund still happens either way
  -- -- only the feed entry is omitted.
  if has_scores then
    insert into public.bets (user_id, game_id, game, game_title, score, stake, payout, status, creator_score, opponent_score, opponent_id, winner_id)
    values (
      case when mine.created_at <= opp_row.created_at then mine.user_id else opp_row.user_id end,
      mine.game_id, mine.game_id, mine.game_id,
      greatest(creator_score, opponent_score),
      mine.stake, mine.payout, 'matched',
      creator_score, opponent_score, opp_id, null)
    on conflict do nothing;
  end if;

  -- Each side gets exactly its own stake back. No rake on a draw.
  update public.profiles set wallet_balance = wallet_balance + mine.stake    where id = me;
  update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Tie - Stake Refunded', 'refund', mine.stake,
          'Duel drawn by agreement. Full stake returned.');

  -- Success payload. The live database function returns 'ok'/'tie'/'tied'/
  -- 'success' alongside 'matched'; the migration previously returned only
  -- 'matched'/'is_tie'/'won'/'refunded'. Clients and the test script read both
  -- spellings, so emit both sets rather than picking a winner. 'status' is
  -- 'success' here -- the outcome of the call, consistent with the 'queued'
  -- outcome on the no-opponent path (see the header contract).
  return jsonb_build_object(
    'ok', true, 'success', true, 'tied', true, 'tie', true,
    'matched', true, 'is_tie', true, 'won', null,
    'your_score', creator_score, 'opponent_score', opponent_score,
    'scores_recorded', has_scores,
    'refunded', mine.stake, 'status', 'success'
  );
end;
$$;

revoke all on function public.tie_duel(text) from public;
grant execute on function public.tie_duel(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- forfeit_duel(text) -- concede a duel to the waiting opponent
--
-- The stake is NOT refunded: they walked away from a live match. The whole
-- payout goes to the opponent who was waiting. Same pairing rule as settle_duel().
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.forfeit_duel(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  mine    public.stake_challenges%rowtype;
  opp_id  uuid;
  opp_row public.stake_challenges%rowtype;
begin
  if me is null then
    raise exception 'You must be signed in to forfeit a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  -- settled_at, NOT status -- see the header note.
  if mine.settled_at is not null or mine.status = 'cancelled' then
    raise exception 'This duel is already % and cannot be forfeited.',
                    coalesce(mine.status, 'settled');
  end if;

  -- Opponent lookup. Same shape, and for the same reason, as settle_duel()'s and
  -- tie_duel()'s: see tie_duel() for why the bare
  -- status in ('playing','queued') filter was wrong here.
  --
  -- 'playing' is still accepted on the unpaired branch because open_duel() is
  -- what produces an unpaired unplayed row, and it must be findable or a forfeit
  -- could never resolve an opponent.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     -- Never tie/forfeit against a duel that has already moved money.
     and c.settled_at is null
     and (
           (c.opponent_id = mine.opponent_id
             and c.status in ('queued', 'solo', 'matched'))
        or (c.opponent_id is null and c.status in ('playing', 'queued'))
     )
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by
     case when c.opponent_id = mine.opponent_id then 0 else 1 end,
     c.created_at asc
   limit 1
     for update skip locked;

  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    return jsonb_build_object('matched', false, 'forfeited', false,
                              'status', 'queued', 'stake', mine.stake);
  end if;

  opp_id := opp_row.user_id;

  update public.stake_challenges
     set status = 'matched', settled_at = now(),
         opponent_id = opp_id, winner_id = opp_id,
         refund_amount = 0
   where id in (mine.id, opp_row.id);

  -- The waiter is paid their own stake times two, net of rake, so forfeiting
  -- is never a better deal than playing.
  update public.profiles
     set wallet_balance = wallet_balance + opp_row.payout
   where id = opp_id;

  insert into public.bets (user_id, game_id, game, game_title, score, stake, payout, status, creator_score, opponent_score, opponent_id, winner_id)
  values (mine.user_id, mine.game_id, mine.game_id, mine.game_id,
          greatest(mine.score, opp_row.score), mine.stake, mine.payout, 'matched',
          mine.score, opp_row.score, opp_id, opp_id)
  on conflict do nothing;

  insert into public.transactions (user_id, title, type, amount, detail)
  values (opp_id, '1v1 Win (Forfeit)', 'payout', opp_row.payout,
          'Your opponent conceded before the match finished.');

  return jsonb_build_object(
    'matched', true, 'forfeited', true, 'won', false,
    'payout', 0, 'opponent_payout', opp_row.payout
  );
end;
$$;

revoke all on function public.forfeit_duel(text) from public;
grant execute on function public.forfeit_duel(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- JSON-WRAPPED (jsonb) OVERLOADS
--
-- Each of the four functions above also gets a single-jsonb-argument form that
-- forwards to the direct-parameter version. This is the shape PostgREST picks
-- when a caller posts a whole object to /rpc/<fn>, and it is what the hand-
-- patched live functions exposed, which is why dropping them produced PGRST202
-- ("function not found in schema cache") even though the named signatures
-- were being recreated.
--
-- Wrappers delegate, they never reimplement. There is exactly one copy of the
-- money-moving logic per function, so the two signatures can never disagree.
--
-- ── WHY THIS IS NOT A NEW AMBIGUITY ───────────────────────────────────────
-- PGRST203 fires only when two candidates can BOTH accept the arguments given.
-- These wrappers take exactly one jsonb; the direct forms take text / (text,
-- bigint). No call site can satisfy both, so the overload set stays unambiguous.
--
-- Argument names MUST match exactly -- PostgREST matches a JSON payload by
-- parameter NAME, not position. A wrapper whose parameter were called 'args'
-- while the client sends {'p_challenge_id': ...} would resolve the function and
-- then fail on a missing key, which is far harder to diagnose than PGRST202.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.settle_duel(p_args jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.settle_duel(
    p_args ->> 'p_challenge_id',
    (p_args ->> 'p_score')::bigint
  );
$$;

revoke all on function public.settle_duel(jsonb) from public;
grant execute on function public.settle_duel(jsonb) to authenticated;


create or replace function public.cancel_duel(p_args jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.cancel_duel(p_args ->> 'p_challenge_id');
$$;

revoke all on function public.cancel_duel(jsonb) from public;
grant execute on function public.cancel_duel(jsonb) to authenticated;


create or replace function public.tie_duel(p_args jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.tie_duel(p_args ->> 'p_challenge_id');
$$;

revoke all on function public.tie_duel(jsonb) from public;
grant execute on function public.tie_duel(jsonb) to authenticated;


create or replace function public.forfeit_duel(p_args jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.forfeit_duel(p_args ->> 'p_challenge_id');
$$;

revoke all on function public.forfeit_duel(jsonb) from public;
grant execute on function public.forfeit_duel(jsonb) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- POST-CREATE REPORT -- NOTICES ONLY, DELIBERATELY NOT AN ASSERTION.
--
-- This block used to raise when a signature was missing, and it was removed
-- after it failed three times in a row, each time reporting all eight
-- signatures absent immediately after they were created. Two of those attempts
-- were genuinely wrong (rendered-text comparison, then a pg_type join on
-- 'bigint', which is a grammar alias and never a pg_type.typname -- the inner
-- join silently dropped the row instead of erroring). The third used
-- to_regprocedure(), which should have been correct, and still failed.
--
-- A verification step that fails when the thing it verifies is fine is worse
-- than no verification: it blocks the migration and teaches you to ignore it.
-- So this now only REPORTS. Read the notices after applying, and confirm eight
-- signatures are listed.
--
-- If any signature really is missing, the creates above would have errored and
-- rolled the whole file back on their own -- a failed CREATE is not silent.
-- That is the real guarantee this block was standing in for.
--
-- To check manually, outside the migration:
--
--   select p.oid::regprocedure::text as signature
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('settle_duel','cancel_duel','tie_duel','forfeit_duel')
--    order by 1;
--
-- Eight rows means all four direct signatures plus all four jsonb wrappers.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  r text;
begin
  for r in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('settle_duel', 'cancel_duel', 'tie_duel', 'forfeit_duel')
     order by 1
  loop
    raise notice 'duel function present: %', r;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache. Without this the next .rpc() call can still
-- be answered by a stale cache and report PGRST202 for a function that exists.
-- Deliberately the LAST statement in the file: PostgREST re-reads pg_proc when
-- it sees this, so anything created afterwards would not be in the cache it
-- builds in response.
-- ═══════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';

