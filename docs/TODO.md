# TODO

Known work, in rough priority order. Every item here was either observed in the
running app or deliberately deferred with a reason — this is not a wishlist.

When you finish something, delete it. When you defer something, say why here
rather than leaving it implied. Decisions that are settled belong in
[`DECISIONS.md`](./DECISIONS.md), not in this file.

---

## Setup that was never finished

### The nightly `pg_cron` jobs have never run

`energy_patterns` contains **0 rows**, so the "Energy by time of day" heatmap on
Analytics is blank — it is not broken, it has simply never been fed. The jobs are
created by hand in the Supabase dashboard and evidently never were:

```sql
select cron.schedule('recompute-urgency', '0 2 * * *', 'select recompute_urgency_scores()');
select cron.schedule('recompute-energy',  '0 3 * * *', 'select recompute_energy_patterns()');
```

Check whether the urgency job is running too (`select * from cron.job`). Urgency
is also recomputed inline by `updateTask`, so a missing nightly job is survivable
— but it is the safety net for drift, and the nightly recompute is the reason the
PL/pgSQL formula has to stay in step with `computeUrgency()`.

Related: `energy_logs` holds 2 rows and `focus_sessions` 6, so most of Analytics
is thin regardless. Worth knowing before concluding a chart is broken.

---

## Correctness

### One habit completion per day is guarded, not enforced

The rule is defended in three places — `completeTask`, `logHabitSession`, and the
sweep's pre-filter — each a read followed by a write with nothing between them.
Two reachable races were closed (a single-flight lock on the sweep, and the UI
disabling `+` once a day is recorded), but simultaneous writes could still slip
through. The real fix is a uniqueness constraint in the database, which needs a
migration: the "day" is local, so it cannot be a plain `unique(title, date(completed_at))`.

A duplicate is mostly invisible — the heatmap and weekly targets count distinct
days — but it doubles that day's `actual_minutes`, so any future "time spent"
chart would quietly read wrong.

### Two leftover UTC-slice bugs

Same shape as the bug fixed three times already: a local `Date` read back through
`toISOString().slice(0,10)`.

- `src/app/(app)/tasks/UpcomingView.tsx:27`
- `src/app/(app)/analytics/AnalyticsView.tsx:316`

Currently harmless in Los Angeles — local midnight west of UTC lands on the same
UTC date — and wrong east of it. `src/lib/day.ts` already has the helpers.

---

## Never exercised

### The calendar-writing paths

Neither has been run end to end by anyone but the user:

- logging a habit session with **add to calendar** (`logHabitSession` → `createTaskBlock`)
- the habit sweep filling in blocks from finished days (`syncScheduledHabits`)

Both write to a real Google Calendar, which is why they are worth a deliberate
manual run rather than trusting a type-check.

### The CI migration warning

`.github/workflows/ci.yml` warns when a PR adds a migration. The "no migrations"
path is confirmed; the warning itself has never fired, because no PR since CI
landed has touched `supabase/migrations/`. Watch it on the next one.

---

## Consistency

### Emoji still in about ten files

The task list, habits section, calendar panel and analytics dropped emoji as data
encoding; the rest of the app did not. The most visible is the **energy logger in
the sidebar** (😴 😔 😐 😊 ⚡), which sits directly beside the redesigned chrome.
Also present in the review flow, projects views, and several modals.

`grep -rln "😴\|😔\|😐\|😊\|🌿\|🔥\|📅\|🎯\|🌱" src --include="*.tsx"`

### 30 lint warnings

Zero errors; the warnings are mostly `react-hooks/set-state-in-effect` on the
mounted-guard pattern used for reading `localStorage`. Deliberately warn rather
than error — see the CI section of `DECISIONS.md`. Worth revisiting if
`useSyncExternalStore` turns out to fit more of them than expected.

---

## Not built

### A Home / Today page

`/` redirects straight to `/tasks` and there is no Home in the sidebar. The idea
was a landing view answering "what now" — today's tasks, habits still to do, the
next calendar block, streaks — drawing on tasks, habits and calendar rather than
being another list. Deferred once in favour of finishing the tasks page, which is
now done.

---

## Standing costs to keep in view

### Four row layouts means four implementations

Every feature touching a task row has to be built four times. `TaskRowProps` makes
the compiler point at whichever layout has not handled a new field, and anything a
layout skips is declared in its `omits` list — but the work is still 4×. Accepted
deliberately; revisit if adding a row feature starts feeling expensive.

### Tests stop at the database

`npm test` covers the scheduler, urgency and the date helpers — all pure. Nothing
touching Supabase or Google Calendar is tested, because faking two external
services costs more than it currently returns. That is why the manual passes above
matter.
