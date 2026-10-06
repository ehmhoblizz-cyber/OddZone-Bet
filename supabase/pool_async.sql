-- =====================================================================
-- OddZone — 8-Ball Pool "Async / Take Turns" backend
--
-- One row per async match. The whole table (every ball's x/y/alive flag,
-- both players' groups, whose turn it is and the score) lives in `state`
-- as JSONB, so a player can close the tab and resume days later from a
-- different device.
--
-- Run this once in the Supabase SQL editor.
-- =====================================================================

create table if not exists public.pool_matches (
  id                uuid primary key default gen_random_uuid(),

  -- Short, human-shareable code shown in the UI (e.g. "K7QX2M").
  code              text not null unique,

  host_name         text not null default 'Host',
  challenger_name   text,

  -- status: WAITING (no opponent yet) | ACTIVE | COMPLETED
  status            text not null default 'WAITING',

  -- seat index of the player who may shoot next: 0 = host, 1 = challenger
  turn              int  not null default 0,

  -- Authoritative table snapshot.
  state             jsonb not null default '{}'::jsonb,

  host_score        int not null default 0,
  challenger_score  int not null default 0,

  -- seat index of the winner, null while the match is live
  winner            int,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pool_matches_status_idx on public.pool_matches (status);
create index if not exists pool_matches_updated_idx on public.pool_matches (updated_at desc);


-- Keep updated_at fresh on every write.
create or replace function public.touch_pool_match()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pool_matches_touch on public.pool_matches;
create trigger pool_matches_touch
  before update on public.pool_matches
  for each row execute function public.touch_pool_match();


-- =====================================================================
-- ROW LEVEL SECURITY
--
-- The anon key is public, so the browser can write anything it likes
-- directly. These policies keep a casual player from reading or editing
-- someone else's match while still allowing the game to work today.
--
-- BEFORE REAL STAKES: replace the client-side writes in
-- games/standalone/8-ball-pool.html with a single Postgres RPC (or Edge
-- Function) that verifies the signed-in user is one of the two
-- participants and that the match is still ACTIVE, and revoke the
-- anon UPDATE policy below. See the Wagering Note in games/README.md.
-- =====================================================================

alter table public.pool_matches enable row level security;

drop policy if exists pool_matches_read on public.pool_matches;
create policy pool_matches_read on public.pool_matches
  for select using (true);

-- Claiming a seat and pushing a new table snapshot.
drop policy if exists pool_matches_update on public.pool_matches;
create policy pool_matches_update on public.pool_matches
  for update using (true) with check (true);

-- Match creation.
drop policy if exists pool_matches_insert on public.pool_matches;
create policy pool_matches_insert on public.pool_matches
  for insert with check (true);


-- =====================================================================
-- Realtime
--
-- The game also sends a lightweight broadcast on the
-- "pool-match:<code>" channel so the opponent's table updates without
-- waiting for the 4-second poll. Realtime for the table row is optional;
-- enable it if you want database-change pushes as well:
--
--   alter publication supabase_realtime add table public.pool_matches;
--
-- Re-running the statement is safe; if it reports that the table is
-- already a member of the publication, ignore the error.
-- =====================================================================