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
