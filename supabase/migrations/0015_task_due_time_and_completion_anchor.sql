-- Two columns for things quick-add could already read but had nowhere to keep.

-- ── A time of day on a task ──────────────────────────────────────────────────
--
-- Minutes from local midnight (0–1439), NOT an instant.
--
-- `due_date` is a timestamptz but the whole app treats it as UTC midnight of
-- the user's local day — every comparison does `due_date.slice(0, 10)`. Folding
-- an hour into it would make a task due at 5pm in Los Angeles read as the
-- following day, which is the bug class this codebase has already fixed three
-- times elsewhere.
--
-- So the hour lives beside the day rather than inside it. A wall-clock time is
-- timezone-independent by nature: "due at 5pm" means 5pm wherever you are, and
-- storing minutes-past-midnight keeps it that way through a move or a DST
-- change. NULL means all-day, which is what every existing row is.
alter table tasks
  add column if not exists due_time_minutes smallint;

do $$
begin
  alter table tasks
    add constraint tasks_due_time_minutes_range
    check (due_time_minutes is null or (due_time_minutes >= 0 and due_time_minutes <= 1439));
exception
  when duplicate_object then null;
end $$;

-- ── Recurrence anchored on completion ────────────────────────────────────────
--
-- Todoist's `every! 3 days`: count the next occurrence from when the task was
-- *finished*, not from when it was due. Watering the plants every three days
-- means three days after you last watered them — a fortnight away should not
-- come back to four missed waterings.
--
-- This cannot live in the rrule string: iCal has no way to express it. It is a
-- property of how this app advances a chain, not of the rule itself.
--
-- The default is the existing behaviour. `completeTask` anchors on the task's
-- own `due_date` deliberately — that is what makes finishing a weekly review
-- early produce the following week rather than re-spawning the same occurrence
-- — and every row that exists today was created under that rule.
alter table tasks
  add column if not exists rrule_from_completion boolean not null default false;

create index if not exists tasks_due_time_idx
  on tasks (due_time_minutes)
  where due_time_minutes is not null;
