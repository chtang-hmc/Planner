-- Habits sharing an exclusive group are never scheduled on the same day —
-- e.g. Gym and Run both set to 'Exercise'.
--
-- NULL (the default) means the habit only conflicts with itself, which is the
-- existing behaviour: its own weekly sessions still land on separate days.
-- Until this is applied the app falls back to that per-habit grouping; only
-- assigning a group requires the column.
alter table tasks
  add column if not exists exclusive_group text;

create index if not exists tasks_exclusive_group_idx
  on tasks (exclusive_group)
  where exclusive_group is not null;
