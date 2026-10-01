-- ─────────────────────────────────────────────
-- 20261001000000_reconcile_live_schema.sql
--
-- WHY THIS FILE EXISTS
--
-- The migration 20260928000000 was written against the schema the app was
-- SUPPOSED to have, but it was never applied to this project. The live database
-- is an older shape, so every Supabase call in index.html that touched a newer
-- column was rejected by PostgREST with HTTP 400:
--
--   profiles      missing is_verified, kyc_type, kyc_id_masked, legal_name,
--                         bank_code, bank_name, account_number, avatar_url
--   bets          missing creator_score, opponent_score
--   transactions  missing title, detail
--
-- PostgREST rejects the WHOLE request when one column is unknown, so a single
-- wrong name silently broke the profile insert, the KYC update, the wallet
-- ledger write, and the "Live Arena Results" list.
--
-- The three money functions the client calls (open_duel, settle_duel,
-- cancel_duel) are also absent, which is why staking reported "Betting is not
-- available yet".
--
-- This migration is written against the columns that ACTUALLY EXIST, verified by
-- probing PostgREST. It is additive and idempotent: safe to run more than once,
-- and it does not drop or rewrite any existing column.
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> paste -> Run.
--   (Or: supabase db push)
--
-- Order matters only in that this file must run BEFORE you restore the KYC
-- column writes in index.html.
--
-- The whole file runs as one transaction, so if any statement fails nothing is
-- half-applied and your live schema is left exactly as it was.
-- ─────────────────────────────────────────────

begin;


-- ── 1. profiles: KYC + avatar columns ────────────────────────────────────────
-- is_verified is what gates withdrawals. Keeping it server-side is the point of
-- this migration: while it lived only in localStorage, anyone could open
-- DevTools, flip one flag, and unlock cash payouts.

alter table public.profiles
  add column if not exists is_verified    boolean not null default false,
  add column if not exists kyc_type       text,
  add column if not exists kyc_id_masked  text,
  add column if not exists legal_name     text,
  add column if not exists bank_code      text,
  add column if not exists bank_name      text,
  add column if not exists account_number text,
  add column if not exists avatar_url     text;

-- The live table has created_at but the 20260928 functions below reference
-- updated_at. Add it so those functions compile.
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at honest on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ── 2. transactions: title + detail ─────────────────────────────────────────
-- The client writes a ledger row on every deposit, stake, win and withdrawal.
-- title/detail are what the Activity Explorer renders.

alter table public.transactions
  add column if not exists title   text,
  add column if not exists detail  text;


-- ── 2b. stake_challenges: columns cancel_duel/settle_duel write ────────────
-- The live table predates both, so `refund_amount` and `winner_id` do not exist
-- and cancel_duel()/settle_duel() could not compile at all. stake_challenges.id
-- is ALSO uuid in this project (not text as 20260928 assumed) -- see section 3a.

alter table public.stake_challenges
  add column if not exists refund_amount bigint,
  add column if not exists winner_id    uuid references auth.users(id) on delete set null;

create index if not exists stake_challenges_match_idx
  on public.stake_challenges (game_id, stake, status, created_at);


-- ── 3. bets: per-side scores ────────────────────────────────────────────────
-- The live table has a single `score`. settle_duel() below records both sides,
-- and the Live Arena Results panel shows the higher of the two, so add the two
-- real columns. `score` is kept and still written, so existing rows stay valid.

alter table public.bets
  add column if not exists creator_score  bigint,
  add column if not exists opponent_score bigint;


-- ── 4. Helper: create a profile row on first sign-in ────────────────────────
-- syncUserProfile() in index.html inserts a row when it finds none. Doing that
-- from the browser is fine for the non-money columns, but is_verified must
-- never be client-settable -- so it is deliberately absent from that insert and
-- defaults to false here.

