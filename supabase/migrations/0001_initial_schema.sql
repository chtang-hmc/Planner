-- ─────────────────────────────────────────────────────────────────────────────
-- Personal Planner — Initial Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── projects ─────────────────────────────────────────────────────────────────
create table projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#4338c9',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── tasks ────────────────────────────────────────────────────────────────────
create type task_status   as enum ('inbox', 'active', 'done', 'cancelled');
create type task_type     as enum ('task', 'someday', 'recurring');
create type energy_level  as enum ('low', 'medium', 'high');
create type urgency_curve as enum ('linear', 'exponential', 'step');

create table tasks (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  parent_id          uuid references tasks(id) on delete cascade,   -- subtask parent
  title              text not null,
  description        text,
  status             task_status   not null default 'inbox',
  type               task_type     not null default 'task',
  priority           smallint not null default 2 check (priority between 1 and 4),
  energy_required    energy_level  not null default 'medium',
  estimated_minutes  integer check (estimated_minutes > 0),
  adjusted_minutes   integer check (adjusted_minutes > 0),   -- system-calibrated
  actual_minutes     integer check (actual_minutes > 0),     -- logged after done
  due_date           timestamptz,
  urgency_score      real not null default 0 check (urgency_score between 0 and 100),
  urgency_curve      urgency_curve not null default 'linear',
  rrule              text,                                   -- iCal RRULE string
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index tasks_project_id_idx   on tasks(project_id);
create index tasks_parent_id_idx    on tasks(parent_id);
create index tasks_status_idx       on tasks(status);
create index tasks_urgency_idx      on tasks(urgency_score desc);
create index tasks_due_date_idx     on tasks(due_date) where due_date is not null;

-- ── focus_sessions ───────────────────────────────────────────────────────────
create table focus_sessions (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references tasks(id) on delete cascade,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  duration_minutes   integer,
  estimate_accurate  boolean,   -- post-task reflection tap
  blocker_note       text
);

create index focus_sessions_task_id_idx on focus_sessions(task_id);

-- ── estimation_profiles ───────────────────────────────────────────────────────
-- One profile per project; tracks how much you over/underestimate in that area.
create table estimation_profiles (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null unique references projects(id) on delete cascade,
  sample_count integer not null default 0,
  bias_ratio   real not null default 1.0,   -- actual ÷ estimated (1.4 = 40% under)
  updated_at   timestamptz not null default now()
);

-- ── energy_logs ───────────────────────────────────────────────────────────────
create table energy_logs (
  id         uuid primary key default gen_random_uuid(),
  logged_at  timestamptz not null default now(),
  level      smallint not null check (level between 1 and 5),
  task_id    uuid references tasks(id) on delete set null
);

create index energy_logs_logged_at_idx on energy_logs(logged_at desc);

-- ── energy_patterns ───────────────────────────────────────────────────────────
-- Precomputed nightly by pg_cron; one row per (hour, day_of_week) pair.
create table energy_patterns (
  hour_of_day  smallint not null check (hour_of_day between 0 and 23),
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  avg_level    real not null,
  sample_count integer not null default 0,
  computed_at  timestamptz not null default now(),
  primary key (hour_of_day, day_of_week)
);

-- ── habit_streaks ─────────────────────────────────────────────────────────────
create table habit_streaks (
  task_id         uuid primary key references tasks(id) on delete cascade,
  current_streak  integer not null default 0,
  longest_streak  integer not null default 0,
  last_completed  date
);

-- ── calendar_events ───────────────────────────────────────────────────────────
create type calendar_source as enum ('google_calendar', 'gmail_parsed');

create table calendar_events (
  id         uuid primary key default gen_random_uuid(),
  gcal_id    text unique,           -- Google's event ID (null for gmail_parsed)
  title      text not null,
  start_time timestamptz not null,
  end_time   timestamptz not null,
  all_day    boolean not null default false,
  source     calendar_source not null
);

create index calendar_events_start_idx on calendar_events(start_time);

-- ── weekly_reviews ────────────────────────────────────────────────────────────
create table weekly_reviews (
  id               uuid primary key default gen_random_uuid(),
  week_start       date not null unique,    -- always the Monday
  completed_at     timestamptz not null default now(),
  completed_count  integer not null default 0,
  postponed_count  integer not null default 0,
  notes            text
);

-- ── user_integrations ─────────────────────────────────────────────────────────
-- Stores Google OAuth tokens server-side — never exposed to the client.
create table user_integrations (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,           -- 'google'
  access_token    text not null,
  refresh_token   text not null,           -- store encrypted in app layer
  token_expiry    timestamptz not null,
  scopes          text[] not null,
  connected_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Urgency recompute function (called by pg_cron nightly)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function recompute_urgency_scores()
returns void language plpgsql as $$
declare
  t tasks%rowtype;
  elapsed_ratio real;
  priority_pts  real;
  pressure      real;
  new_score     real;
begin
  for t in select * from tasks where status in ('inbox', 'active') loop
    priority_pts := t.priority * 10;  -- 10 | 20 | 30 | 40

    if t.due_date is null then
      new_score := least(priority_pts, 100);
    else
      elapsed_ratio := least(
        extract(epoch from (now() - t.created_at)) /
        nullif(extract(epoch from (t.due_date - t.created_at)), 0),
        1.0
      );

      pressure := case t.urgency_curve
        when 'linear'      then elapsed_ratio * 60
        when 'exponential' then 60.0 / (1 + exp(-10 * (elapsed_ratio - 0.8)))
        when 'step'        then case
                                  when elapsed_ratio > 0.85 then 60
                                  when elapsed_ratio > 0.60 then 25
                                  else 5
                                end
      end;

      new_score := least(priority_pts + pressure, 100);
    end if;

    update tasks set urgency_score = new_score where id = t.id;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Energy pattern rollup function (called by pg_cron nightly)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function recompute_energy_patterns()
returns void language plpgsql as $$
begin
  insert into energy_patterns (hour_of_day, day_of_week, avg_level, sample_count, computed_at)
  select
    extract(hour from logged_at)::smallint        as hour_of_day,
    extract(dow  from logged_at)::smallint        as day_of_week,
    avg(level)::real                              as avg_level,
    count(*)::integer                             as sample_count,
    now()                                         as computed_at
  from energy_logs
  where logged_at > now() - interval '90 days'   -- rolling 90-day window
  group by hour_of_day, day_of_week
  on conflict (hour_of_day, day_of_week) do update
    set avg_level    = excluded.avg_level,
        sample_count = excluded.sample_count,
        computed_at  = excluded.computed_at;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- Enable on every table; only authenticated user can read/write their own data.
-- (Single-user app for now — RLS is trivially permissive for the owner.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table projects            enable row level security;
alter table tasks               enable row level security;
alter table focus_sessions      enable row level security;
alter table estimation_profiles enable row level security;
alter table energy_logs         enable row level security;
alter table energy_patterns     enable row level security;
alter table habit_streaks       enable row level security;
alter table calendar_events     enable row level security;
alter table weekly_reviews      enable row level security;
alter table user_integrations   enable row level security;

-- Simple single-user policy: authenticated users can do everything
create policy "authenticated full access" on projects            for all to authenticated using (true);
create policy "authenticated full access" on tasks               for all to authenticated using (true);
create policy "authenticated full access" on focus_sessions      for all to authenticated using (true);
create policy "authenticated full access" on estimation_profiles for all to authenticated using (true);
create policy "authenticated full access" on energy_logs         for all to authenticated using (true);
create policy "authenticated full access" on energy_patterns     for all to authenticated using (true);
create policy "authenticated full access" on habit_streaks       for all to authenticated using (true);
create policy "authenticated full access" on calendar_events     for all to authenticated using (true);
create policy "authenticated full access" on weekly_reviews      for all to authenticated using (true);
create policy "authenticated full access" on user_integrations   for all to authenticated using (true);
