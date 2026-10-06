-- ═══════════════════════════════════════════════════════════════════════════
-- OddZone — duel search window + solo fallback  (CORRECTED, v2)
--
-- ⚠ THIS REPLACES v1 OF THIS FILE. v1 WAS APPLIED TO THE LIVE DATABASE AND
-- INTRODUCED A REGRESSION THAT THIS VERSION FIXES. Do not re-apply v1.
--
-- Two defects in v1, both explained where they are fixed below:
--
--   DEFECT 1 — claim_duel_opponent() set both rows to status='matched', which
--              permanently closed the payout path. Both players' stakes stayed
--              debited and nobody was ever paid.
--   DEFECT 2 — every id comparison was `id = p_challenge_id`, but
--              stake_challenges.id is uuid and p_challenge_id is text.
--
--   DEFECT 3 — the profiles_read_public policy using (true) made EVERY column
--              of EVERY profile row world-readable, including wallet_balance,
--              email and the KYC fields.
--
-- The flow:
--
--   open_duel()            -> row created with status='playing'
--   claim_duel_opponent()  -> pre-matchmaking. Flips the row to 'queued' and,
--                             if another player is already waiting on the same
--                             game + stake, records the PAIRING by writing
--                             opponent_id on both rows. Both rows STAY
--                             'queued': pairing is not settlement.
--   settle_duel()          -> the game is over. Finds the paired opponent,
--                             compares the two banked scores, moves the money
--                             and writes the ledger. The ONLY function that
--                             pays out, exactly as before this migration.
--   begin_solo_play()      -> the 5-10s search timer expired. Flips the row
--                             to 'solo' so the player can play right now. The
--                             score is banked by settle_duel() as usual and
--                             matched against a later opponent.
--
-- Safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extra columns ──────────────────────────────────────────────────────────
-- is_solo: the player fell through the 5-10 second search window and is now
-- playing unopposed. Informational for the UI.
alter table public.stake_challenges add column if not exists is_solo boolean not null default false;

-- Opponent snapshot, captured at pairing time so the match/result cards can
-- render a name and avatar without a second read that RLS might refuse.
alter table public.stake_challenges add column if not exists opponent_name text;
alter table public.stake_challenges add column if not exists opponent_avatar text;

