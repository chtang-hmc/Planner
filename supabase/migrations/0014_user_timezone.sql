-- The user's timezone, as an IANA name ("America/Los_Angeles").
--
-- Habits are counted by calendar day — the heatmap, the streak, the weekly
-- target, "already logged today". Those days used to be UTC day edges, which
-- is right only on the prime meridian: west of it an evening session counted
-- toward tomorrow, so a 7pm gym session lit the next square and moved the
-- streak a day.
--
-- Server actions and server components both need it (the habits page computes
-- the heatmap server-side), so it can't live in the browser alone. Seeded
-- automatically from the browser and editable in Settings.
--
-- NULL means "not reported yet" and falls back to UTC, which is the behaviour
-- everything had before this column existed.
alter table user_scheduling_config
  add column if not exists timezone text;
