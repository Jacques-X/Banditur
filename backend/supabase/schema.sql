-- NOTE: This file is the consolidated current-state schema for fresh setups.
-- For an existing database, apply the incremental files in migrations/ in order
-- instead (see RELEASE.md) — don't run both against the same DB. In particular,
-- Step 0's stale-row recovery in the cron depends on the `claimed_at` column,
-- which the 20260528 foundation migration omits and 20260612 adds.

create table if not exists scheduled_posts (
  id             uuid primary key default gen_random_uuid(),
  caption        text             not null,
  platforms      text[]           not null default '{}',
  media          jsonb            not null default '[]',
  scheduled_time timestamptz      not null,
  expiry_time    timestamptz,
  profile_id     text             not null default 'main',
  status         text             not null default 'pending'
                                  check (status in ('pending','processing','published','failed')),
  error_message  text,
  fb_post_id     text,
  ig_post_id     text,
  wp_post_id     text,
  likes_count    integer          not null default 0,
  comments_count integer          not null default 0,
  created_at     timestamptz      not null default now(),
  published_at   timestamptz,
  claimed_at     timestamptz
);

create index if not exists scheduled_posts_status_time
  on scheduled_posts (status, scheduled_time);

create index if not exists scheduled_posts_created_at
  on scheduled_posts (created_at desc);

create index if not exists scheduled_posts_published_at
  on scheduled_posts (published_at desc)
  where status = 'published';

-- Add content_type column (missing from original schema)
alter table scheduled_posts
  add column if not exists content_type text not null default 'post'
    check (content_type in ('post', 'reel', 'story'));

-- Fix: 'fb_native' was missing from the status constraint, causing all native FB scheduling to fail
-- with a DB check-constraint violation (status left stuck as 'processing' forever).
alter table scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table scheduled_posts add constraint scheduled_posts_status_check
  check (status in ('pending','processing','fb_native','published','failed'));

alter table scheduled_posts
  add column if not exists wp_post_id text;

-- Atomic row claim used by the cron processor. The SELECT takes a row lock and
-- SKIP LOCKED makes concurrent cron invocations leave already-claimed rows alone.
create or replace function claim_scheduled_post(
  p_id uuid,
  p_expected_status text
)
returns setof scheduled_posts
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id
    from scheduled_posts
    where id = p_id
      and status = p_expected_status
    for update skip locked
  )
  update scheduled_posts sp
  set    status     = 'processing',
         claimed_at = now()
  from claimed
  where sp.id = claimed.id
  returning sp.*;
$$;

revoke all on function claim_scheduled_post(uuid, text) from public;
grant execute on function claim_scheduled_post(uuid, text) to service_role;

-- Keep the table private to clients. Vercel uses the service-role key, which
-- bypasses RLS; the desktop app should not read/write this table directly.
alter table scheduled_posts enable row level security;

drop policy if exists "scheduled_posts_service_only" on scheduled_posts;
create policy "scheduled_posts_service_only"
  on scheduled_posts
  for all
  to service_role
  using (true)
  with check (true);

-- Storage bucket and policies for renderer uploads. The backend continues to use
-- the service role for cleanup/removal. Public read keeps existing public URLs working.
-- H4: Bucket is public-read but uploads are restricted to images/videos ≤ 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm'
])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'media');

-- SEC-3 (see migrations/20260804_signed_uploads.sql): no anon/authenticated
-- INSERT policy on purpose. Uploads go through POST /api/media/sign-upload
-- (requires API_KEY), which mints a Supabase signed-upload token scoped to
-- one specific path — that token authorizes the write directly and doesn't
-- need or use a storage.objects INSERT policy. An open anon/authenticated
-- INSERT policy here would let anyone holding the (routinely extractable)
-- Supabase anon key upload and publicly host arbitrary files, bypassing the
-- app's own API_KEY boundary entirely.
drop policy if exists "media_uploads_insert" on storage.objects;

-- Additive migration. Deploy before the new API and desktop build.
alter table scheduled_posts add column if not exists engagement_checked_at timestamptz;
alter table scheduled_posts add column if not exists engagement_error text;
alter table scheduled_posts add column if not exists revision integer not null default 0;
alter table scheduled_posts add column if not exists request_id text;
alter table scheduled_posts add column if not exists deliveries jsonb not null default '{}';
alter table scheduled_posts add column if not exists event_id text;
alter table scheduled_posts add column if not exists category text not null default '';
alter table scheduled_posts add column if not exists media_retention_days integer not null default 30;
alter table scheduled_posts add column if not exists media_pinned boolean not null default false;
create unique index if not exists scheduled_posts_request_id on scheduled_posts(request_id) where request_id is not null;
create index if not exists scheduled_posts_event on scheduled_posts(event_id);

create or replace function bump_post_revision() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
drop trigger if exists scheduled_posts_revision on scheduled_posts;
create trigger scheduled_posts_revision before update on scheduled_posts
for each row execute function bump_post_revision();

-- Known IDs are evidence; old failed jobs without an ID need operator review,
-- because the old worker did not record the external-call boundary.
update scheduled_posts set deliveries = jsonb_strip_nulls(jsonb_build_object(
  'fb', case when 'fb'=any(platforms) then jsonb_build_object('state',case when fb_post_id is not null then case when status='fb_native' then 'scheduled' else 'published' end when status in ('processing','failed','published') then 'unknown' else 'pending' end,'id',fb_post_id,'object',case when content_type='reel' or media->0->>'type' like 'video/%' then 'video' else 'post' end) end,
  'ig', case when 'ig'=any(platforms) then jsonb_build_object('state',case when ig_post_id is not null then 'published' when status in ('processing','failed','published') then 'unknown' else 'pending' end,'id',ig_post_id) end,
  'wp', case when 'wp'=any(platforms) then jsonb_build_object('state',case when wp_post_id is not null then 'published' when status in ('processing','failed','published') then 'unknown' else 'pending' end,'id',wp_post_id) end
)) where deliveries='{}';

-- Surface old aggregate successes with missing destination evidence for review.
update scheduled_posts set status='failed', claimed_at=null,
  error_message=coalesce(error_message,'Pubblikazzjoni antika mingħajr konferma għal kull destinazzjoni. Ivverifika fuq Meta.')
where exists (select 1 from jsonb_each(deliveries) d where d.value->>'state'='unknown');
