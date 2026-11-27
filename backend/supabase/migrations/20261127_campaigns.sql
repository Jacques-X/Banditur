-- Kalendarju campaign planning (2026-11-27). Needs 20261122_sharing.sql first. Safe to run twice.
--
-- 1. Campaigns: a named run of days (from_day..to_day inclusive, 'YYYY-MM-DD'), a colour, a goal
--    and an optional target of posts per week.
-- 2. Slots: posts planned but not made yet (day, optional 'HH:mm', platforms, status), linked to
--    a campaign and/or an event; status 'done' + post_id once a real post was scheduled from it;
--    owner (who prepares it), due (ready-by day) and category (its type, like a post's category).
-- 3. Events can belong to a campaign.
-- 4. Scheduled posts can belong to a campaign (scheduled_posts.campaign_id, text like event_id: the
--    calendar may be kept on a Mac, so there is no foreign key). Needed by the backend that reads it,
--    so apply this before deploying, whether or not the calendar is shared.
-- Served by api/events.js (?type=campaign|slot); rules in api/_lib/event-rules.js.

create table if not exists calendar_campaigns (
  id          uuid primary key default gen_random_uuid(),
  profile_id  text not null,
  request_id  text,
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default '#3355D1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  from_day    text not null check (from_day ~ '^\d{4}-\d\d-\d\d$'),
  to_day      text not null check (to_day ~ '^\d{4}-\d\d-\d\d$' and to_day >= from_day),
  goal        text not null default '' check (char_length(goal) <= 300),
  target      integer not null default 0 check (target between 0 and 50),
  notes       text not null default '' check (char_length(notes) <= 2000),
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists calendar_campaigns_profile on calendar_campaigns(profile_id, from_day);
create unique index if not exists calendar_campaigns_request_id on calendar_campaigns(request_id) where request_id is not null;

alter table scheduled_posts add column if not exists campaign_id text;
create index if not exists scheduled_posts_campaign on scheduled_posts(campaign_id);

alter table calendar_events add column if not exists campaign_id uuid references calendar_campaigns(id) on delete set null;

create table if not exists calendar_slots (
  id           uuid primary key default gen_random_uuid(),
  profile_id   text not null,
  request_id   text,
  title        text not null check (char_length(title) between 1 and 120),
  day          text not null check (day ~ '^\d{4}-\d\d-\d\d$'),
  time         text not null default '' check (time = '' or time ~ '^\d\d:\d\d$'),
  platforms    text[] not null default '{}',
  status       text not null default 'idea' check (status in ('idea', 'draft', 'ready', 'done')),
  campaign_id  uuid references calendar_campaigns(id) on delete set null,
  event_id     uuid references calendar_events(id) on delete set null,
  notes        text not null default '' check (char_length(notes) <= 2000),
  post_id      text not null default '' check (char_length(post_id) <= 100),
  owner        text not null default '' check (char_length(owner) <= 60),
  due          text not null default '' check (due = '' or due ~ '^\d{4}-\d\d-\d\d$'),
  category     text not null default '' check (char_length(category) <= 80),
  revision     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists calendar_slots_profile on calendar_slots(profile_id, day);
-- Columns added while the migration was being written (no-ops on a fresh table).
alter table calendar_slots add column if not exists owner text not null default '' check (char_length(owner) <= 60);
alter table calendar_slots add column if not exists due text not null default '' check (due = '' or due ~ '^\d{4}-\d\d-\d\d$');
alter table calendar_slots add column if not exists category text not null default '' check (char_length(category) <= 80);
create unique index if not exists calendar_slots_request_id on calendar_slots(request_id) where request_id is not null;

drop trigger if exists calendar_campaigns_revision on calendar_campaigns;
create trigger calendar_campaigns_revision before update on calendar_campaigns
for each row execute function bump_calendar_revision();
drop trigger if exists calendar_slots_revision on calendar_slots;
create trigger calendar_slots_revision before update on calendar_slots
for each row execute function bump_calendar_revision();

alter table calendar_campaigns enable row level security;
alter table calendar_slots enable row level security;
drop policy if exists "calendar_campaigns_service_only" on calendar_campaigns;
create policy "calendar_campaigns_service_only" on calendar_campaigns for all to service_role using (true) with check (true);
drop policy if exists "calendar_slots_service_only" on calendar_slots;
create policy "calendar_slots_service_only" on calendar_slots for all to service_role using (true) with check (true);
