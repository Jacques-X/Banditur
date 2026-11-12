-- Xogħol: shared, per-profile to-do boards. A profile has any number of
-- user-created boards (e.g. "Videos", "Elementi"); each board has columns of cards.
-- Additive migration. Apply before deploying the backend that serves /api/tasks.

create table if not exists task_boards (
  id          uuid primary key default gen_random_uuid(),
  profile_id  text not null,
  title       text not null check (char_length(title) between 1 and 60),
  position    double precision not null,
  request_id  text,
  revision    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists task_boards_profile on task_boards(profile_id, position);
create unique index if not exists task_boards_request_id on task_boards(request_id) where request_id is not null;

create table if not exists task_columns (
  id          uuid primary key default gen_random_uuid(),
  profile_id  text not null,
  board_id    uuid not null references task_boards(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 60),
  position    double precision not null,
  request_id  text,
  revision    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists task_columns_board on task_columns(board_id, position);
create unique index if not exists task_columns_request_id on task_columns(request_id) where request_id is not null;

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  profile_id  text not null,
  column_id   uuid not null references task_columns(id) on delete cascade,
  position    double precision not null,
  title       text not null check (char_length(title) between 1 and 200),
  notes       text not null default '' check (char_length(notes) <= 10000),
  checklist   jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  start_date  date,
  due_date    date check (due_date is null or start_date is null or start_date <= due_date),
  label       text check (label is null or label in ('red', 'orange', 'yellow', 'green', 'blue', 'purple')),
  request_id  text,
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_profile on tasks(profile_id);
create index if not exists tasks_column on tasks(column_id, position);
create unique index if not exists tasks_request_id on tasks(request_id) where request_id is not null;

-- Every update bumps the revision, so edits made from an older copy are refused (409).
create or replace function bump_task_revision() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  if tg_table_name = 'tasks' then new.updated_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists task_boards_revision on task_boards;
create trigger task_boards_revision before update on task_boards
for each row execute function bump_task_revision();
drop trigger if exists task_columns_revision on task_columns;
create trigger task_columns_revision before update on task_columns
for each row execute function bump_task_revision();
drop trigger if exists tasks_revision on tasks;
create trigger tasks_revision before update on tasks
for each row execute function bump_task_revision();

-- Private to clients, like scheduled_posts: only the backend (service role) reads/writes.
alter table task_boards enable row level security;
alter table task_columns enable row level security;
alter table tasks enable row level security;
drop policy if exists "task_boards_service_only" on task_boards;
create policy "task_boards_service_only" on task_boards for all to service_role using (true) with check (true);
drop policy if exists "task_columns_service_only" on task_columns;
create policy "task_columns_service_only" on task_columns for all to service_role using (true) with check (true);
drop policy if exists "tasks_service_only" on tasks;
create policy "tasks_service_only" on tasks for all to service_role using (true) with check (true);
