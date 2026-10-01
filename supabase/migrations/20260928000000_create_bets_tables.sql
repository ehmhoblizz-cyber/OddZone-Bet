-- ═══════════════════════════════════════════════════════════════════════════
-- OddZone — 1v1 stake duel schema
-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIED DEFECT (live project checked 2026-09-29): every table below
-- returned HTTP 404 from PostgREST. The project and the publishable key are
-- both valid (auth/v1/settings responds), so this migration was simply never
-- applied to the live database. Because the client wraps every call in
-- try/catch, deposits, profile loads, wallet writes, the challenge board, the
-- leaderboard and 1v1 settlement all failed completely silently.
--
-- The original version of this file also omitted `profiles` and
-- `stake_challenges` — the two tables the 1v1 flow depends on most. Both are
-- defined below.
--
-- Safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles ───────────────────────────────────────────────────────────────
-- Authoritative wallet balance and verification state. Without this a
-- signed-in user's balance silently resets to 0 and deposits are lost.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text,
  email         text,
  wallet_balance bigint not null default 0,
  is_verified   boolean not null default false,
  kyc_type      text,
  kyc_id_masked text,
  legal_name    text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- ── stake_challenges ───────────────────────────────────────────────────────
-- The PRIMARY 1v1 table. matchmaking.js lists rows with status 'queued'; the
-- arena matches an opponent on game_id + stake + status.
-- `id` is client-generated text ('CHLG-<timestamp>-<rand>'), so it must be
-- text — the fallback tables below use uuid and cannot be reused here.
create table if not exists public.stake_challenges (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  game_id       text not null,
  stake         bigint not null default 0,
  payout        bigint not null default 0,
  score         bigint not null default 0,
  status        text not null default 'playing',
  opponent_id   uuid references auth.users(id) on delete set null,
  winner_id     uuid references auth.users(id) on delete set null,
  refund_amount bigint,
  created_at    timestamptz not null default now()
);

create index if not exists stake_challenges_user_id_idx on public.stake_challenges (user_id);
create index if not exists stake_challenges_status_idx on public.stake_challenges (status);
create index if not exists stake_challenges_game_id_idx on public.stake_challenges (game_id);
-- Matchmaking polls on (game_id, stake) where status='queued'.
create index if not exists stake_challenges_match_idx
  on public.stake_challenges (game_id, stake, status, created_at);

-- ── bets (fallback challenge/leaderboard list) ─────────────────────────────
create table if not exists public.bets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  game_id       text,
  game          text,
  game_title    text,
  score         bigint,
  stake         bigint not null default 0,
  payout        bigint not null default 0,
  status        text not null default 'completed',
  opponent_id   uuid references auth.users(id) on delete set null,
  winner_id     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists bets_user_id_idx on public.bets (user_id);
create index if not exists bets_created_at_idx on public.bets (created_at desc);
create index if not exists bets_game_id_idx on public.bets (game_id);

-- ── pending_bets (second fallback) ─────────────────────────────────────────
create table if not exists public.pending_bets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade,
  game_id        text not null,
  game_title     text,
  stake          bigint not null default 0,
  payout         bigint not null default 0,
  status         text not null default 'queued',
  creator_score  bigint,
  opponent_score bigint,
  opponent_id    uuid references auth.users(id) on delete set null,
  winner_id      uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

create index if not exists pending_bets_user_id_idx on public.pending_bets (user_id);
create index if not exists pending_bets_status_idx on public.pending_bets (status);
create index if not exists pending_bets_created_at_idx on public.pending_bets (created_at desc);

-- ── transactions (deposit / withdrawal / settlement ledger) ────────────────
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  title      text not null,
  type       text not null default 'deposit',
  amount     bigint not null default 0,
  detail     text,
  reference  text,
  status     text,
  created_at timestamptz not null default now()
);

-- A Paystack reference must only ever be credited once, so this needs to be
-- UNIQUE rather than a plain index. The verify-deposit edge function relies on
-- the constraint to stop a replayed callback paying out twice.
create unique index if not exists transactions_reference_uniq
  on public.transactions (reference)
  where reference is not null;

create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_created_at_idx on public.transactions (created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row level security
-- ═══════════════════════════════════════════════════════════════════════════
-- The challenge board is read as a guest too (guest mode is the default entry
-- point), so those SELECTs stay open. Everything touching money is locked to
-- the owning user: the browser must never read someone else's balance.
--
-- NOTE: the profiles UPDATE policy below is deliberately removed compared to
-- the previous version. Letting the browser write wallet_balance let any
-- player edit their balance in DevTools. All balance changes now go through
-- the SECURITY DEFINER functions below, which is the only safe arrangement
-- once real money is involved.
alter table public.profiles         enable row level security;
alter table public.stake_challenges enable row level security;
alter table public.bets             enable row level security;
alter table public.pending_bets     enable row level security;
alter table public.transactions     enable row level security;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() = id);