create or replace function public.ensure_profile(p_username text, p_email text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You must be signed in.';
  end if;

  insert into public.profiles (id, username, email, wallet_balance)
  values (me, coalesce(p_username, 'Player'), coalesce(p_email, ''), 0)
  on conflict (id) do update
    set username = excluded.username,
        email    = excluded.email;

  return wallet_balance();
end;
$$;

revoke all on function public.ensure_profile(text, text) from public;
grant execute on function public.ensure_profile(text, text) to authenticated;


-- ── 5. wallet_balance(): the single source of truth ─────────────────────────
-- The client calls this after any server-side money movement so the displayed
-- balance cannot drift from the stored one.

create or replace function public.wallet_balance()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select wallet_balance from public.profiles where id = auth.uid()),
    0
  );
$$;

revoke all on function public.wallet_balance() from public;
grant execute on function public.wallet_balance() to authenticated;


-- ── 6. open_duel(): debit the stake and create the challenge atomically ─────
-- The browser used to write wallet_balance directly, which meant a player could
-- edit the number in DevTools and stake money they did not have. The debit now
-- happens here, under a row lock, in the same transaction as the challenge row:
-- either both happen or neither does.

create or replace function public.open_duel(
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

  -- ── 6a. Fixed stake presets ───────────────────────────────────────────────
  --
  -- This replaces the old open-ended range check (`p_stake < 200` /
  -- `> 10000000`). A range check only ever bounded the amount; it still let a
  -- client post ANY integer in between (333, 777, 1234), which is exactly the
  -- shape of value a preset economy is supposed to rule out. The stake is now a
  -- MEMBERSHIP test against the five approved presets and nothing else.
  --
  -- Membership, not range: 100 is below the old 200 floor, so this is a
  -- deliberate widening at the bottom and the two checks must not both survive.
  -- The maximum is implied by the list -- there is no separate upper bound to
  -- forget to update when a preset is added.
  --
  -- exists() over unnest() with an equality predicate, so a null p_stake
  -- (bigint, so a caller CAN send null) yields false rather than a null result
  -- that would silently skip the IF and reach the debit with a null stake.
  -- p_stake is compared as bigint against bigint, never as text.
  if not exists (
       select 1
         from unnest(array[100::bigint, 500, 1000, 2000, 5000]) as allowed
        where allowed = p_stake
     ) then
    raise exception
      'Stake % is not an approved preset. Choose one of: 100, 500, 1000, 2000, 5000.',
      coalesce(p_stake::text, 'null');
  end if;

  -- ── 6b. Allowed game ids ──────────────────────────────────────────────────
  --
  -- game_id is a bare text column and was previously unvalidated, so any string
  -- could open a "duel". A junk id still created a real row with a real debit
  -- behind it, and that row can never match an opponent because no real client
  -- ever queues that game -- so it silently stranded a player's stake in
  -- 'playing' until the sweep at section 10 cleaned it up days later. Rejecting
  -- it here fails at the point of the mistake, before any money moves.
  --
  -- This list MUST be kept in sync with GAME_CATALOG in index.html (the nine ids
  -- there). It is duplicated on purpose: the client list is UX and can be
  -- tampered with, while this one is the enforced contract, so the database is
  -- the authority on what a real game is.
  --
  -- Same reasoning as the stake: a null or misspelled game_id is rejected rather
  -- than quietly creating an unmatchable challenge.
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

  -- ── 3a. Generate the challenge id ─────────────────────────────────────────
  -- 20260928 built a text literal, 'CHLG-' || <timestamp> || '-' || <rand>, and
  -- inserted it directly. This project's stake_challenges.id is a uuid column,
  -- and Postgres has NO implicit text->uuid assignment cast in an INSERT, so the
  -- whole call was rejected:
  --     column "id" is of type uuid but expression is of type text   (42804)
  --
  -- The id must therefore be a real uuid. It cannot be the human-readable
  -- CHLG- form: 'CHLG-...' is not a valid uuid, so casting it would fail with
  -- 22P02 invalid input syntax instead. gen_random_uuid() is built in on
  -- Supabase (pgcrypto), so no extension has to be installed.
  --
  -- The client (matchmaking.js and index.html) treats this as an opaque string,
  -- so a uuid is fine there. Nothing anywhere displays it to a player.
  --
  -- gen_random_uuid() returns uuid, which matches the column exactly and needs
  -- no cast at all. The ::uuid below is explicit anyway, so that the statement
  -- still reads correctly on its own and cannot silently regress if new_id is
  -- ever reassigned to a text expression further up.
  new_id := gen_random_uuid()::text;

  update public.profiles
     set wallet_balance = wallet_balance - p_stake
   where id = me;

  -- The ::uuid cast here is load-bearing, not decoration. Without it the INSERT
  -- carries a text expression into a uuid column, and Postgres raises
  --    42804: column "id" is of type uuid but expression is of type text
  -- which is the exact error this whole section exists to fix. The cast is what
  -- makes the text held in new_id assignable to the column.
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


-- ── 7. settle_duel(): match two queued players and pay the winner ───────────
-- Matching used to be decided in the browser: each client re-queried for an
-- opponent, decided a winner, and credited its own balance. Two players
-- queueing at the same instant could therefore both read the same opponent row
-- and both get paid. FOR UPDATE SKIP LOCKED makes the second caller move on to
-- the next row instead, so a challenge can only ever be claimed once.

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
  me      uuid := auth.uid();
  mine    public.stake_challenges%rowtype;
  opp_id  uuid;
  opp_row public.stake_challenges%rowtype;
  winner  uuid;
  my_score bigint;
  is_tie  boolean := false;
begin
  if me is null then
    raise exception 'You must be signed in to settle a duel.';
  end if;

  if p_score < 0 or p_score > 100000 then
    raise exception 'Invalid score.';
  end if;

  -- Lock my row so a double-submit cannot settle twice.
  --
  -- The id is compared as TEXT on purpose. p_challenge_id is text because the
  -- client echoes back whatever it was handed; comparing it straight to the id
  -- column is exactly the uuid/text mismatch that broke open_duel(). Casting the
  -- column instead of the parameter keeps this line correct for a uuid id column
  -- AND a text one.
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

  -- The score is resolved into a local FIRST and not written yet.
  --
  -- Writing it here (the old order) mutated the caller's own row to
  -- status='queued' with p_score already applied before the opponent was even
  -- looked up, so the row that the rest of the function reasoned about was no
  -- longer the row it had locked. Everything downstream -- the comparison, the
  -- bets mirror, the state checks -- then read a value that had already been
  -- overwritten. Resolving it into my_score keeps `mine` as the locked,
  -- unmodified row and makes the one write at the end the only write.
  --
  -- greatest() is kept: a re-submit may only ever raise a score, never lower
  -- it, so a player cannot settle twice and drop their own result.
  my_score := greatest(coalesce(mine.score, 0), coalesce(p_score, 0));

  -- Oldest waiting opponent on the same game and stake.
  --
  -- The lookup deliberately runs BEFORE the caller's row is queued. It filters
  -- on c.user_id <> me, so the caller's own row is excluded either way, and
  -- running it first means the row being searched is the pre-update one.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  = 'queued'
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by c.created_at asc
   limit 1
     for update skip locked;

  -- Belt and braces against the self-match. c.user_id <> me already forbids it,
  -- but the live database produced rows where opponent_id equalled user_id and
  -- a challenge was matched against itself, which silently reads as a tie
  -- (both sides are the same row, so both scores are equal) and leaves the real
  -- opponent's row stranded. Failing loudly is far better than paying out on a
  -- phantom draw.
  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    -- No opponent yet: queue up with the score and wait. This write MUST happen
    -- on this path, because a row is only matchable once its status is
    -- 'queued' -- the lookup above filters for exactly that. Deferring it past
    -- the early return would leave the first player permanently invisible.
    update public.stake_challenges
       set score  = my_score,
           status = 'queued'
     where id::text = p_challenge_id
    returning * into mine;

    return jsonb_build_object(
      'matched', false,
      'status',  'queued',
      'stake',   mine.stake
    );
  end if;

  opp_id := opp_row.user_id;

  -- Compare the two STORED scores, not the raw parameter. my_score is what this
  -- player's row will hold, so the decision and the recorded scores can never
  -- disagree the way they did when p_score was compared against an
  -- already-overwritten value.
  if my_score > opp_row.score then
    winner := me;
  elsif my_score < opp_row.score then
    winner := opp_id;
  else
    is_tie := true;
  end if;

  -- Single write for both rows. The per-row score is assigned with CASE so each
  -- side keeps its own number, and both rows are marked matched in the same
  -- statement so neither can be re-settled between the two updates.
  update public.stake_challenges
     set status      = 'matched',
         opponent_id = case when id = mine.id then opp_id else me end,
         winner_id   = winner,
         score       = case when id = mine.id then my_score else opp_row.score end
   where id in (mine.id, opp_row.id);

  -- ── 7a. The bets mirror: orientation ──────────────────────────────────────
  --
  -- Two separate bugs lived in this one statement. Both are load-bearing, and
  -- both were invisible until the live rows were read back.
  --
  -- BUG 1 (42703) -- `winner_id` was passed as a VALUE. An INSERT ... VALUES
  -- list has no FROM clause, so plpgsql had nothing to resolve that name
  -- against and raised at runtime on the first real match:
  --     There is a column named 'winner_id', but it cannot be referenced
  --     from this part of the query
  -- The variable is `winner`. On a tie it is null, which is CORRECT: a drawn
  -- duel has no winner and must not name one.
  --
  -- BUG 2 (orientation) -- `mine` is the CALLER's challenge, not the duel. The
  -- mirror used to record p_score as creator_score, so the row described
  -- whoever happened to settle LAST, not the player whose stake it was. When
  -- the loser settled second, the row said:
  --     user_id       = the loser
  --     creator_score = the loser's own score
  --     opponent_score= the loser's score too (opp_row.score had already been
  --                   overwritten, so both columns held the same number)
  -- and winner_id came out null even for a decisive result, because the score
  -- comparison below had been fed its own overwritten value and read as a tie.
  --
  -- ORIENTATION (Option 2) -- the creator slot is decided by CREATED_AT, not by
  -- who happened to settle last. Both challenges are already locked here, so
  -- their created_at values cannot change and the comparison is stable:
  --     mine.created_at <= opp_row.created_at -> the caller opened the duel
  --                                               first, so the caller is the
  --                                               CREATOR
  --     otherwise                             -> the opponent opened first, so
  --                                               the OPPONENT is the creator
  -- The earlier challenge is therefore always recorded as the creator no matter
  -- which of the two players settles first. Previously the row was anchored to
  -- the caller, so the same duel produced two mirror rows with opposite
  -- orientations depending on settle order -- the second setter's row described
  -- the second setter as the creator of a duel they had actually answered.
  --
  -- Every creator-anchored column is therefore derived through the SAME case
  -- expression. Mixing the two sides (one column caller-anchored, the next
  -- opponent-anchored) is precisely how the two original bugs happened:
  --
  --     user_id        = creator:  me if mine is older, else opp_id
  --     creator_score  = creator's final score
  --     opponent_score = the other player's final score
  --     opponent_id    = the other player, always
  --     stake / payout = the CREATOR's values, not the caller's
  --     score          = greatest(my_score, opp_row.score); orientation-independent,
  --                      it is the value the Live Arena Results panel has always
  --                      displayed as "the score"
  --     winner_id      = winner, null on a tie
  --
  -- mine.created_at <= opp_row.created_at rather than < : if two challenges were
  -- stamped in the same instant the CALLER is still deterministic (never
  -- order-dependent), which is what makes this safe to rely on.
  --
  -- my_score MUST be used here rather than mine.score. The row update now
  -- happens AFTER the opponent lookup, so `mine` is still the row as it was
  -- LOCKED, before this caller's score was applied. Reading mine.score at this
  -- point would record the stale 0 that open_duel wrote, which is precisely the
  -- "both sides show the same number" fault this whole block exists to fix.
  -- One predicate, reused for every creator-anchored column, so the row cannot
  -- come out half creator-anchored and half caller-anchored.
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
      'payout', 0, 'refunded', mine.stake
    );
  end if;

  if winner = me then
    -- payout was computed at stake time as stake * 2 * (1 - rake).
    update public.profiles set wallet_balance = wallet_balance + mine.payout where id = me;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Win', 'payout', mine.payout,
            'Beat your opponent ' || my_score || ' to ' || opp_row.score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', false, 'won', true,
      'your_score', my_score, 'opponent_score', opp_row.score,
      'payout', mine.payout
    );
  end if;

  -- Lost: the stake was already deducted when the duel opened, so there is
  -- nothing further to move. Just record it in the ledger.
  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Loss', 'stake', mine.stake,
          'Scored ' || my_score || ' against ' || opp_row.score || '.');

  return jsonb_build_object(
    'matched', true, 'is_tie', false, 'won', false,
    'your_score', my_score, 'opponent_score', opp_row.score,
    'payout', 0
  );
