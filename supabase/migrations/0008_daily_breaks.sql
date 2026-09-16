-- Recurring daily breaks (meals). Unlike a calendar event these are a window
-- plus a duration — the scheduler picks the actual time each day and keeps
-- other work out of it. They are planner-only: nothing is written to Google
-- Calendar.
create table if not exists user_daily_breaks (
  id               serial primary key,
  label            text    not null,
  duration_minutes int     not null default 60 check (duration_minutes > 0),
  -- Window the break must fall inside (local time)
  start_hour       int     not null check (start_hour   between 0 and 23),
  start_minute     int     not null default 0 check (start_minute between 0 and 59),
  end_hour         int     not null check (end_hour     between 0 and 23),
  end_minute       int     not null default 0 check (end_minute   between 0 and 59),
  -- Minutes after the break during which avoid_after_breaks tasks are blocked
  cooldown_minutes int     not null default 0 check (cooldown_minutes >= 0),
  enabled          boolean not null default true
);

-- Lunch: 1 hour somewhere between 11:00 and 13:15, no strenuous work for an
-- hour afterwards. Dinner: 1 hour between 17:00 and 19:30, same cooldown.
insert into user_daily_breaks
  (label, duration_minutes, start_hour, start_minute, end_hour, end_minute, cooldown_minutes)
select 'Lunch', 60, 11, 0, 13, 15, 60
where not exists (select 1 from user_daily_breaks where label = 'Lunch');

insert into user_daily_breaks
  (label, duration_minutes, start_hour, start_minute, end_hour, end_minute, cooldown_minutes)
select 'Dinner', 60, 17, 0, 19, 30, 60
where not exists (select 1 from user_daily_breaks where label = 'Dinner');

-- Habits that shouldn't run straight after eating (gym, running).
alter table tasks
  add column if not exists avoid_after_breaks boolean not null default false;
