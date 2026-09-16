-- Fixed wait between one subtask and the next.
--
-- Washing sheets isn't one block and isn't five back-to-back blocks — it's
-- 5 min loading, an hour of machine time, 5 min moving to the dryer, another
-- hour, then 15 min making the bed. The waits are unavoidable and fixed, and
-- you're free during them (though see tasks.span_minutes / location for staying
-- put).
--
-- NULL or 0 means the next subtask follows immediately, which is how reading
-- chains behave.
alter table tasks
  add column if not exists gap_after_minutes integer
    check (gap_after_minutes is null or gap_after_minutes >= 0);
