-- Preferred first day of the week, used for habit weekly targets.
-- 0 = Sunday, 1 = Monday, 6 = Saturday (matches Date#getUTCDay()).
-- Until this is applied the app falls back to Monday; only saving the
-- preference in Settings requires the column.
alter table user_scheduling_config
  add column if not exists week_start_day smallint not null default 1
  check (week_start_day in (0, 1, 6));
