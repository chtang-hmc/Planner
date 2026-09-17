-- The two numbers behind the "Relevant" toggle on the task list.
--
-- They were constants in TaskList.tsx: a seven-day window, and priority 3 as
-- the line an *undated* task has to clear. Both are judgement calls about how
-- much of the future counts as now, and the right answer differs by how the
-- person works — a week is a long horizon for errands and a short one for
-- coursework.
--
-- NULL means "not set" and falls back to the previous constants, so the filter
-- behaves exactly as before until someone changes it.

alter table user_scheduling_config
  add column if not exists relevant_window_days smallint,
  add column if not exists relevant_min_priority smallint;

do $$
begin
  alter table user_scheduling_config
    add constraint user_scheduling_config_relevant_window_range
    check (relevant_window_days is null
           or (relevant_window_days >= 0 and relevant_window_days <= 90));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table user_scheduling_config
    add constraint user_scheduling_config_relevant_priority_range
    check (relevant_min_priority is null
           or (relevant_min_priority >= 1 and relevant_min_priority <= 4));
exception
  when duplicate_object then null;
end $$;

comment on column user_scheduling_config.relevant_window_days is
  'Days ahead a deadline still counts as relevant. NULL = 7.';
comment on column user_scheduling_config.relevant_min_priority is
  'Lowest priority an undated task can have and still count as relevant. NULL = 3 (High).';
