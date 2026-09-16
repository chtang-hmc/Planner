-- "Not before" — the earliest a task may be scheduled.
--
-- The deadline says when work must be finished; this says when it may begin.
-- Grading next week's homework can't start before the homework is submitted, no
-- matter how much free time there is today. Without it the scheduler treats any
-- pending task as available now and pulls recurring chores weeks forward.
--
-- NULL means available immediately, which is how most tasks behave.
alter table tasks
  add column if not exists start_date timestamptz;

create index if not exists tasks_start_date_idx
  on tasks (start_date)
  where start_date is not null;