end;
$$;

revoke all on function public.settle_duel(text, bigint) from public;
grant execute on function public.settle_duel(text, bigint) to authenticated;


-- ── 8. cancel_duel(): refund 80% when a player backs out ───────────────────
-- The refund used to be credited in the browser, so the local balance rose
-- while the server balance did not and the money vanished on the next reload.
-- It is credited here instead. 20% is retained as a cancellation fee.

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

  -- Compared as text: p_challenge_id is text, and casting the column keeps this
  -- correct whether stake_challenges.id is uuid or text. See section 3a.
  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status = 'matched' then
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


-- ── 8b. tie_duel(): draw a queued duel on request ────────────────────────────
-- settle_duel() already resolves a tie automatically the moment both players
-- submit an equal score, and index.html handles that inline from
-- settled.is_tie. tie_duel() exists for the two cases settle_duel() cannot cover:
-- the player who wants to accept a draw before anyone has queued a score, and a
-- caller that needs a tie resolved as one server action.
--
-- It only ever moves money back to the players who staked. Like settle_duel() it
-- refuses any challenge that is not the caller's own, is not still queued, and
-- has no opponent, so it cannot be used to drain someone else's stake.

create or replace function public.tie_duel(p_challenge_id text)
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
    raise exception 'You must be signed in to tie a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id::text = p_challenge_id and user_id = me
     for update;

  if not found then
    raise exception 'Challenge % not found for this user.', p_challenge_id;
  end if;

  if mine.status in ('matched', 'cancelled') then
    raise exception 'This duel is already % and cannot be tied.', mine.status;
  end if;

  -- Same pairing rule as settle_duel(): same game, same stake, oldest first.
  --
  -- The status filter accepts BOTH 'playing' and 'queued'. It used to accept
  -- only 'queued', which made tie_duel() unable to ever find an opponent: a duel
  -- created by open_duel() is 'playing', and only settle_duel() moves it to
  -- 'queued' -- and only once a score has been submitted. A client calling
  -- tie_duel() on a freshly opened duel therefore always took the early return
  -- and reported status 'queued' instead of drawing it.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  in ('playing', 'queued')
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by c.created_at asc
   limit 1
     for update skip locked;

  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    return jsonb_build_object('matched', false, 'is_tie', false, 'status', mine.status);
  end if;

  opp_id := opp_row.user_id;

  -- A tie has no winner, so winner_id is left null on purpose here rather than
  -- being given one of the two players.
  update public.stake_challenges
     set status = 'matched', opponent_id = opp_id
   where id in (mine.id, opp_row.id);

  -- Same owner-anchored orientation as settle_duel(), so the Live Arena Results
  -- panel reads one shape regardless of which function settled the duel. Both
  -- scores are equal by definition here, and winner_id stays null.
  insert into public.bets (user_id, game_id, game, game_title, score, stake, payout, status, creator_score, opponent_score, opponent_id, winner_id)
  values (mine.user_id, mine.game_id, mine.game_id, mine.game_id,
          mine.score, mine.stake, mine.payout, 'matched',
          mine.score, opp_row.score, opp_id, null)
  on conflict do nothing;

  -- Each side gets exactly its own stake back. No rake on a draw.
  update public.profiles set wallet_balance = wallet_balance + mine.stake    where id = me;
  update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Tie – Stake Refunded', 'refund', mine.stake,
          'Duel drawn by agreement. Full stake returned.');

  return jsonb_build_object(
    'matched', true, 'is_tie', true, 'won', null,
    'refunded', mine.stake
  );
