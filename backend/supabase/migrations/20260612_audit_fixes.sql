-- ── Audit fixes 2026-06-12 ────────────────────────────────────────────────────

-- C1: Add claimed_at so the cron can detect and recover stale 'processing' rows.
alter table scheduled_posts
  add column if not exists claimed_at timestamptz;

-- C1: Update claim function to stamp claimed_at on every claim.
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
  from   claimed
  where  sp.id = claimed.id
  returning sp.*;
$$;

revoke all on function claim_scheduled_post(uuid, text) from public;
grant execute on function claim_scheduled_post(uuid, text) to service_role;

-- H4: Restrict anonymous uploads to images and videos only, max 50 MB.
-- Supabase Storage enforces file_size_limit and allowed_mime_types at the bucket level.
update storage.buckets
set    file_size_limit    = 52428800,          -- 50 MB
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'video/mp4', 'video/quicktime', 'video/webm'
       ]
where  id = 'media';