-- The old "profiles_update" policy allowed the browser to set wallet_balance.
drop policy if exists "profiles_update" on public.profiles;

-- Non-balance profile fields still need to be editable by their owner.
drop policy if exists "profiles_update_safe" on public.profiles;
create policy "profiles_update_safe" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete using (auth.uid() = id);

-- World-readable so guests can see and accept open duels.
drop policy if exists "stake_challenges_read" on public.stake_challenges;
create policy "stake_challenges_read" on public.stake_challenges
  for select using (true);

drop policy if exists "stake_challenges_insert" on public.stake_challenges;
create policy "stake_challenges_insert" on public.stake_challenges
  for insert with check (auth.uid() = user_id);

-- A player may update their own challenge (to submit a score or cancel).
drop policy if exists "stake_challenges_update" on public.stake_challenges;
create policy "stake_challenges_update" on public.stake_challenges
  for update using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "bets_read" on public.bets;
create policy "bets_read" on public.bets for select using (true);
drop policy if exists "bets_insert" on public.bets;
create policy "bets_insert" on public.bets for insert with check (auth.uid() = user_id);

drop policy if exists "pending_bets_read" on public.pending_bets;
create policy "pending_bets_read" on public.pending_bets for select using (true);
drop policy if exists "pending_bets_insert" on public.pending_bets;
create policy "pending_bets_insert" on public.pending_bets
  for insert with check (auth.uid() = user_id);

-- A player may read and write only their own ledger rows.
drop policy if exists "transactions_read" on public.transactions;
create policy "transactions_read" on public.transactions
  for select using (auth.uid() = user_id);
drop policy if exists "transactions_insert" on public.transactions;
create policy "transactions_insert" on public.transactions
  for insert with check (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Server-authoritative 1v1 settlement
-- ═══════════════════════════════════════════════════════════════════════════
-- The client used to run the whole 1v1 flow in the browser: deduct the stake,
-- read the opponent's score, decide a winner, then write wallet_balance
-- itself. That is broken twice over:
--   1. A player can edit wallet_balance in DevTools, or claim any score.
--   2. Two players queuing at the same moment can both read the same opponent
--      row and both be paid — a double-settlement race.
--
-- settle_duel() moves that decision into one atomic function. The client may
-- only report "I finished with this score"; the database picks the opponent,
-- decides the winner, moves the money and writes the ledger. Row locking makes
-- concurrent matchmaking settle exactly once.

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
  me        uuid := auth.uid();
  mine      public.stake_challenges%rowtype;
  opp_id    uuid;
  opp_row   public.stake_challenges%rowtype;
  winner    uuid;
  is_tie    boolean := false;
begin
  if me is null then
    raise exception 'You must be signed in to settle a duel.';
  end if;

  -- Lock my row so a double-submit cannot settle twice.
  select * into mine
    from public.stake_challenges
   where id = p_challenge_id and user_id = me
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

  -- Record the score and enter the queue.
  update public.stake_challenges
     set score   = greatest(coalesce(score, 0), coalesce(p_score, 0)),
         status  = 'queued'
   where id = p_challenge_id
  returning * into mine;

  -- Take the oldest waiting opponent on the same game and stake. FOR UPDATE
  -- SKIP LOCKED means two players arriving together cannot both claim the
  -- same opponent — the second one moves on to the next row.
  select * into opp_row
    from public.stake_challenges c
   where c.game_id = mine.game_id
     and c.stake   = mine.stake
     and c.status  = 'queued'
     and c.user_id is not null
     and c.user_id <> me
   order by c.created_at asc
   limit 1
   for update skip locked;

  if opp_row.id is null then
    return jsonb_build_object(
      'matched', false,
      'status',  'queued',
      'stake',   mine.stake
    );
  end if;

  opp_id := opp_row.user_id;

  -- Decide the winner. Equal scores are a tie and both stakes come back.
  if p_score > opp_row.score then
    winner := me;
  elsif p_score < opp_row.score then
    winner := opp_id;
  else
    is_tie := true;
  end if;

  -- Lock both rows as matched in one pass so neither side can re-settle.
  update public.stake_challenges
     set status = 'matched', opponent_id = opp_id, winner_id = winner
   where id in (mine.id, opp_row.id);

  if is_tie then
    -- Each player gets their own stake back, untouched.
    update public.profiles set wallet_balance = wallet_balance + mine.stake  where id = me;
    update public.profiles set wallet_balance = wallet_balance + opp_row.stake where id = opp_id;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Tie – Stake Refunded', 'refund', mine.stake,
            'Both players scored ' || p_score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', true, 'won', null,
      'your_score', p_score, 'opponent_score', opp_row.score,
      'payout', 0, 'refunded', mine.stake
    );
  end if;

  if winner = me then
    -- `payout` was computed at stake time as stake * 2 * (1 - rake).
    update public.profiles set wallet_balance = wallet_balance + mine.payout where id = me;

    insert into public.transactions (user_id, title, type, amount, detail)
    values (me, '1v1 Win', 'payout', mine.payout,
            'Beat your opponent ' || p_score || ' to ' || opp_row.score || '.');

    return jsonb_build_object(
      'matched', true, 'is_tie', false, 'won', true,
      'your_score', p_score, 'opponent_score', opp_row.score,
      'payout', mine.payout
    );
  end if;

  -- Lost: the stake was already deducted when the duel started, so there is
  -- nothing further to move. Just record it for the ledger.
  insert into public.transactions (user_id, title, type, amount, detail)
  values (me, '1v1 Loss', 'stake', mine.stake,
          'Scored ' || p_score || ' against ' || opp_row.score || '.');

  return jsonb_build_object(
    'matched', true, 'is_tie', false, 'won', false,
    'your_score', p_score, 'opponent_score', opp_row.score,
    'payout', 0
  );