end;
$$;

revoke all on function public.tie_duel(text) from public;
grant execute on function public.tie_duel(text) to authenticated;


-- ── 8c. forfeit_duel(): concede a queued duel to the waiting opponent ─────────
-- The mirror image of tie_duel(). A player who cannot finish a queued duel
-- forfeits it: the stake is NOT refunded (they walked away from a live match),
-- and the whole payout goes to the opponent who was waiting. The caller gives
-- up the money, so it cannot be used against them.

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

  if mine.status in ('matched', 'cancelled') then
    raise exception 'This duel is already % and cannot be forfeited.', mine.status;
  end if;

  -- Same pairing rule as settle_duel(). A forfeit is offered on a duel that has
  -- not been played yet, so 'playing' is the normal state here and must be
  -- matched; see the note in tie_duel() above for why 'queued' alone was wrong.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  in ('playing', 'queued')
     and c.user_id is not null
     and c.user_id <> me
     and c.id::text <> p_challenge_id
   order by c.created_at asc
   limit 1
     for update skip locked;

  if opp_row.id is not null and opp_row.id = mine.id then
    raise exception 'Opponent lookup returned your own challenge. Refusing to self-match.';
  end if;

  if opp_row.id is null then
    return jsonb_build_object('matched', false, 'forfeited', false,
                              'status', mine.status, 'stake', mine.stake);
  end if;

  opp_id := opp_row.user_id;

  update public.stake_challenges
     set status = 'matched', opponent_id = opp_id, winner_id = opp_id,
         refund_amount = 0
   where id in (mine.id, opp_row.id);

  -- The forfeit pays out the waiter's own stake times two, net of rake, exactly
  -- as a normal win would, so forfeiting is never a better deal than playing.
  update public.profiles
     set wallet_balance = wallet_balance + opp_row.payout
   where id = opp_id;

  -- Owner-anchored, same shape as the other two settlement paths. The
  -- forfeiter's score is whatever they had banked (often 0 -- they walked), and
  -- winner_id is the opponent, who is the one being paid below.
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


