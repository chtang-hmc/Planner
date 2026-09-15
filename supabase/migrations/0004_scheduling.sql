-- ── Working hours (one row per day 0=Sun..6=Sat) ─────────────────────────────
create table if not exists user_working_hours (
  day_of_week   int  not null,
  start_hour    int  not null default 9,
  start_minute  int  not null default 0,
  end_hour      int  not null default 18,
  end_minute    int  not null default 0,
  enabled       bool not null default true,
  primary key (day_of_week)
);

-- Default: Mon–Fri 9–18, weekends off
insert into user_working_hours (day_of_week, start_hour, start_minute, end_hour, end_minute, enabled)
values
  (0, 9, 0, 18, 0, false),  -- Sunday
  (1, 9, 0, 18, 0, true),   -- Monday
  (2, 9, 0, 18, 0, true),   -- Tuesday
  (3, 9, 0, 18, 0, true),   -- Wednesday
  (4, 9, 0, 18, 0, true),   -- Thursday
  (5, 9, 0, 18, 0, true),   -- Friday
  (6, 9, 0, 18, 0, false)   -- Saturday
on conflict (day_of_week) do nothing;

-- ── Energy per day × time block ───────────────────────────────────────────────
-- time_block values: 'past_midnight' | 'early_morning' | 'morning' | 'post_lunch'
--                    | 'afternoon' | 'post_dinner' | 'evening' | 'late_night'
create table if not exists user_energy_schedule (
  day_of_week  int  not null,
  time_block   text not null,
  energy_level text not null default 'medium',   -- 'low' | 'medium' | 'high'
  primary key (day_of_week, time_block)
);

-- ── Scheduling config (singleton row) ─────────────────────────────────────────
create table if not exists user_scheduling_config (
  id                  serial primary key,
  max_session_minutes int  not null default 90,
  buffer_minutes      int  not null default 15
);

insert into user_scheduling_config (max_session_minutes, buffer_minutes)
  select 90, 15 where not exists (select 1 from user_scheduling_config);

-- ── scheduled_by on tasks ─────────────────────────────────────────────────────
-- 'manual' = user explicitly placed this block (locked, algorithm skips)
-- 'auto'   = placed by the scheduling algorithm (can be cleared on re-run)
-- null     = not scheduled at all
alter table tasks add column if not exists scheduled_by text;