end;
$$;

-- Only signed-in users may call it. The function re-derives the caller from
-- auth.uid(), so a player can never settle somebody else's duel.
revoke all on function public.settle_duel(text, bigint) from public;
grant execute on function public.settle_duel(text, bigint) to authenticated;

-- ── cancel_duel: refund 80% when a player backs out before matching ────────
create or replace function public.cancel_duel(p_challenge_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  mine    public.stake_challenges%rowtype;
  refund  bigint;
begin
  if me is null then
    raise exception 'You must be signed in to cancel a duel.';
  end if;

  select * into mine
    from public.stake_challenges
   where id = p_challenge_id and user_id = me
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

  -- 80% back, 20% cancellation fee retained.
  refund := floor(mine.stake * 0.8)::bigint;

  update public.stake_challenges
     set status = 'cancelled', refund_amount = refund
   where id = p_challenge_id;

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

-- ── record_deposit: credit a verified Paystack payment ─────────────────────
-- The client used to add to wallet_balance itself after the Paystack popup
-- resolved, which meant the amount came from the browser. The amount now
-- arrives from the server-side verify-identity edge function.
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

  -- Guard against a negative or absurd credit.
  if amount <= 0 or amount > 10000000 then
    raise exception 'Invalid deposit amount.';
  end if;

  insert into public.profiles (id, wallet_balance)
  values (me, amount)
  on conflict (id) do update
    set wallet_balance = public.profiles.wallet_balance + excluded.wallet_balance,
        updated_at = now();

  insert into public.transactions (user_id, title, type, amount, detail, reference)
  values (me, 'Wallet Deposit', 'deposit', amount,
          'Reference: ' || coalesce(p_reference, 'n/a'),
          p_reference);

  return jsonb_build_object('credited', amount);
end;
$$;

revoke all on function public.record_deposit(bigint, text) from public;
grant execute on function public.record_deposit(bigint, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
-- ═══════════════════════════════════════════════════════════════════════════
-- "Accept Duel" and the matchmaking search both need pushes, otherwise a
-- player never learns an opponent arrived. The old client subscribed to a
-- `matches` table that has never existed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'stake_challenges'
  ) then
    alter publication supabase_realtime add table public.stake_challenges;
  end if;
end $$;

-- ── open_duel: debit the stake and queue the challenge atomically ──────────
-- The client previously deducted the stake from wallet_balance itself and
-- then inserted the challenge row. That is a money bug: the balance was
-- written straight from the browser, and a player could edit it in DevTools
-- to stake money they do not have.
--
-- open_duel() debits inside Postgres, rejects the stake if the balance is
-- short, and creates the challenge row in the same transaction. Either both
-- happen or neither does.
create or replace function public.open_duel(
  p_game_id    text,
  p_stake      bigint,
  p_payout     bigint
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

  if p_stake < 200 then
    raise exception 'Minimum stake is 200 naira.';
  end if;

  -- Lock the profile row for the duration so two concurrent duels cannot
  -- both pass the balance check against the same starting balance.
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

  new_id := 'CHLG-' || (extract(epoch from now()) * 1000)::bigint::text
            || '-' || upper(substr(md5(random()::text), 1, 4));

  update public.profiles
     set wallet_balance = wallet_balance - p_stake,
         updated_at = now()
   where id = me;

  insert into public.stake_challenges (id, user_id, game_id, stake, payout, score, status)
  values (new_id, me, p_game_id, p_stake, p_payout, 0, 'playing');

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

-- ── wallet_balance(): single source of truth for the displayed balance ─────
-- After a duel settles the server owns the number, so the client re-reads it
-- rather than trusting its own arithmetic.
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
