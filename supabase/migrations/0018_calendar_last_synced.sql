-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — when the calendar was last pulled from Google
--
-- Home renders from `calendar_events` and never calls Google on load: the
-- freeBusy round trip is the wait that made "Schedule my week" unpleasant, and
-- it does not belong on the landing path (docs/HOME.md, "Data and speed").
--
-- The cost of that choice is staleness — an event added in Google and not yet
-- synced is invisible — and the agreed mitigation is to say so rather than to
-- block the page. Saying so needs a timestamp, and nothing recorded one: the
-- rows themselves carry no sync time, so "synced 2h ago" was unmeasurable.
--
-- Nullable on purpose. NULL means "never synced through this column", which is
-- true for every existing row, and is not the same claim as "synced at the
-- epoch". Home prints nothing rather than a number it cannot stand behind.
-- ─────────────────────────────────────────────────────────────────────────────

alter table user_integrations
  add column if not exists last_synced_at timestamptz;

comment on column user_integrations.last_synced_at is
  'Last successful calendar pull. NULL = never synced since this column existed.';
