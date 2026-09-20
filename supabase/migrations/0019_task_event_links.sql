-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 — which task a calendar event is already doing
--
-- A task and the event someone booked for it are the same hour counted twice.
-- On this calendar, the task "Prep for Big E&M Grutoring" (1h) and the event
-- "Big E&M Grutoring Prep" (12–1pm) are one piece of work, and every capacity
-- number that adds them both is an hour too pessimistic.
--
-- The fix needs a fact the app cannot derive: *are these the same thing?* Title
-- similarity produces a good guess and no more, so this table records the
-- answer a person gave.
--
-- ── Decisions, not suggestions ───────────────────────────────────────────────
--
-- Only `confirmed` and `rejected` are stored. Suggestions are recomputed on
-- every render from the matcher, minus whatever is already decided here — so
-- there is no queue of stale guesses to expire, and a re-sync or a retitled
-- task simply produces a different suggestion next time.
--
-- `rejected` is the load-bearing half. Without a record of "no", the same wrong
-- pair is offered every single day, and a prompt that cannot be dismissed
-- permanently is one people learn to ignore.
--
-- ── A join table, not a column ───────────────────────────────────────────────
--
-- A `tasks.covered_by_event_id` column would be smaller and would cover the
-- common case. It cannot express a task spread across two sittings, which is a
-- real shape here — an hour of prep booked as two half-hours is the same work
-- and both events cover it.
--
-- ── Ids survive a sync ───────────────────────────────────────────────────────
--
-- `calendar_events` is upserted on `gcal_id`, so a row keeps its `id` across
-- syncs and a link outlives the nightly pull. An event deleted in Google
-- cascades the link away with it, which is correct: there is nothing left to
-- be covered by.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists task_event_links (
  task_id      uuid        not null references tasks(id)           on delete cascade,
  event_id     uuid        not null references calendar_events(id) on delete cascade,
  status       text        not null check (status in ('confirmed', 'rejected')),
  -- How the pair was put in front of someone, so a bad matcher can be told
  -- apart from bad judgement later.
  source       text        not null default 'title',
  decided_at   timestamptz not null default now(),

  primary key (task_id, event_id)
);

comment on table task_event_links is
  'A person''s answer to "is this event already doing this task?". Only decisions are stored; suggestions are recomputed.';

-- The read that matters is "which of today's tasks are already covered", so
-- the primary key's leading column serves it. This one serves the reverse —
-- drawing an event's chip on the timeline.
create index if not exists task_event_links_event on task_event_links (event_id);

alter table task_event_links enable row level security;
create policy "authenticated full access" on task_event_links for all to authenticated using (true);
