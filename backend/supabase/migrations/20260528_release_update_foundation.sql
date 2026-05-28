alter table scheduled_posts
  add column if not exists content_type text not null default 'post'
    check (content_type in ('post', 'reel', 'story'));

alter table scheduled_posts
  add column if not exists wp_post_id text;

alter table scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table scheduled_posts add constraint scheduled_posts_status_check
  check (status in ('pending','processing','fb_native','published','failed'));

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
  set status = 'processing'
  from claimed
  where sp.id = claimed.id
  returning sp.*;
$$;

revoke all on function claim_scheduled_post(uuid, text) from public;
grant execute on function claim_scheduled_post(uuid, text) to service_role;

alter table scheduled_posts enable row level security;

drop policy if exists "scheduled_posts_service_only" on scheduled_posts;
create policy "scheduled_posts_service_only"
  on scheduled_posts
  for all
  to service_role
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

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