create index if not exists stake_challenges_opponent_idx
  on public.stake_challenges (opponent_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- DEFECT 3 FIX — profiles must never be readable across players
--
-- v1 ran:
--     create policy "profiles_read_public" on public.profiles
--       for select to anon, authenticated using (true);
--
-- A Postgres SELECT policy governs ROW visibility, not COLUMNS. `using (true)`
-- made every row of profiles readable by everyone, so a single REST call could
-- dump every wallet_balance, email and KYC record in the database. v1's own
-- comment claimed the balance stayed safe because "the client never selects
-- it" — that is not a security control, it is a hope. The browser is not the
-- threat model; the request is.
--
-- The opponent cards are given a dedicated table instead (below), so this
-- policy is dropped and the owner-only read is restored.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "profiles_read_public" on public.profiles;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (auth.uid() = id);

-- ── public_profiles: the ONLY cross-player profile surface ──────────────────
-- Exactly the two display fields the cards need. No balance, no email, no KYC.
create table if not exists public.public_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

-- RLS is enabled and the ONLY policy is a world-readable SELECT, so this table
-- can never be written by the browser even though everyone can read it.
alter table public.public_profiles enable row level security;

drop policy if exists "public_profiles_read" on public.public_profiles;
create policy "public_profiles_read" on public.public_profiles
  for select to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies exist on purpose: the snapshot is written
-- only by the trigger below, which runs as the table owner.

-- Backfill so challenges created before this migration can render names.
insert into public.public_profiles (user_id, username, avatar_url)
select p.id, p.username, p.avatar_url
  from public.profiles p
on conflict (user_id) do update
  set username   = excluded.username,
      avatar_url = excluded.avatar_url,
      updated_at = now();

-- Keep the snapshot in step with profiles.
--
-- A trigger rather than a profiles UPDATE policy: public_profiles has no
-- UPDATE policy by design, so a policy on profiles could not populate it. A
-- trigger runs as the table owner and is not subject to the caller's RLS.
--
-- This matters because the client writes username and avatar_url straight
-- from the browser (index.html calls .from('profiles').update({ username })
-- and .update({ avatar_url })). Without the trigger the cards would keep
-- showing a stale name and avatar after a player changed either one.
create or replace function public.sync_public_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.public_profiles (user_id, username, avatar_url)
  values (new.id, new.username, new.avatar_url)
  on conflict (user_id) do update
    set username   = excluded.username,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_public_profiles() from public;

drop trigger if exists profiles_sync_public on public.profiles;
create trigger profiles_sync_public
  after insert or update on public.profiles
  for each row execute function public.sync_public_profiles();

-- ═══════════════════════════════════════════════════════════════════════════
-- claim_duel_opponent: pre-matchmaking, done server-side
--
-- The browser used to run "find an open QUEUED challenge for my game + stake"
-- as a plain SELECT and then UPDATE its own row. Two players pressing the
-- button in the same instant both read the same opponent row and both wrote
-- opponent_id — a double match. FOR UPDATE SKIP LOCKED makes exactly one of
-- them win the claim and the other move on.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.claim_duel_opponent(p_challenge_id text)
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
  -- v1 compared `id = p_challenge_id`. p_challenge_id is text (the client
  -- echoes back whatever it was handed) but stake_challenges.id is a uuid
  -- column in this project — every live row is a gen_random_uuid(), and
  -- 20261001000000_reconcile_live_schema.sql section 3a documents that switch.
  -- Postgres has NO implicit text->uuid assignment cast, so v1 raised
  --     operator does not exist: uuid = text
  -- and could never find its own row.
  --
  -- Casting the COLUMN instead of the parameter keeps this correct for a uuid
  -- id and for a text one, so it stays right either way.
  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status = 'matched' then
    -- Already settled. Report the pairing so the client can still show it.
    return jsonb_build_object('matched', true, 'already', true,
                              'opponent_id', mine.opponent_id,
                              'opponent_name', mine.opponent_name,
                              'opponent_avatar', mine.opponent_avatar);
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

  -- Enter the queue. This UPDATE is what realtime pushes to every other
  -- player's dashboard, so their board sees the challenge immediately.
  update public.stake_challenges
     set status  = 'queued',
         is_solo = false
   where id = mine.id;

  -- Oldest waiting opponent on the same game + stake.
  --
  -- `c.opponent_id is null or c.opponent_id = me` is what stops a row that is
  -- ALREADY paired from being claimed by a third player. It is the pairing
  -- record, not the status, that reserves a row — which is why the status can
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

  -- ── DEFECT 1 FIX — record the PAIRING, do not declare a SETTLEMENT ────────
  -- v1 wrote status='matched' on both rows here. settle_duel() opens with:
  --
  --     if mine.status = 'matched' then
  --       raise exception 'This duel has already been settled.'
  --
  -- so the very next call from finishTimedMatch() raised, NOBODY was ever
  -- paid, and both players' stakes stayed debited forever. The searcher had
  -- found an opponent but the payout path had already been closed.
  --
  -- Pairing and settlement are two different things and must stay two
  -- different things:
  --
  --     claim_duel_opponent()  -> WHO is duelling whom. No money moves.
  --     settle_duel()          -> COMPARE scores, move money, write ledger.
  --
  -- So both rows stay 'queued' and the pairing is recorded in opponent_id,
  -- which settle_duel() then finds with its normal `status='queued'` lookup.
  -- Nothing about the payout path changes.
  --
  -- v1 also read `opp.user_id` for the opponent profile BEFORE the `opp`
  -- lookup had assigned it, so both snapshots were written as NULL and the
  -- cards fell back to "Opponent". Both reads are now after the lookup.
  update public.stake_challenges
     set opponent_id     = opp.user_id,
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
-- begin_solo_play: the search timer expired, drop the player into the game
--
-- The row stays on 'solo' rather than 'cancelled' because the stake is NOT
-- refunded — the player plays for real, and settle_duel() banks the score and
-- matches it against the next finisher at the same game and stake. Leaving it
-- 'queued' would instead re-enter the player into an instant rematch against
-- whoever happened to arrive during the search window.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.begin_solo_play(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You must be signed in to play.';
  end if;

  update public.stake_challenges
     set status  = 'solo',
         is_solo = true
   where id::text = p_challenge_id and user_id = me;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  return jsonb_build_object('solo', true, 'status', 'solo');
end;
$$;

revoke all on function public.begin_solo_play(text) from public;
grant execute on function public.begin_solo_play(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- settle_duel: accept a solo/paired row and return the opponent snapshot
--
-- This is a DELIBERATE, MINIMAL change to the reconciled version in
-- 20261001000000_reconcile_live_schema.sql, which was correct and had already
-- been fixed for three separate bugs (self-match refusal, creator-anchored
-- bets mirror, score-overwrite ordering). Those parts are reproduced here
-- unchanged. The ONLY differences are:
--
--   (a) the id::text comparison — already present in the reconciled version,
--       kept identical so the two files cannot drift and fight over the same
--       signature
--   (b) is_solo is cleared when the row re-enters the queue
--   (c) the pairing lookup accepts a row that is already paired with me
--   (d) opponent_id / opponent_name / opponent_avatar are returned so the
--       client can render the card without reading another user's profile
--
-- A 'solo' row passes both status guards below, so a solo run banks its score
-- through exactly the same locked path as any other row. That is the whole
-- mechanism by which the banked score finds a later opponent.
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
  winner   uuid;
  my_score bigint;
  is_tie   boolean := false;
  opp_name text;
  opp_avat text;
begin
  if me is null then
    raise exception 'You must be signed in to settle a duel.';
  end if;

  if p_score < 0 or p_score > 100000 then
    raise exception 'Invalid score.';
  end if;

  -- id::text — see section 3a of 20261001000000_reconcile_live_schema.sql.
  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status = 'matched' then
    raise exception 'This duel has already been settled.';
  end if;

  if mine.status = 'cancelled' then
    raise exception 'This duel was cancelled.';
  end if;

  -- Resolved into a local FIRST and not written yet, so `mine` stays the
  -- locked unmodified row and the single write at the end is the only write.
  my_score := greatest(coalesce(mine.score, 0), coalesce(p_score, 0));

-- My paired opponent if claim_duel_opponent() already paired us, otherwise the
  -- oldest unpaired player on the same game + stake.
  --
  -- ONE SELECT ordered by priority -- not a UNION ALL.
  --
  -- Two things made the previous UNION ALL version impossible to rescue by
  -- adding parentheses:
  --
  --   1. PostgreSQL rejects row locking on a set operation outright:
  --        ERROR: FOR UPDATE is not allowed with UNION/INTERSECT/EXCEPT
  --      So `for update skip locked` cannot be attached to a UNION at any
  --      level of parenthesisation. That lock is the entire reason this
  --      lookup is safe -- two players finishing at the same instant must
  --      never both claim the same opponent row -- so it has to be a single
  --      scan over one table.
  --
  --   2. "Paired rows first" is an ordering, not a branch. A priority integer
  --      in ORDER BY says exactly that in one pass, which is both valid and
  --      cheaper than materialising two branches and merging them.
  --
  -- priority 0 = my already-paired opponent (settle_duel is settling us)
  -- priority 1 = any other unpaired player waiting on the same game + stake
  --
  -- `c.opponent_id is null` on the second branch is what stops a row already
  -- paired with a DIFFERENT player from being stolen by a third player.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     -- 'solo' appears on the paired branch only: a solo player who has not
     -- finished yet must stay claimable, or two players who both fell through
     -- the search window could never be paired with each other.
     and (
           (c.opponent_id = mine.opponent_id and c.status in ('queued', 'solo'))
        or (c.opponent_id is null and c.status = 'queued')
     )
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by
     case when c.opponent_id = mine.opponent_id then 0 else 1 end asc,
     c.created_at asc
   limit 1
     for update skip locked;

  -- Refuse to self-match. The live database produced rows where opponent_id
  -- equalled user_id, which silently reads as a tie and pays both sides.
  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    -- No opponent yet: queue up with the score and wait.
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

  -- Single write for both rows. The per-row score is assigned with CASE so each
  -- side keeps its own number, and both rows are marked matched in the same
  -- statement so neither can be re-settled between two separate updates.
  update public.stake_challenges
     set status          = 'matched',
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

  -- ── 7a. The bets mirror ──────────────────────────────────────────────────
  -- Creator-anchored so the same duel produces the same mirror row whichever
  -- player settles first. See the reconciled migration for the two bugs this
  -- exists to fix.
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
    -- Each side gets its own stake back, untouched. No rake on a tie.
    update public.profiles set wallet_balance = wallet_balance + mine.stake    where id = me;
    update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Tie – Stake Refunded', 'refund', mine.stake,
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
-- Realtime: profiles changes refresh the opponent avatar on open cards.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;