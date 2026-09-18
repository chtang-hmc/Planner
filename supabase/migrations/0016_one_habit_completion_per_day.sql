-- Enforce, in the database, what three code paths have been politely agreeing on:
-- a habit records at most one completion per day.
--
-- `completeTask`, `logHabitSession` and the calendar sweep each guard this with
-- a read followed by a write and nothing in between. Two reachable races were
-- closed by hand (a single-flight lock on the sweep; the UI disabling `+` once a
-- day is recorded), but simultaneous writers can still slip through, and only
-- the database can actually make that impossible.
--
-- A duplicate is nearly invisible — the heatmap and the weekly target both count
-- distinct days — but it doubles that day's `actual_minutes`, so any "time spent"
-- figure reads high. That is how Piano once showed 120 minutes for a 60-minute
-- sitting.

-- ── Why a column and not an expression index ─────────────────────────────────
--
-- The day is the *user's* day, so the natural index would be on
-- `(completed_at AT TIME ZONE <their zone>)::date`. Postgres will not allow it:
-- `timezone(text, timestamptz)` is STABLE, not IMMUTABLE, because its answer
-- depends on the tz database — and index expressions must be IMMUTABLE.
--
-- So the local day is stored explicitly, and maintained by the trigger below
-- rather than by any of the three code paths that close a habit. Storing it also
-- makes "which day was this" a plain column read everywhere else.
alter table tasks
  add column if not exists completed_day date;

comment on column tasks.completed_day is
  'The user''s local calendar day a task was completed on. Set alongside completed_at by every path that closes a habit; the uniqueness of one habit completion per day is enforced on it.';

-- ── The column maintains itself ──────────────────────────────────────────────
--
-- A trigger rather than application code, for two reasons.
--
-- Three separate paths close a habit (`completeTask`, `setHabitCompletion`,
-- `logHabitSession`) and a fourth could be added tomorrow. A column every
-- writer must remember to set is a column that will eventually be forgotten,
-- and the forgetting is silent: the index simply stops covering that writer.
--
-- It also keeps the application working on a database where this migration has
-- not been applied. Nothing in the app names `completed_day` at all, so there is
-- no window in which habit logging is broken waiting for the DDL to run.
--
-- STABLE is fine inside a trigger; the IMMUTABLE requirement is on index
-- expressions only, which is the whole reason the value has to be stored.
create or replace function set_completed_day() returns trigger
language plpgsql as $$
begin
  if new.completed_at is null then
    new.completed_day := null;
  else
    new.completed_day := (
      new.completed_at at time zone
      coalesce((select nullif(timezone, '') from user_scheduling_config limit 1), 'UTC')
    )::date;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completed_day on tasks;
create trigger tasks_set_completed_day
  before insert or update of completed_at on tasks
  for each row execute function set_completed_day();

-- ── Backfill ─────────────────────────────────────────────────────────────────
--
-- STABLE is fine here: the restriction is on index expressions, not on DML.
-- Falls back to UTC, which is what day handling did before 0014.
update tasks t
   set completed_day = (
         t.completed_at at time zone
         coalesce((select nullif(timezone, '') from user_scheduling_config limit 1), 'UTC')
       )::date
 where t.completed_at is not null
   and t.completed_day is null;

-- ── The constraint ───────────────────────────────────────────────────────────
--
-- Partial, on done habits only: cancelled rows are the tombstones un-logging and
-- the duplicate guard leave behind, and there can be any number of those for a
-- day. Pending occurrences have no completed_day at all.
--
-- If this fails with a uniqueness violation, the table already holds duplicates
-- — find them before re-running rather than weakening the index:
--
--   select title, completed_day, count(*), array_agg(id)
--     from tasks where type = 'habit' and status = 'done' and completed_day is not null
--    group by 1, 2 having count(*) > 1;
create unique index if not exists tasks_one_habit_completion_per_day
  on tasks (title, completed_day)
  where type = 'habit' and status = 'done' and completed_day is not null;
