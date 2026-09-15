-- Tasks that tie you up for longer than they take.
--
-- Washing sheets is ~10 minutes of attention across a 2-hour cycle. The
-- scheduled block stays the attention (estimated_minutes); span_minutes pins
-- your location for the whole cycle so other work can be scheduled inside it —
-- but only work that can happen in the same place.
alter table tasks
  add column if not exists span_minutes integer
    check (span_minutes is null or span_minutes > 0);

-- Where the task happens. 'anywhere' (the default) is compatible with everything;
-- 'away' work can't be scheduled while an 'home' task has you tethered, and
-- vice versa. Mark gym/running as 'away'.
alter table tasks
  add column if not exists location text not null default 'anywhere'
    check (location in ('home', 'away', 'anywhere'));
