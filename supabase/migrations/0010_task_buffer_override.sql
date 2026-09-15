-- Per-task transition buffer.
--
-- The global buffer (user_scheduling_config.buffer_minutes, default 15) is the
-- right default for work that needs settling-in time, but it makes small chores
-- absurdly expensive: taking out the trash is 5 minutes of work that would need
-- 35 minutes of clear space to be scheduled.
--
-- NULL = use the global default. 0 = no buffer, slot it into any gap.
alter table tasks
  add column if not exists buffer_minutes integer
    check (buffer_minutes is null or buffer_minutes >= 0);
