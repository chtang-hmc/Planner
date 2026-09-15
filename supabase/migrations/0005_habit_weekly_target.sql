-- Add weekly frequency target to habits.
-- weekly_target: how many times per week the user intends to do this habit.
-- NULL = no target set (streak-only tracking).
alter table tasks
  add column weekly_target integer check (weekly_target is null or weekly_target >= 1);

-- Track how many times the habit was completed in the current calendar week
-- (Monday-based) so we can show "3 of 4 this week" progress.
alter table habit_streaks
  add column completions_this_week integer not null default 0,
  add column week_start            date;
