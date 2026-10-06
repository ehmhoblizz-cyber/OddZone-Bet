-- ═══════════════════════════════════════════════════════════════════════════
-- 20261004000006_stale_sweep_refunds.sql
--
-- STOPS expire_stale_challenges() FROM TAKING A PLAYER'S MONEY, AND RE-OPENS
-- THE REFUND DOOR IT SEALED.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
-- 20261001000000 section 9 wrote the sweep as:
--
--     update public.stake_challenges
--        set status = 'cancelled'
--      where status in ('playing', 'queued')
--        and created_at < now() - make_interval(mins => p_max_age_minutes)
--
-- and cancel_duel() -- the ONLY thing that ever refunds a stake -- opens with:
--
--     if mine.status = 'cancelled' then
--       raise exception 'This duel was already cancelled.'
--
-- So six hours after opening a duel, the sweep marked it 'cancelled' and the
-- player's 80% refund path closed permanently. The stake was debited at
-- open_duel() time and is now unreachable by any code path in the system. The
-- original file's own comment says the player "still calls cancel_duel() to
-- collect the 80% refund" -- that comment describes behaviour the sweep
-- actively prevents.
--
-- It also moved no money of its own, so the 'cancelled' row is a record of
-- money that vanished. Nothing in the UI distinguishes it from a deliberate
-- cancel, which already paid out.
--
-- ── WHY THIS IS WORTH FIXING RATHER THAN DISABLING ──────────────────────────
-- The sweep exists for a real reason: the matchmaker picks the OLDEST waiting
-- row (order by created_at asc in settle_duel/tie_duel/forfeit and
-- claim_duel_opponent), so an abandoned row silently becomes the preferred
-- opponent for every later duel of the same game and stake. A two-hour-old
-- zombie gets settled against a new player's real money.
--
-- Removing the sweep would reintroduce that. So it stays -- it just has to stop
-- destroying value while it works.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- 1. The sweep REFUNDS as it expires. Same 80% rule and the same
--    floor(stake * 0.8) arithmetic cancel_duel() uses, credited in the same
--    statement block, with a ledger row so the money is auditable.
--
-- 2. refund_amount becomes the idempotency key, not just a display value. It
--    is NULL on a live row and non-NULL once money has been returned, so
--    `refund_amount is null` means "this stake is still held". Re-running the
--    sweep cannot double-refund, and cancel_duel() can use the same test.
--
-- 3. cancel_duel() accepts an ALREADY-cancelled row that was never refunded,
--    so any row the previous sweep already stranded can still be collected by
--    its owner. That is what makes this migration retroactive rather than
--    forward-only.
--
-- ── PERMISSION: authenticated IS REVOKED ────────────────────────────────────
-- The old grant's justification was "it moves no money". That was true of the
-- old body and is false of the new one -- the sweep now credits wallets, so any
-- signed-in user could invoke it. Worse, the parameter is client-supplied: a
-- caller could pass a huge age and let the sweep cancel every live duel on the
-- platform at once, refunding all of them, in one call.
--
-- Grepped this repo before revoking: no client, script or migration calls
-- expire_stale_challenges(). It was defined and granted, never wired up. So
-- revoking authenticated costs nothing today, and the sweep becomes something
-- an operator or a scheduled job invokes deliberately. Reinstate a grant only
-- alongside a real caller.
--
-- ── ROWS ALREADY STRANDED ───────────────────────────────────────────────────
-- Rows the PREVIOUS sweep already cancelled cannot be refunded by this sweep,
-- because that sweep only ever saw status in ('playing','queued') and they are
-- no longer in that set. They are counted and reported so they can be refunded
-- deliberately. cancel_duel() now accepts them, so their owners can self-serve
-- it -- one call each, through the normal UI, with the usual 20% fee.
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
       and p.proname in ('expire_stale_challenges', 'cancel_duel')
  loop
    execute format('drop function if exists %s', r.sig);
    raise notice 'dropped %', r.sig;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- expire_stale_challenges(integer) -- retire abandoned duels AND return the
-- money.
--
-- Refund and status change happen in ONE statement block so a failure cannot
-- leave a row cancelled and unrefunded -- which is exactly the state this
-- migration exists to eliminate.
-- ═══════════════════════════════════════════════════════════════════════════
create function public.expire_stale_challenges(p_max_age_minutes integer default 360)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired record;
  v_count   bigint := 0;
