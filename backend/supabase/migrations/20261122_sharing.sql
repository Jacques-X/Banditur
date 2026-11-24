-- Sharing Xogħol and Kalendarju with the committee (2026-11-22).
-- Needs 20261103_tasks.sql first. Safe to run twice.
--
-- 1. Xogħol cards keep a Budget and a Spent amount (whole cents), like on the Mac.
-- 2. Kalendarju: events per profile and one label list, served by api/events.js.
--    Times are Malta wall-clock strings ('YYYY-MM-DDTHH:mm', or 'YYYY-MM-DD' for all-day
--    events with an exclusive end), exactly as the app stores them; tz says which clock.

alter table tasks add column if not exists budget_cents bigint check (budget_cents is null or budget_cents between 0 and 1000000000);
alter table tasks add column if not exists spent_cents  bigint check (spent_cents  is null or spent_cents  between 0 and 1000000000);

create table if not exists calendar_events (
  id           uuid primary key default gen_random_uuid(),
  profile_id   text not null,
  request_id   text,
  title        text not null check (char_length(title) between 1 and 120),
  label        text not null default '' check (char_length(label) <= 40),
  all_day      boolean not null default false,
  start_wall   text not null check (start_wall ~ '^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$'),
  end_wall     text not null check (end_wall ~ '^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$' and end_wall > start_wall),
  location     text not null default '' check (char_length(location) <= 120),
  description  text not null default '' check (char_length(description) <= 2000),
  repeat       jsonb check (repeat is null or jsonb_typeof(repeat) = 'object'),
  poster       jsonb check (poster is null or jsonb_typeof(poster) = 'object'),
  tz           text not null default 'Europe/Malta',
  revision     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists calendar_events_profile on calendar_events(profile_id, start_wall);
create unique index if not exists calendar_events_request_id on calendar_events(request_id) where request_id is not null;

create table if not exists calendar_settings (
  id      smallint primary key default 1 check (id = 1),
  labels  jsonb not null default '[]' check (jsonb_typeof(labels) = 'array')
);

create or replace function bump_calendar_revision() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists calendar_events_revision on calendar_events;
create trigger calendar_events_revision before update on calendar_events
for each row execute function bump_calendar_revision();

alter table calendar_events enable row level security;
alter table calendar_settings enable row level security;
drop policy if exists "calendar_events_service_only" on calendar_events;
create policy "calendar_events_service_only" on calendar_events for all to service_role using (true) with check (true);
drop policy if exists "calendar_settings_service_only" on calendar_settings;
create policy "calendar_settings_service_only" on calendar_settings for all to service_role using (true) with check (true);
