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
  likes_count    integer          not null default 0,
  comments_count integer          not null default 0,
  created_at     timestamptz      not null default now(),
  published_at   timestamptz
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
