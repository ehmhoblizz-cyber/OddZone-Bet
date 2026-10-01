-- 20261002000000_live_community_feed.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Live community activity.
--
-- The Arena Social Feed was localStorage-only, so a post, duel or win made on
-- one device was invisible to every other account until a manual reload, and
-- on a phone it was invisible even to the same account after a refresh.
--
-- This adds a real `feed_posts` table that every connected client subscribes
-- to, so an INSERT broadcasts immediately to all active accounts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── feed_posts ──────────────────────────────────────────────────────────────
-- `id` is client generated text ('feed-<ts>-<rand>') so an offline/queued post
-- keeps the same id when it is retried. `type` mirrors the UI categories:
--   text  – plain status / tip post
--   duel  – an open 1v1 stake challenge attached to the post
--   win   – a recorded win or cashout
create table if not exists public.feed_posts (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  author        text not null,
  author_level  integer not null default 1,
  author_title  text,
  author_photo  text,
  type          text not null default 'text',
  content       text not null,
  game_id       text,
  game_title    text,
  stake         bigint,
  amount        bigint,
  likes         integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists feed_posts_created_at_idx
  on public.feed_posts (created_at desc);
create index if not exists feed_posts_user_id_idx
  on public.feed_posts (user_id);
create index if not exists feed_posts_type_idx
  on public.feed_posts (type);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The feed is world readable (guests see it too, the same as the duel board).
-- A post is insertable only by its author, and only authors may edit or remove
-- their own posts — otherwise any player could delete somebody else's content.
alter table public.feed_posts enable row level security;

drop policy if exists "feed_posts_read" on public.feed_posts;
create policy "feed_posts_read" on public.feed_posts
  for select using (true);

drop policy if exists "feed_posts_insert" on public.feed_posts;
create policy "feed_posts_insert" on public.feed_posts
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "feed_posts_update" on public.feed_posts;
create policy "feed_posts_update" on public.feed_posts
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "feed_posts_delete" on public.feed_posts;
create policy "feed_posts_delete" on public.feed_posts
  for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
-- ═══════════════════════════════════════════════════════════════════════════
-- feed_posts     – new posts / duels / wins broadcast to every feed instantly.
-- stake_challenges is already in the publication (see the previous migration)
-- so a duel opening, matching or settling also pushes.
-- transactions   – a settled duel or cashout updates the balance ledger, so the
--                  balance/wallet screens can update without a refresh.
do $$
declare
  target text;
begin
  foreach target in array array['feed_posts', 'transactions'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;

-- Without REPLICA IDENTITY FULL a DELETE payload arrives with no `old` row, so
-- the client cannot tell which post vanished. This makes old/new complete.
alter table public.feed_posts replica identity full;

-- ── feed_likes ──────────────────────────────────────────────────────────────
-- Likes were previously local only, so a like never reached the author's
-- screen. One row per (post, user) keeps the count server-authoritative and
-- idempotent.
create table if not exists public.feed_likes (
  post_id    text not null references public.feed_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists feed_likes_user_id_idx on public.feed_likes (user_id);

alter table public.feed_likes enable row level security;

drop policy if exists "feed_likes_read" on public.feed_likes;
create policy "feed_likes_read" on public.feed_likes
  for select using (true);

-- A like is a statement of intent by the signed-in player only.
drop policy if exists "feed_likes_insert" on public.feed_likes;
create policy "feed_likes_insert" on public.feed_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "feed_likes_delete" on public.feed_likes;
create policy "feed_likes_delete" on public.feed_likes
  for delete using (auth.uid() = user_id);

-- The like counter is maintained in one place so a client cannot drift it.
create or replace function public.toggle_feed_like(p_post_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liked boolean;
begin
  if v_uid is null then
    return false;
  end if;

  if exists (
    select 1 from public.feed_likes
     where post_id = p_post_id and user_id = v_uid
  ) then
    delete from public.feed_likes
     where post_id = p_post_id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.feed_likes (post_id, user_id)
    values (p_post_id, v_uid)
    on conflict do nothing;
    v_liked := true;
  end if;

  update public.feed_posts
     set likes = (select count(*) from public.feed_likes where post_id = p_post_id)
   where id = p_post_id;

  return v_liked;
end;
$$;

grant execute on function public.toggle_feed_like(text) to authenticated;
