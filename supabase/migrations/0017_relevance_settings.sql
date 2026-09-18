-- The two numbers behind the "Relevant" toggle on the task list.
--
-- They were constants in TaskList.tsx: a seven-day window and priority 3. Both
-- are judgement calls about how much of the future counts as now, and the right
-- answer differs by how the person works — a week is a long horizon for errands
-- and a short one for coursework.
--
-- The two are independent grounds, not a single test: a task is relevant if it
-- falls inside the window OR clears the priority bar. Either alone is enough,
-- and each rescues what the other would drop — a Low errand due tomorrow, a
-- Critical piece of work due in three months.
--
-- NULL means "not set" and falls back to the constants, so the filter behaves
-- exactly as before until someone changes it.

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
  'Days ahead a deadline still counts as relevant. One of two independent grounds — see relevant_min_priority. NULL = 7.';
comment on column user_scheduling_config.relevant_min_priority is
  'Priority that makes a task relevant on its own, whatever its deadline says. Independent of relevant_window_days: either alone qualifies. NULL = 3 (High).';