begin
  if p_max_age_minutes is null or p_max_age_minutes < 1 then
    raise exception 'p_max_age_minutes must be a positive number.';
  end if;

  -- Return the rows, not a bare count: the refund needs each row's stake and
  -- owner, and re-selecting them afterwards would race another sweep in
  -- between. FOR UPDATE holds them for the duration.
  with stale as (
    select c.id, c.user_id, c.stake
      from public.stake_challenges c
     where c.status in ('playing', 'queued', 'solo')
       -- Never touch a duel that has already moved money. settled_at is the
       -- only reliable "finished" marker -- status is already spoken for by
       -- pairing.
       and c.settled_at is null
       -- THE IDEMPOTENCY KEY. refund_amount is NULL while the stake is still
       -- held and non-NULL once it has been returned, so this can never credit
       -- the same row twice no matter how often the sweep runs.
       and c.refund_amount is null
       and c.created_at < now() - make_interval(mins => p_max_age_minutes)
       for update
  )
  update public.stake_challenges c
     set status        = 'cancelled',
         refund_amount = floor(c.stake * 0.8)::bigint,
         opponent_id   = null
   where c.id in (select id from stale)
  returning c.id, c.user_id, c.stake
  into v_expired;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return 0;
  end if;

  -- Credit the owners. Re-locking the same profile rows in a consistent order
  -- is not possible from a set, so this takes the profiles lock the way
  -- open_duel() does: a plain UPDATE, which is atomic per row and cannot lose
  -- an increment to a concurrent write on the same column.
  update public.profiles p
     set wallet_balance = p.wallet_balance + floor(v_expired.stake * 0.8)::bigint
   where p.id in (select user_id from v_expired where user_id is not null);

  -- Ledger. Without this the refund is invisible in the Activity Explorer and
  -- indistinguishable from the balance simply drifting upward.
  insert into public.transactions (user_id, title, type, amount, detail)
  select v.user_id,
         'Challenge Expired (80% Refund)',
         'refund',
         floor(v.stake * 0.8)::bigint,
         'No opponent arrived within the search window. Reference: ' || v.id::text
    from v_expired v
   where v.user_id is not null;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_challenges(integer) from public;
-- Deliberately NOT granted to authenticated. See the header: the body now moves
-- money, and the age threshold is a client-supplied parameter, so a grant here
-- would let any signed-in user cancel every live duel on the platform.


-- ═══════════════════════════════════════════════════════════════════════════
-- cancel_duel(text) -- 80% refund, 20% cancellation fee
--
-- ── THE CHANGE ──────────────────────────────────────────────────────────────
-- The old guard:
--
--     if mine.status = 'cancelled' then
--       raise exception 'This duel was already cancelled.'
--
-- is replaced by a test on refund_amount. A row that is cancelled but has never
-- been refunded is a row whose money is still held by the system, and the
-- owner must be able to collect it. Refusing them was the half of the defect
-- that made the old sweep irreversible.
--
-- A row that is already cancelled AND already refunded still raises, so the
-- refund cannot be collected twice.
--
-- ── WHY NOT SIMPLY DELETE THE STATUS CHECK ────────────────────────────────
-- It would make this function idempotent for a settled row too. settled_at is
-- tested above it and refuses those, but the status check is kept -- narrowed
-- to mean what it should always have meant: 'the money is gone, not just the
-- row'.
-- ═══════════════════════════════════════════════════════════════════════════
create function public.cancel_duel(p_challenge_id text)
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

  -- settled_at, NOT status -- see 20261004000001's header. open_duel() writes
  -- status='matched' at pairing time, so testing status rejected every properly
  -- paired duel as "already matched".
  if mine.settled_at is not null then
    raise exception 'This duel has already been settled.';
  end if;

  -- THE FIX. refund_amount is NULL while the stake is still held, so this test
  -- refuses exactly one case -- money already returned -- and admits the case
  -- that used to be a dead end: a row the old sweep cancelled without paying
  -- out. Those owners can now self-serve the refund through the normal UI.
  if mine.refund_amount is not null then
    raise exception 'This duel was already cancelled and its refund was paid out.';
  end if;

  refund := floor(mine.stake * 0.8)::bigint;

  -- Status AND refund_amount together, so this single write marks the row as
  -- settled-and-refunded atomically. A crash between the two updates would
  -- otherwise leave a row that no longer looks cancellable but still owes money.
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
-- ROWS THE PREVIOUS SWEEP ALREADY STRANDED.
--
-- 'cancelled' with refund_amount IS NULL means the old sweep closed that row
-- without paying it. Those stakes are still debited from their owners with no
-- path to recovery. They are NOT repaired here: crediting wallets in bulk from
-- a migration is a money movement with no per-row audit trail, and the
-- `user_id is not null` cases are already recoverable one at a time through the
-- UI, now that cancel_duel() accepts them.
--
-- If this number is large, run the remediation below after reading it.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.stake_challenges
   where status = 'cancelled'
     and refund_amount is null
     and settled_at is null;

  if v_count > 0 then
    raise warning
      'STRANDED: % cancelled challenge(s) were expired by the OLD sweep without a refund. Their stakes are still debited. Each owner can now collect 80%% through cancel_duel() (it accepts these rows again). For rows whose owner has abandoned the account, refund manually -- do NOT run an unattended bulk credit.',
      v_count;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Reload PostgREST's schema cache, LAST.
-- ═══════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';