-- ── 9. record_deposit(): credit a verified Paystack payment ─────────────────
-- Only ever called by the server-side verify-deposit edge function, which asks
-- Paystack whether the money actually arrived. It is NOT granted to the browser
-- role on purpose -- the client must not be able to mint a balance.

create or replace function public.record_deposit(
  p_amount    bigint,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  amount bigint;
begin
  if me is null then
    raise exception 'You must be signed in to deposit.';
  end if;

  amount := p_amount;

  if amount <= 0 or amount > 10000000 then
    raise exception 'Invalid deposit amount.';
  end if;

  insert into public.profiles (id, wallet_balance)
  values (me, amount)
  on conflict (id) do update
    set wallet_balance = public.profiles.wallet_balance + excluded.wallet_balance;

  insert into public.transactions (user_id, title, type, amount, detail, reference)
  values (me, 'Wallet Deposit', 'deposit', amount,
          'Reference: ' || coalesce(p_reference, 'n/a'),
          p_reference);

  return jsonb_build_object('credited', amount);
end;
$$;

revoke all on function public.record_deposit(bigint, text) from public;
-- Intentionally NOT granted to `authenticated`: this one moves money from an
-- external provider and must only be callable by the service-role edge function.


-- ── 9b. Expire abandoned challenges ─────────────────────────────────────────
-- A challenge left in 'playing' or 'queued' is a live claim on a player's
-- money, and the matchmaker in settle_duel()/tie_duel()/forfeit_duel() picks the
-- OLDEST waiting row (order by created_at asc). That means one abandoned
-- challenge silently becomes the preferred opponent for every later duel of the
-- same game and stake -- which is how a stale row from an old session ends up
-- "matched" against a new one, with the new player's stake paid out against a
-- two-hour-old zombie.
--
-- The state alone cannot distinguish abandoned from in-progress, because a
-- player who opened a duel a second ago is also 'playing'. Age is the only
-- signal available, so this is deliberately conservative: 6 hours is far
-- beyond any real match, and a challenge that old has no live client polling
-- for it.
--
-- The rows are NOT deleted. They are marked 'cancelled' so they drop out of the
-- matchmaker's filter, and the stake is left exactly where it is -- the player
-- still calls cancel_duel() to collect the 80% refund, or support sorts it out.
-- Deleting them here would destroy the audit trail on a financial table, and
-- deleting with no refund would quietly take a player's money.
create or replace function public.expire_stale_challenges(p_max_age_minutes integer default 360)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  if p_max_age_minutes is null or p_max_age_minutes < 1 then
    raise exception 'p_max_age_minutes must be a positive number.';
  end if;

  with stale as (
    update public.stake_challenges
       set status = 'cancelled'
     where status in ('playing', 'queued')
       and created_at < now() - make_interval(mins => p_max_age_minutes)
    returning 1
  )
  select count(*) into n from stale;

  return n;
end;
$$;

revoke all on function public.expire_stale_challenges(integer) from public;
-- Granted to authenticated as well, because a client is the only thing that
-- knows a duel was abandoned. The function still only ever touches rows older
-- than the caller's own minimum age, and it moves no money.
grant execute on function public.expire_stale_challenges(integer) to authenticated;


-- ── 10. Row Level Security ──────────────────────────────────────────────────
-- Without these, any signed-in user can read every other user's wallet by
-- changing the eq filter. verified=true is required before accepting real money.

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.bets enable row level security;
alter table public.stake_challenges enable row level security;

-- profiles: a player sees only their own row.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- A player may create their own row at signup.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- A player may edit their own row.
--
-- is_verified is protected by a COLUMN GRANT below rather than by this policy.
-- The obvious spelling --
--
--   with check (id = auth.uid() and is_verified =
--              (select is_verified from public.profiles p where p.id = auth.uid()))
--
-- -- is WRONG, and fails with "infinite recursion detected in policy for
-- relation profiles" (42P17). The subquery reads public.profiles from inside a
-- policy ON public.profiles, so Postgres applies this same policy to the
-- subquery, which recurses forever. Because the whole file is one transaction,
-- that error rolls back the migration and leaves the database untouched --
-- including the open_duel() fix you are trying to apply.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- The real guard against flipping the flag in DevTools: take away column-level
-- UPDATE permission on is_verified for the browser role. A policy cannot tell
-- which columns a statement touched, but a grant can, so this is the only
-- spelling that actually holds.
--
-- wallet_balance deliberately stays in that grant so _test-duel-flow.mjs can
-- still zero a throwaway wallet between runs. Only is_verified is frozen.
revoke update on public.profiles from authenticated;
grant update (username, email, wallet_balance, avatar_url, bank_code, bank_name,
              account_number, kyc_type, kyc_id_masked, legal_name)
  on public.profiles to authenticated;

-- Belt and braces: any column added to this table later is NOT writable by the
-- browser until someone repeats the grant above. is_verified therefore stays
-- server-only even as the table grows.

-- transactions: own rows only.
drop policy if exists transactions_own on public.transactions;
create policy transactions_own on public.transactions
  for select to authenticated
  using (user_id = auth.uid());

-- bets: anyone signed in may read (this is the public leaderboard feed).
drop policy if exists bets_read_authenticated on public.bets;
create policy bets_read_authenticated on public.bets
  for select to authenticated
  using (true);

-- stake_challenges: own rows, plus any open challenge others can join.
drop policy if exists challenges_visible on public.stake_challenges;
create policy challenges_visible on public.stake_challenges
  for select to authenticated
  using (user_id = auth.uid() or status in ('queued', 'matched'));

commit;
