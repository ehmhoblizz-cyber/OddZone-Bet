-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000005_fix_claim_duel_opponent_self_opponent.sql
--
-- FIXES A PAIRING BUG IN claim_duel_opponent(): both rows were pointed at the
-- OPPONENT'S USER ID, so the waiting player ended up duelling themselves.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- 20261003000001_duel_search_and_solo.sql:268-278 wrote:
--
--     update public.stake_challenges
--        set opponent_id     = opp.user_id,      -- <-- opp's OWN user id
--            opponent_name   = my_name,
--            opponent_avatar = my_avat
--      where id = opp.id;
--
--     update public.stake_challenges
--        set opponent_id     = opp.user_id,      -- <-- correct here
--            opponent_name   = opp_name,
--            opponent_avatar = opp_avat
--      where id = mine.id;
--
-- The first UPDATE fixes the OPPONENT'S row, so it must record `me` -- the only
-- person who can be the opponent of opp. Writing opp.user_id there stores the
-- opponent's own id in their own opponent_id column.
--
-- `my_name` / `my_avat` were read correctly (that read was the DEFECT 1 fix
-- sitting in the same statement), so the row ended up self-consistent and
-- plausible looking: opponent_id = self, opponent_name = the player's OWN
-- username. Nothing errors. The pairing just silently means nothing.
--
-- ── WHY IT MATTERS ──────────────────────────────────────────────────────────
-- opponent_id is the pairing record for every downstream lookup. settle_duel(),
-- tie_duel() and forfeit_duel() all search with:
--
--     (c.opponent_id = mine.opponent_id and c.status in ('queued','solo','matched'))
--
-- For the waiting player that is now (self = self), which matches nothing but a
-- row that is equally self-referential -- so their opponent branch does not fire
-- and settlement falls through to the "no opponent yet" path. Their score is
-- banked, they are told matched=false, and the stake stays debited with nobody
-- to settle against.
--
-- It also corrupts the two guards that depend on opponent_id being a real
-- pairing. claim_duel_opponent()'s own candidate filter uses
-- (c.opponent_id is null or c.opponent_id = me): a self-referential row is
-- claimed only by itself, so it is invisible as an opponent to everyone else.
-- And the cards render opponent_name from that column, so the waiting player
-- was shown their own face as their rival.
--
-- ── WHY NOT SIMPLY RESTORE THE OLD PAIRING MODEL ────────────────────────────
-- Both rows STAY 'queued'. Pairing is not settlement: settle_duel() refuses a
-- row already marked 'matched', so declaring the pairing as 'matched' here
-- closed the payout path permanently (20261003000001 DEFECT 1). This migration
-- changes only WHO the opponent_id points at, not the status machine, so the
-- payout path that DEFECT 1 fixed stays fixed.
--
-- ── WHY RECREATE RATHER THAN OR REPLACE ──────────────────────────────────────
-- The signature and return type are unchanged here, so create or replace would
-- be enough in principle -- but this function has been hand-patched on the live
-- database more than once (see 20261004000001's header), and the local body is
-- the one known-good version. Drop first removes any chance of a stale live
-- body surviving because it happened to share a return type.
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
       and p.proname = 'claim_duel_opponent'
  loop
    execute format('drop function if exists %s', r.sig);
    raise notice 'dropped %', r.sig;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- claim_duel_opponent(text): pre-matchmaking, done server-side
--
-- The browser used to run "find an open QUEUED challenge for my game + stake" as
-- a plain SELECT and then UPDATE its own row. Two players pressing the button in
-- the same instant both read the same opponent row and both wrote opponent_id --
-- a double match. FOR UPDATE SKIP LOCKED makes exactly one of them win the claim
-- and the other move on.
-- ═══════════════════════════════════════════════════════════════════════════
create function public.claim_duel_opponent(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  mine     public.stake_challenges%rowtype;
  opp      public.stake_challenges%rowtype;
  opp_name text;
  opp_avat text;
  my_name  text;
  my_avat  text;
begin
  if me is null then
    raise exception 'You must be signed in to search for an opponent.';
  end if;

  -- ── DEFECT 2 FIX ──────────────────────────────────────────────────────────
  -- v1 compared `id = p_challenge_id`. p_challenge_id is text (the client echoes
  -- back whatever it was handed) but stake_challenges.id is a uuid column in this
  -- project -- every live row is a gen_random_uuid(). Postgres has NO implicit
  -- text->uuid assignment cast, so v1 raised
  --     operator does not exist: uuid = text
  -- and could never find its own row.
  --
  -- Casting the COLUMN instead of the parameter keeps this correct for a uuid id
  -- and for a text one, so it stays right either way.
  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  -- Pairing is recorded in opponent_id and the row stays 'queued', so a row that
  -- is already paired must NOT be reported as settled. Testing settled_at is
  -- what separates "someone claimed it" from "money already moved"; testing
  -- status would refuse every legitimately paired duel (DEFECT 1).
  --
  -- Deliberately not `mine.status = 'matched'`: that spelling is what made
  -- pairing look like settlement and closed the payout path. A paired row falls
  -- through to the pairing report below and the client can still render it.
  if mine.settled_at is not null then
    raise exception 'This duel has already been settled.';
  end if;

  if mine.status = 'cancelled' then
    raise exception 'This duel was cancelled.';
  end if;

  -- A solo player who has already played keeps waiting for a real opponent
  -- rather than re-entering the queue a second time. matched=false means the
  -- client leaves the solo game running.
  if mine.status = 'solo' then
    return jsonb_build_object('matched', false, 'status', 'solo', 'already', true);
  end if;

  -- Enter the queue. This UPDATE is what realtime pushes to every other player's
  -- dashboard, so their board sees the challenge immediately.
  update public.stake_challenges
     set status  = 'queued',
         is_solo = false
   where id = mine.id;

  -- Oldest waiting opponent on the same game + stake.
  --
  -- `c.opponent_id is null or c.opponent_id = me` is what stops a row that is
  -- ALREADY paired from being claimed by a third player. It is the pairing
  -- record, not the status, that reserves a row -- which is why the status can
  -- stay 'queued' (see DEFECT 1 below).
  select * into opp
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  = 'queued'
     and c.user_id is not null
     and c.user_id <> me
     and (c.opponent_id is null or c.opponent_id = me)
   order by c.created_at asc
   limit 1
     for update skip locked;

  if opp.id is null then
    return jsonb_build_object('matched', false, 'status', 'queued', 'already', false);
  end if;

  select coalesce(pp.username, 'Player'), pp.avatar_url
    into my_name, my_avat
    from public.public_profiles pp
   where pp.user_id = me;

  select coalesce(pp.username, 'Player'), pp.avatar_url
    into opp_name, opp_avat
    from public.public_profiles pp
   where pp.user_id = opp.user_id;

  -- ── DEFECT 1 FIX -- record the PAIRING, do not declare a SETTLEMENT ───────
  -- v1 wrote status='matched' on both rows here. settle_duel() opens with:
  --
  --     if mine.status = 'matched' then
  --       raise exception 'This duel has already been settled.'
  --
  -- so the very next call from finishTimedMatch() raised, NOBODY was ever paid,
  -- and both players' stakes stayed debited forever. The searcher had found an
  -- opponent but the payout path had already been closed.
  --
  -- Pairing and settlement are two different things and must stay two different
  -- things:
  --
  --     claim_duel_opponent()  -> WHO is duelling whom. No money moves.
  --     settle_duel()          -> COMPARE scores, move money, write ledger.
  --
  -- So both rows stay 'queued' and the pairing is recorded in opponent_id, which
  -- settle_duel() then finds with its normal `status='queued'` lookup. Nothing
  -- about the payout path changes.
  --
  -- v1 also read `opp.user_id` for the opponent profile BEFORE the `opp` lookup
  -- had assigned it, so both snapshots were written as NULL and the cards fell
  -- back to "Opponent". Both reads are now after the lookup.
  --
  -- ═══════════════════════════════════════════════════════════════════════
  -- DEFECT 3 FIX -- THE OPPONENT'S ROW MUST POINT BACK AT `me`, NOT AT ITSELF.
  --
  -- This UPDATE fixes OPP's row, so the opponent of opp is the caller. The
  -- original wrote opp.user_id here, storing the opponent's own id in their own
  -- opponent_id column: a self-referential pairing that nothing rejects.
  --
  -- It was not cosmetic. opponent_id is the pairing record every downstream
  -- lookup matches on:
  --
  --     (c.opponent_id = mine.opponent_id and c.status in ('queued','solo','matched'))
  --
  -- For the waiting player that becomes (self = self), which matches no real
  -- opponent, so their settle/tie/forfeit fell through to the "no opponent yet"
  -- branch and told them matched=false with their stake still debited. Their
  -- row was also invisible to every other claimant, because the candidate filter
  -- (c.opponent_id is null or c.opponent_id = me) is satisfied by a
  -- self-referential row only for its own owner.
  -- ═══════════════════════════════════════════════════════════════════════
  update public.stake_challenges
     set opponent_id     = me,
         opponent_name   = my_name,
         opponent_avatar = my_avat
   where id = opp.id;

  update public.stake_challenges
     set opponent_id     = opp.user_id,
         opponent_name   = opp_name,
         opponent_avatar = opp_avat
   where id = mine.id;

  return jsonb_build_object(
    'matched', true, 'status', 'paired', 'already', false,
    'challenge_id', opp.id,
    'opponent_id', opp.user_id,
    'opponent_name', opp_name,
    'opponent_avatar', opp_avat,
    'opponent_score', opp.score,
    'stake', mine.stake,
    'game_id', mine.game_id
  );
end;
$$;

revoke all on function public.claim_duel_opponent(text) from public;
grant execute on function public.claim_duel_opponent(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Self-referential pairings already written by the broken version cannot be
-- repaired reliably -- there is no record of who was meant to be the other side,
-- and guessing from created_at proximity would move money between accounts on a
-- financial table. They are reported instead so support can refund them.
--
-- Read-only. Rows left in place deliberately: cancelling them with no refund
-- takes the player's stake away, which is worse than an obviously-broken row.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.stake_challenges
   where opponent_id is not null
     and opponent_id = user_id
     and settled_at is null
     and status <> 'cancelled';

  if v_count > 0 then
    raise warning
      'DEFECT 3: % un-settled challenge(s) still carry a SELF-REFERENTIAL opponent_id from the broken claim_duel_opponent(). They are inert (no caller can settle them) but the stake on each is stranded -- refund via cancel_duel() by the owner, or handle as support.',
      v_count;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache, LAST.
-- ═══════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';