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

drop policy if exists "media_uploads_insert" on storage.objects;
create policy "media_uploads_insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'media'
    and name like 'uploads/%'
    and position('..' in name) = 0
  );
