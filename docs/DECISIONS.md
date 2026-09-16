# Architecture & Design Decisions

> **Keep this file current.** When you add a feature, change a library, or make a call that a future reader might second-guess, add or update the relevant section. Small edits beat big catch-up sessions.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Data Layer](#data-layer)
3. [Auth](#auth)
4. [Urgency Scoring](#urgency-scoring)
5. [Focus Timer](#focus-timer)
6. [Google Calendar Sync & Write Access](#google-calendar-sync--write-access)
7. [Recurring Tasks & Habits](#recurring-tasks--habits)
8. [Habits Page](#habits-page)
9. [Subtasks / Checklists](#subtasks--checklists)
10. [Task List Views](#task-list-views)
11. [Inline Search](#inline-search)
12. [Drag-to-Reschedule](#drag-to-reschedule)
13. [Priority-Colored Circles](#priority-colored-circles)
14. [Projects](#projects)
15. [Color Themes](#color-themes)
16. [Week Start](#week-start)
17. [Server / Client Component Split](#server--client-component-split)

---

## Tech Stack

| Layer | Choice | Versions | Why |
|---|---|---|---|
| Framework | Next.js | 16.3.5 | App Router, Server Components, Server Actions, Route Handlers — removes most API boilerplate |
| UI | React | 19.2.8 | Concurrent features; pairs with Next.js 16 |
| Styling | Tailwind CSS | 4.x | Utility-first; v4 uses PostCSS plugin, no config file needed |
| Language | TypeScript | 5.x strict | Strict mode on; `noEmit` type-check in CI |
| Database | Supabase (PostgreSQL) | latest | Hosted Postgres, built-in Auth, RLS, `pg_cron` extension |
| DB client | `@supabase/supabase-js` + `@supabase/ssr` | 2.116 / 0.12 | `@supabase/ssr` provides session-aware clients for RSC + Route Handlers |
| Auth | Supabase Auth — Google OAuth | — | No magic links; Google OAuth is the only provider (see [Auth](#auth)) |
| Google APIs | Raw `fetch` against Google REST API | — | No `googleapis` SDK — avoids a large dependency; token exchange + Calendar API calls are straightforward with raw fetch |
| AI | `@anthropic-ai/sdk` | 0.125 | Claude API for natural-language task parsing (quick-add) |
| Recurrence | `rrule` | 2.8.1 | iCal RRULE parsing and next-occurrence computation |
| Scheduled jobs | `pg_cron` (Supabase extension) | — | Nightly urgency recompute + energy pattern rollup |

### Next.js 16 specifics

- **`proxy.ts` not `middleware.ts`** — Next.js 16 renamed the edge middleware file. The export is `async function proxy(request)` (not `middleware`). Codemod: `npx @next/codemod@canary middleware-to-proxy`.
- **Server Actions** are used for all mutations (`src/app/actions/`). No separate REST API for internal calls.
- **Route Handlers** (`src/app/api/`) exist only for OAuth callbacks and the calendar sync endpoint (kept so the URL is bookmarkable / externally triggerable).
- `export const dynamic = 'force-dynamic'` on pages that read auth-sensitive data.

---

## Data Layer

### Two Supabase clients

| Client | Created by | Uses | When |
|---|---|---|---|
| `createClient()` | `src/lib/supabase/server.ts` | anon key + cookie store | Server Components, Route Handlers — **session-aware**, respects RLS |
| `createServiceClient()` | same file | service-role key | Server Actions, internal queries — **bypasses RLS**, never import in client components |

Server Actions use `createServiceClient()` because they run in trusted server context and don't carry a user session cookie by default.

### Row Level Security

RLS is enabled on every table. The current policy is trivially permissive for authenticated users (`using (true)`) because this is a single-user app — data isolation is enforced at the **application layer** instead:

- `ALLOWED_EMAIL` env var in `.env.local` (and production env) contains the owner's email.
- `src/proxy.ts` checks `user.email !== process.env.ALLOWED_EMAIL` on every request and redirects to `/403` if someone else logs in.
- The `/403` page signs the intruder out and shows an access-denied message.

If multi-user support is ever needed, the right path is: add `user_id uuid references auth.users(id)` to every table, change RLS policies to `using (auth.uid() = user_id)`, and update all service-role queries to insert the user id. The `ALLOWED_EMAIL` gate can then be removed.

### Schema overview

```
projects          — colour-coded workspaces
tasks             — core entity; urgency_score, rrule, parent_id, gcal_event_id, scheduled_start/end
focus_sessions    — per-timer-run log; estimate_accurate + blocker_note from reflection
estimation_profiles — per-project bias_ratio (actual ÷ estimated, running average)
energy_logs       — manual 1–5 energy check-ins
energy_patterns   — nightly rollup of energy_logs by (hour, day_of_week)
habit_streaks     — current/longest streak for recurring tasks
calendar_events   — synced from Google Calendar; gcal_id unique key for upserts
weekly_reviews    — one row per Monday; completed/postponed counts + notes
user_integrations — server-side OAuth tokens (Google Calendar); never sent to client
```

#### Scheduling columns on `tasks`

```sql
ALTER TABLE tasks
  ADD COLUMN gcal_event_id   TEXT,         -- Google Calendar event id for the focus block
  ADD COLUMN scheduled_start TIMESTAMPTZ,  -- start of the blocked focus window
  ADD COLUMN scheduled_end   TIMESTAMPTZ;  -- end of the blocked focus window
```

These are null until the user explicitly blocks time from TaskDetail. `gcal_event_id` is the stable GCal event id; if the user moves or deletes the block from Google Calendar directly, the DB fields become stale (no webhook sync yet — planned).

### Migrations

- `0001_initial_schema.sql` — full schema + `recompute_urgency_scores()` + `recompute_energy_patterns()` PL/pgSQL functions + RLS policies
- `0002_nullable_project_id.sql` — made `tasks.project_id` nullable so tasks can live in an "Inbox" (no project assigned)
- `0003_scheduling_columns.sql` — added `gcal_event_id`, `scheduled_start`, `scheduled_end` to `tasks`
- `0004_scheduling.sql` — `user_working_hours`, `user_energy_schedule`, `user_scheduling_config`; `scheduled_by` on `tasks`
- `0005_habit_weekly_target.sql` — `tasks.weekly_target`; `completions_this_week` + `week_start` on `habit_streaks`
- `0006_week_start_day.sql` — `user_scheduling_config.week_start_day` (0 = Sun, 1 = Mon, 6 = Sat)
- `0007_habit_exclusive_group.sql` — `tasks.exclusive_group`; habits sharing a group are never scheduled on the same day
- `0008_daily_breaks.sql` — `user_daily_breaks` (meal windows + cooldown), seeded with Lunch and Dinner; `tasks.avoid_after_breaks`
- `0009_task_location_and_span.sql` — `tasks.span_minutes` + `tasks.location`; tethering work (laundry) and where a task happens
- `0010_task_buffer_override.sql` — `tasks.buffer_minutes`; per-task transition padding (null = global default, 0 = none)
- `0011_urgency_from_time_remaining.sql` — rewrites `recompute_urgency_scores()` to match the new urgency formula. **Must be applied** — the old function overwrites correct scores nightly.
- `0012_subtask_wait_after.sql` — `tasks.gap_after_minutes`; fixed waits between subtasks (laundry cycles, proving, drying)
- `0013_task_start_date.sql` — `tasks.start_date`; earliest a task may be scheduled ("not before")
- `0014_user_timezone.sql` — `user_scheduling_config.timezone`; habit days are the user's calendar days, and the server needs to know which zone that is

**Convention:** one migration file per logical change; never edit a deployed migration — add a new one.

### pg_cron jobs (set up manually in Supabase dashboard)

```sql
-- Nightly at 2 AM UTC
select cron.schedule('recompute-urgency',  '0 2 * * *', 'select recompute_urgency_scores()');
select cron.schedule('recompute-energy',   '0 3 * * *', 'select recompute_energy_patterns()');
```

Urgency is also recomputed immediately in `updateTask()` when a urgency-affecting field changes (`priority`, `due_date`, `urgency_curve`). The nightly job is a safety net for drift.

---

## Auth

**Provider: Google OAuth only** (no magic links, no email/password).

- **Why Google-only?** The app already needs a Google OAuth client for Calendar sync. Re-using the same provider avoids a second consent screen. Magic links require an email provider; not worth the complexity for a single-user tool.
- Supabase Auth handles the token lifecycle. The OAuth callback at `/auth/callback` exchanges the code for a session using `createClient()` (the session-aware helper — never the service-role client here, since the purpose is to set the user cookie).
- The Google OAuth credentials for **Calendar** are separate env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) from the Supabase dashboard credentials. They can be the same Google Cloud project.

### Login flow

```
/login  →  signInWithGoogle() server action
        →  Supabase redirects to Google
        →  Google redirects to /auth/callback?code=…
        →  exchangeCodeForSession(code)
        →  redirect /tasks
```

### Protected routes

`src/proxy.ts` (Next.js 16 edge middleware) intercepts every request:
- Refreshes the session cookie on every request (required by `@supabase/ssr`).
- Redirects `/` → `/tasks`.
- Redirects unauthenticated users to `/login`.
- Redirects authenticated users away from `/login`.

---

## Urgency Scoring

### Formula

```
urgency = priority points (10–40) + time pressure (0–60), capped at 100
```

Time pressure is a function of **time remaining**, ramping over a fixed 14-day lead-in:

```
ramp    = clamp(1 − daysLeft / 14, 0, 1)     0 = a fortnight out, 1 = due now
onTime  = shape(ramp) × 50                    shape ∈ {linear, exponential, step}
overdue = min(1, daysOverdue / 7) × 10        keeps climbing after the deadline
```

### Why not fraction-of-lifespan

The original formula used `elapsed / (due_date − created_at)` — the task's own lifespan. That puts the **creation date in the denominator**, so two tasks with identical priority and identical deadlines scored differently purely because one was written down earlier. A task added today and due Friday is under exactly the same pressure as one added last Monday and due Friday; the deadline is real, the creation date is an accident of when it got typed in.

It also failed in the direction that matters most: a task added the day before it's due had a tiny lifespan, so its elapsed ratio was near zero and it read as **not urgent** right when it was most urgent. Rescoring live data moved "Review OS Processes", due the next day, from 30 to 81.

Scores are now comparable across the whole list, which is the point — they're used to sort a queue and to rank scheduler candidates.

### Curve shapes

Curves are normalised to start at 0 and reach exactly 1 at the deadline, so they are comparable to each other rather than each having its own range:

| Curve | Behaviour |
|---|---|
| `linear` | Pressure rises steadily across the fortnight |
| `exponential` | Sigmoid centred at 0.75 — flat for most of the window, then steep |
| `step` | Three plateaus: 8% → 40% → 100% at the 60% and 85% marks |

### Overdue

The deadline is not the ceiling. On-time pressure tops out at 50 and overdue adds up to 10 more over the following week, so a task three days late outranks one due this afternoon instead of tying with it.

### Keeping the two implementations in sync

`computeUrgency()` in `src/types/index.ts` is the source of truth, and the PL/pgSQL `recompute_urgency_scores()` (rewritten in migration `0011`) must match it — the nightly `pg_cron` job overwrites every active task's score, so a stale function silently reverts the app's work every night. **This is the one migration whose absence is actively harmful rather than merely inert.** The two were verified equal to 1e-10 across 216 combinations of priority, curve and deadline.

Habits keep `urgency_score = 0`: they aren't deadline work. The scheduler gives them a `priority × 10` baseline at scheduling time instead (see [Scheduling habits](#scheduling-habits)).

---

## Focus Timer

### State machine

```
idle  ──start()──►  running  ──pause()──►  paused
                 ◄──resume()──             │
                                          ◄┘
idle  ◄──finish()──  (any)
idle  ◄──abandon()─  (any)
```

### Timing accuracy

`elapsedMs` is computed from refs (`startedAtRef`, `pausedElapsedRef`), not from React state, to avoid closure staleness on the 500 ms interval tick. State is only written on each tick for display.

### Session lifecycle

| Event | DB effect |
|---|---|
| `start(task)` | INSERT `focus_sessions` row (started_at set, ended_at null) |
| `finish(accurate, note)` | UPDATE row: ended_at, duration_minutes, estimate_accurate, blocker_note |
| `abandon()` | DELETE row (clean up orphan) |
| `completeTask()` without timer | INSERT new row only if no session exists for this task in the last hour |

**Why delete on abandon (not soft-close)?** The row is incomplete and misleading. Keeping nulled-out rows pollutes analytics queries. A hard delete is simpler than adding an `abandoned` boolean everywhere.

### Context / component tree

```
AppLayout (Server Component)
  └─ TimerShell (Client — wraps TimerProvider + FloatingTimer)
       ├─ TimerProvider   (context, timer logic)
       ├─ FloatingTimer   (chip + reflection panel)
       └─ {children}      (rest of app — can call useTimer())
```

`TimerShell` is the bridge pattern for mounting a client context inside a Server Component layout.

---

## Google Calendar Sync & Write Access

### OAuth separation

The Google OAuth client used for **Supabase Auth** (login) is configured in the Supabase dashboard. The Google OAuth client used for **Calendar API** is in `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). They can be the same Google Cloud project, but they're configured in two places.

### Scope

`https://www.googleapis.com/auth/calendar.events` — grants read + create/edit/delete for calendar events. This is a superset of `calendar.readonly` for event access, so it covers both syncing and writing focus blocks.

Previously the scope was `calendar.readonly`. If a user connected under the old scope, the Settings page detects it from the stored `scopes` array and shows an **Upgrade access** button that re-triggers the OAuth flow.

### Token storage

Tokens are stored in `user_integrations` (server-side only). The service-role client is used for all token reads/writes. Tokens are **never sent to the client**.

### Refresh strategy

`getValidToken()` in `src/lib/google-calendar.ts` checks if the access token expires within 60 seconds and refreshes proactively. Refresh uses the `refresh_token` from `user_integrations` against `https://oauth2.googleapis.com/token`.

### Sync (read)

`syncCalendarEvents()` lives in `src/lib/google-calendar.ts` (not in the API route). This means both the Route Handler (`POST /api/calendar/sync`) and the Server Action (`triggerCalendarSync`) can call it directly, avoiding HTTP self-calls that fail in serverless environments when `NEXT_PUBLIC_SITE_URL` is unset.

All-day event dates from the Google Calendar API are `YYYY-MM-DD` strings (no time). We append `T00:00:00Z` (UTC midnight) — **not** `T00:00:00` (local midnight). The distinction matters on any server not in UTC.

The query fetches events where `end_time >= now()`, which correctly includes in-progress events.

### Write: task focus blocks

Three functions in `src/lib/google-calendar.ts`:

| Function | GCal API call | Notes |
|---|---|---|
| `createTaskBlock()` | `POST /calendars/primary/events` | Creates `🎯 <task title>` event; color-coded by priority (red=critical, orange=high, blue=medium, grey=low). Takes a `prefix` — `✓` marks a session already done rather than work planned ahead |
| `updateTaskBlock()` | `PATCH /calendars/primary/events/:id` | Updates start/end only |
| `deleteTaskBlock()` | `DELETE /calendars/primary/events/:id` | Silently ignores 404/410 (already deleted) |
| `listAutoScheduledEventIds()` | `GET /calendars/primary/events?privateExtendedProperty=plannerAuto=true` | Lists auto-scheduled blocks in a window, for cleanup |

### Every event Planner writes says so

`PLANNER_SIGNATURE` (`— Created by Planner`) is appended to the description of every event `createTaskBlock` writes, below the task's own notes when it has any.

The `plannerAuto` extended property already marks auto-scheduled blocks, but extended properties are invisible inside Google Calendar — from there, a focus block is indistinguishable from an event you made yourself, which matters most when you're deciding whether something is safe to delete or move. Description is the one field Calendar shows in every view, on every client.

It goes on *all* Planner-written events, not just tagged ones, because the question it answers ("did I make this or did the app?") is the same either way.

### Reviewing a week: whole horizon, partial approval

`proposeSchedule` returns an `existing` list — calendar events and already-booked task blocks across the horizon — alongside the new proposals. The review merges both into one chronological week: you can't judge a proposal without seeing what it's fitting around, and the old modal showed only the new blocks in isolation.

Existing rows are read-only context (dashed, dimmed). Proposals carry a checkbox and start approved; unticking rejects that block. Confirm sends only the approved ones.

Partial approval changes what cleanup may touch. The sweep used to clear **every** auto block in the window and rewrite the lot, which is wrong once approval is partial — rejecting one block would delete the schedule for everything else. Cleanup is now scoped to the **approved tasks**: their older blocks are removed and replaced, and everything else is left alone. The `plannerTaskId` written into each event makes a task's blocks identifiable even though the row only remembers one id.

The trade-off: a block belonging to a task that is no longer proposed at all (completed, deleted) is no longer swept, because "not approved" and "not proposed" are indistinguishable here. Leaving it is the safer error — deleting calendar entries the user never agreed to remove is worse than one that lingers.

### proposeSchedule fans out

The action was a chain of sequential awaits — config, tasks, subtasks, habits, freeBusy, then the existing-week queries — for work with almost no ordering between it. Measured against the live database, the same set of queries took **2043 ms one after another and 272 ms in parallel**.

Everything independent now runs in one `Promise.all`: token, config, top-level tasks, habit candidates, and the two existing-week queries. Only two things genuinely have to follow — the subtask query (needs the parent ids) and freeBusy (needs the token). The time window is pure arithmetic, so it's computed before the first await and lets the calendar queries start with the rest. `buildHabitCandidates` fans out internally too.

### Waiting for a proposal

The preview modal opens **immediately** in a loading state rather than after the round trip: a button that sits dead for a couple of seconds reads as broken, and the work is one server call with no natural checkpoints.

The progress bar is **indeterminate** — a sweep animation, not a percentage. There is no real progress to report from a single round trip, and a fake percentage that jumps to 90% and waits is worse than an honest "working". A skeleton week sits underneath so the shape of what's coming is visible.

### "Didn't fit" is grouped, not itemised

Habit sessions are expanded one candidate per session, so a 7×/week habit with six days left in the week produces leftovers *every* run. Listing each as its own failure row made a working schedule look broken.

The list is collapsed per title and reports what was achieved: "Piano — 6 of 7 scheduled" reads as information, in neutral styling, while something that got nothing at all stays amber and says so. The distinction the user cares about is "did any of it happen", not "how many candidate objects failed".

### The week review is a calendar grid

`ScheduleWeekCalendar` renders the horizon as day columns against an hour gutter, positioned absolutely by time — the shape people already read schedules in. The list view is kept behind a toggle for scanning.

- **Visible range is derived**, not fixed at 24h: one hour either side of the earliest and latest item, with a 10-hour minimum so a light day doesn't collapse to a sliver.
- **Lane widths are per overlapping cluster, not per day.** A day-wide lane count makes every block on the day narrow just because two of them collide at 1pm. Items are grouped into clusters separated by gaps where nothing is running, and each cluster sizes itself.
- **Existing items are dashed and dimmed**, and not draggable — they're context, not proposals.

### Dragging blocks

Pointer events rather than the HTML5 drag-and-drop used in `UpcomingView`. DnD gives no usable coordinate during the drag, and a calendar needs continuous Y→time and X→day mapping to place the block precisely; `setPointerCapture` also keeps the drag alive when the cursor leaves the block.

Dropping snaps to 15 minutes and clamps so a block can't be dragged out of the visible range. Moving across columns changes the day. Duration is preserved — the drag moves a block, it doesn't resize it.

Moves are **local state** (`moved`, keyed by the block's *original* start so the key survives repeated drags) and are only persisted on Confirm, which sends the effective times. Nothing touches the calendar until the user approves.

### Auto-scheduled blocks are tagged in GCal, not tracked in the DB

A task row has **one** `gcal_event_id` column, but a task can occupy **several** blocks — a long task split into segments, or a habit scheduled 4× a week. The column can only hold the last one, so `confirmSchedule` used to delete one event per task and orphan the rest. With habits this went from a rare edge case to a guaranteed weekly leak (3 stranded gym blocks per re-run).

`createTaskBlock(..., auto = true)` writes `extendedProperties.private.plannerAuto = 'true'` (plus `plannerTaskId`), making **Google Calendar itself the register** of what the scheduler created. Cleanup lists by tag instead of trusting the column.

Chosen over a `task_schedule_blocks` table because:
- No migration, and it retroactively sweeps blocks orphaned by earlier runs.
- The events live in Google's system and the user can move or delete them there, so any DB copy is a cache that drifts. Tag-based cleanup is drift-tolerant; a mirror table is not.

**`auto` defaults to `false` and must stay that way.** Manually placed blocks (`scheduleTask` in `actions/calendar.ts`) are user-owned; tagging them would make the auto-schedule sweep delete the user's own calendar entries.

Ordering in `confirmSchedule` preserves the create-before-delete rule: snapshot the tagged ids **first** (so the set is by definition all-old), create every new event, then delete the snapshot. If creates were attempted and all failed, the delete is skipped so a GCal outage leaves the existing schedule intact — an *empty* proposal is treated as a deliberate "clear everything" and still sweeps. The sweep window starts at `now`, so past blocks survive as history.

Server actions `scheduleTask(taskId, startISO, endISO)` and `unscheduleTask(taskId)` in `src/app/actions/calendar.ts` call these and write back `gcal_event_id`, `scheduled_start`, `scheduled_end` to the task row.

If a task already has a `gcal_event_id`, `scheduleTask` patches the existing event rather than creating a duplicate.

**No webhook sync yet.** If the user moves or deletes the GCal block from Google Calendar directly, the `scheduled_start/end` fields go stale. Planned: GCal push notifications to detect external changes.

### Scheduler: spread groups

`SchedulerTask.spreadGroup` marks candidates that must land on **distinct days**. Habit sessions share one (the habit's id), so "gym 4×/week" produces four blocks on four days instead of stacking into a single afternoon. Two effects inside `runScheduler`:

- Days already used by the group are skipped when collecting slot candidates.
- Slot choice sorts by **start time** rather than tightest-fit, so sessions walk forward through the week instead of clustering wherever the snuggest gaps happen to be.

### Daily breaks (meals)

`user_daily_breaks` (migration `0008`) — a label, a duration, a **window** it must fall inside, and a cooldown. Seeded with Lunch (60 min between 11:00 and 13:15) and Dinner (60 min between 17:00 and 19:30), both with a 60-minute cooldown.

A break is not a calendar event: it's "an hour, somewhere in here", and the scheduler picks the actual time per day. Breaks are reserved **before any task is placed**, so a meal gets first claim on its window rather than losing it to whatever work happened to sort first. Each takes the earliest free slot in its window; if the window is fully booked by real calendar events that day, the break is skipped rather than forced.

**Planner-only.** Breaks reserve time inside the scheduler but are never written to Google Calendar — they produce no `ProposedBlock`, so `confirmSchedule` has nothing to create. Chosen deliberately: the point is protecting the time from *this* app, not filling the calendar with a recurring daily event.

`cooldown_minutes` blocks the period *after* a break for tasks with `avoidAfterBreaks` — "no gym or running for an hour after eating". Cooldowns are deliberately **not** buffered by `bufferMinutes`: the window is already an explicit "not for this long", and padding it would quietly extend the rule beyond what was asked. Reserved break intervals *are* buffered, like any other busy time.

`tasks.avoid_after_breaks` carries the flag, set per habit from the detail panel.

Degrades on a pre-0008 database: the breaks query resolves to null instead of throwing, so the scheduler runs with no breaks, and the flag reads false through `select('*')`.

### Tethering work: location + span

Some tasks take little effort but hold you in place. Washing sheets is ~10 minutes of attention across a two-hour cycle: you're free to do other things, but not to leave. An exclusive block models this badly — reserving two hours wastes them, reserving ten minutes lets the scheduler send you to the gym mid-cycle.

Two columns (migration `0009`):

- `tasks.span_minutes` — total tie-up, when longer than the work itself. The scheduled block stays `estimated_minutes` (the attention); the span only pins location.
- `tasks.location` — `home` / `away` / `anywhere` (default). `anywhere` is compatible with everything; `home` and `away` clash.

While a span runs, the scheduler records a **tether**: a window where your location is fixed. Unlike a placed block a tether does *not* consume time — compatible work is welcome inside it, which is the entire point. Incompatible work is not: mark Gym as `away` and it won't be scheduled during laundry.

The check runs both ways. A task that would tether can't start when work needing you elsewhere is already booked inside its span, so ordering doesn't matter: laundry-then-gym and gym-then-laundry both produce a legal day.

**Tethers are subtracted from free time, not rejected per-slot.** The slot search only considers the *start* of each free interval, so testing "does this slot overlap a tether" and skipping made a task unschedulable for the whole day whenever its one free interval happened to begin mid-tether — a gym session vanished rather than sliding to just after the laundry. Carving incompatible tethers out of the free intervals makes the next slot start at the tether's end naturally.

Per the chosen behaviour only the active minutes appear as a block; the tie-up is enforced but not drawn, so the calendar shows "Wash sheets, 10 min" rather than a two-hour bar.

Degrades on a pre-0009 database: task rows load with `select('*')`, so a missing `location` reads as undefined and falls back to `anywhere`, and no span means no tether. Writes go through `setTaskPlacement`, which returns a message rather than throwing.

### Plan Day: what the ranked list contains

The day's blocks and the ranked list beside them are built from different queries, and they used to disagree. The list filtered `due_date <= day`, which dropped two whole categories: anything **undated** — which is every habit — and anything the scheduler **pulled forward** from later to fill the day. With no task due today the list came out empty while the plan beside it was full.

It now takes tasks that are due today or earlier, undated, or scheduled today. Far-future work stays out unless it actually earned a block, so the list reflects the plan rather than a separate idea of the day.

Habits are given the same `priority * 10` baseline the scheduler uses; their stored `urgency_score` of 0 would otherwise bury them at the bottom of a list they belong near the top of.

### Habits without a weekly target

`buildHabitCandidates` used to require `weekly_target`, which made untargeted habits **invisible to the scheduler** — never proposed, never reported, no indication why. "I keep doing this, no fixed count" is a normal way to hold a habit, not a reason to exclude it.

An untargeted habit now yields **one session per run**, skipped if it was already done this week. Once a count exists the target governs as before. One a week is a deliberately modest floor: without a number there's nothing to infer a frequency from, and over-scheduling something the user never committed to a count for is the worse error.

### Per-task transition buffer

`tasks.buffer_minutes` (migration `0010`): null = the global default, 0 = none.

The global 15-minute buffer suits work that needs settling-in time but makes small chores absurdly expensive — taking out the trash is 5 minutes of work that needed **35 minutes of clear space** to be scheduled, so it lost to anything else whenever the day was busy.

The buffer applied is the **placing task's own**, not the maximum of it and its neighbour's. Taking the max would be defensible as "the neighbour still wants breathing room", but it defeats the purpose: the chore would still inherit 15 minutes from whatever sits next to it and still wouldn't fit. Blocks placed later apply their own buffer against it as usual.

### Working hours past midnight

A day's window is `[start, end]`, and an end **at or before** the start means it runs into the next day: "10:00 to 01:30" is a fifteen-and-a-half hour day, not a negative one. `workWindow()` is the single definition, used by both free-slot scanning and the fixed-sequence check.

The interval check can't just look up the day containing a block's start — 00:30 belongs to the *previous* day's hours — so it tests the block against every day's window instead.

### Scheduler: atomic work

`SchedulerTask.atomic` marks work that can't be split across sittings — it takes one unbroken block instead of being chunked by `maxSessionMinutes`. Habit sessions set it (see [Scheduling habits](#scheduling-habits)); ordinary tasks don't, and still segment as before.

The large-task sort bonus is computed from how many max-sessions the duration *spans* rather than from its segment count, so an atomic task (always one segment) still earns the anti-fragmentation protection a long split task gets.

### Scheduler: unschedulable is per-candidate, not per-task

The "did it fit" check is scoped to the blocks a single candidate added (`scheduled.length === blocksBefore`), not to whether any block exists with that task id. Habit sessions share an id, so the old task-id check swallowed every session after the first — a request for 4 gym sessions with room for only 2 reported **zero** failures. Multi-segment behaviour is unchanged: a task that places some segments but not all is still not "unschedulable".

### UI

- **Settings → Google Calendar section**: shows connection state (not connected / read-only / full access), Sync now, and Disconnect buttons.
- **TaskDetail → Schedule section**: when GCal write is enabled, shows start/end datetime pickers. Start auto-advances end by the task's `estimated_minutes` (defaults to 60 min). Submitting calls `scheduleTask`; existing blocks show a summary + "Remove block" button.

---

## Recurring Tasks & Habits

### Data model

- `tasks.rrule` — iCal RRULE string (e.g. `FREQ=WEEKLY;BYDAY=MO`), `null` for non-recurring tasks.
- `tasks.type` — `'recurring'` when rrule is non-null; `'habit'` for habit-type tasks; `'task'` or `'someday'` otherwise.
- `habit_streaks` — one row per recurring task id; tracks `current_streak`, `longest_streak`, `last_completed` (YYYY-MM-DD).

### Completion flow

When `completeTask()` is called on a task with an `rrule` or `type === 'habit'`:

1. The task is marked `status: 'done'` as usual.
2. The **next occurrence is anchored from `task.due_date`**, not from today. This prevents early completions from re-spawning the same occurrence date. E.g. completing "Weekly Review" (due Sep 20) on Sep 14 → next spawns Sep 27, not Sep 20.
3. `getNextOccurrence(rrule, anchor)` computes the date strictly after the anchor using the `rrule` library.
4. For **anytime habits** (`rrule` is null, `type === 'habit'`): next occurrence spawns for tomorrow so the card reappears daily.
5. A new task row is inserted with the same title/project/priority/energy/estimate/rrule, `status: 'inbox'`, and `due_date` set to the next occurrence.
6. `habit_streaks` is upserted: consecutive completion (last_completed === yesterday) increments the streak; otherwise resets to 1.

### "Not before" (defer date)

`tasks.start_date` (migration `0013`) — the earliest a task may be scheduled. The deadline says when work must be *finished*; this says when it may *begin*.

Without it every pending task is available the instant it exists, so the scheduler fills spare capacity with work that can't actually be done yet: a weekly grading task completed on Monday immediately gets next week's occurrence booked, even though next week's homework doesn't exist. That's not a priority problem — no amount of deprioritising makes it correct — it's a availability problem, which is why it needs its own field rather than a nudge to the urgency formula.

It deliberately does **not** stop the scheduler pulling *other* future work forward to fill space, which is wanted behaviour. Only work that is genuinely not yet doable opts out.

**Recurring occurrences set it themselves.** When completing a recurring task spawns the next one, `start_date` defaults to the day after the occurrence just closed — a Thursday-weekly task completed this week becomes available Friday, not immediately. It's clamped to never exceed the new deadline, which would make the task unschedulable. Editable per task under "Not before".

Subtasks take the parent's: a step can't begin before the work as a whole is available.

### Why anchor from `due_date`, not `today`?

The previous implementation passed `today` to `getNextOccurrence()`, which caused a bug: completing a recurring task before its due date would spawn the next occurrence at the same due date (e.g. completing a weekly task on Wednesday with a Sunday due date would schedule the next occurrence for the coming Sunday — which is still in the future, so the completed task effectively re-appeared immediately). Anchoring from `due_date` means "next after this occurrence" regardless of when you complete it.

### Why "spawn a new row" instead of updating in-place?

Keeping completed instances as `status: 'done'` rows lets analytics queries (focus session history, estimation accuracy, streak counting) see the full history. A recurring task that updates its own `due_date` in-place loses the historical record.

### UI

- `src/lib/rrule-utils.ts` — `PRESETS` array, `rruleToPreset()`, `rruleToLabel()`, `getNextOccurrence()`.
- `src/components/RecurrencePicker.tsx` — grid of preset buttons (No repeat / Daily / Weekdays / Mon–Sun / Monthly).
- Task list shows a `↻` violet badge on tasks whose `type === 'recurring'`.

---

## Habits Page

### Route

`/habits` — dedicated page separate from `/tasks`.

### Data model

Habits are `tasks` rows with `type = 'habit'`. There is no separate habits table. Each day's completion is tracked as a completed task row; the next occurrence is spawned on completion (see [Recurring Tasks & Habits](#recurring-tasks--habits)).

### Completion calendar grouping

Each habit occurrence is a separate task row with a new ID. Linking completions to a logical habit requires grouping by `title` (not by ID). The 16-week heatmap queries `completed_at` + `title` and builds a `Record<string, string[]>` (title → sorted dates). This is a trade-off: renaming a habit breaks its history. Acceptable for a personal tool.

### "Anytime" habits

Habits like "gym" or "reading" don't have a fixed day of week. Setting `rrule = null` on a habit makes it an "anytime" habit:

- The add-habit flow no longer auto-sets `FREQ=DAILY` when switching to Habit mode — the user explicitly sets a schedule or leaves it blank.
- Anytime habits show `● Anytime` frequency label.
- On completion, the next occurrence spawns for tomorrow (so the card reappears every day without needing an rrule).
- The habits query filters to `due_date <= today` (or null), so tomorrow's spawned occurrence is hidden until then.

### Done-today handling

When a habit is completed for the day, it's moved to a "Done today" section (greyed, faded). `doneToday` IDs are passed as a prop so the client can optimistically move cards without waiting for a revalidation.

The page runs **two** queries: pending habits (`status in (inbox, active)`, due today or earlier) and habits completed today (`status = 'done'`, `completed_at >= start of today UTC`), merged by title with the pending row winning. The second query is load-bearing — completing a habit flips its row to `done` and spawns the next occurrence for tomorrow, so without it a completed habit disappears from the page entirely rather than showing as done. Deriving `doneToday` from the pending list alone (the original approach) always produced an empty set.

### Day boundaries are the user's local days

*(Was UTC. Changed 2026-09-15 — see "Why it changed" below.)*

Every day-shaped question about a habit — which heatmap square a session lights, whether it's already logged today, what counts toward this week's target, when tomorrow's occurrence appears — is answered in the user's timezone, through `src/lib/day.ts`.

**Two representations, kept apart.** A *day string* (`YYYY-MM-DD`) is a calendar day with no time in it; arithmetic on those (`addDays`, `dayOfWeek`) is pure UTC math and can't drift, because every UTC day is exactly 24 hours. An *instant* is a moment; turning one into a day needs a timezone, which is the single job of `localDayStr`. Mixing the two is what the old code did — building `Date` objects at local midnight and reading them back with `toISOString().slice(0,10)` — which silently shifted every heatmap cell for anyone west of the meridian.

**Where the timezone comes from.** `user_scheduling_config.timezone` (migration 0014), reported by the browser on every page load via `TimezoneSync` and shown in Settings. It has to be stored rather than read at the point of use, because the habits page builds the heatmap *on the server* and server actions do the streak math. `saveTimezone` returns without writing when nothing changed, so the per-load sync costs one query and triggers no revalidation. Missing column or empty value falls back to UTC — exactly the old behaviour, so the app works before 0014 runs.

**DST is handled by asking, not by arithmetic.** `startOfLocalDay` finds the offset by asking `Intl` what the wall clock reads at a candidate instant, then re-reads it at the corrected instant — two passes, because a DST change can move the offset between them. Verified against the 25-hour and 23-hour US days and a half-hour zone (Asia/Kolkata). The one input it can't represent is a local midnight that doesn't exist (spring-forward at 00:00, a handful of zones); it lands on the following hour, the closest real instant.

**Old rows needed no backfill.** Occurrences spawned before the change carry UTC-midnight `due_date`s; new ones carry local midnight. The same calendar day, a different instant — and reading one as the other makes tomorrow's habit appear today (west of UTC for old rows, east of it for new ones). So the page treats a habit as available only once its day has begun under *both* readings, taking the earlier of the two thresholds. Correct for either format, and still correct once every row is local. Backfilled completions were already stored at midday, which is safely inside the day in any nearby zone, so their squares didn't move.

### Why it changed

The UTC rule was right about one thing: both sides of a comparison must agree, and they now do. It was wrong about which day a session belongs to. A 7pm gym session in California is 02:00 UTC the next day, so it lit tomorrow's square, counted toward tomorrow's target, and moved the streak — for evening habits, which is most of them.

The original note justified UTC as matching all-day calendar events. That rule still holds for `due_date` on *tasks* (an all-day event is a date, and `T00:00:00Z` keeps it from sliding), but a habit completion isn't an all-day event — it's a moment that has to be filed under a day, and only the user's timezone can say which.

### Weekly targets

`tasks.weekly_target` (integer, nullable) holds "how many times per week".

**Progress is derived, not stored.** `habit_streaks` has `completions_this_week` / `week_start` columns, but they are **not** the source of truth: that table is keyed by `task_id` while every occurrence is a *new row with a new id*, so the counter for the pending row on screen has never been incremented and always reads 0. Both the scheduler and the habits page instead count **distinct completion days this week, grouped by title** — title being the habit's real identity here, as it already is for the streak calendar. The habits page patches the real count into the `HabitStreak` object it hands to `TaskDetail`.

Counting *days* rather than completions is deliberate: "gym 4× a week" means four days, so two sessions on one day count once.

Habits are excluded from the `/tasks` query (`neq('type','habit')`) — they live on `/habits` and would otherwise clutter the task list with untimed, non-urgent work.

### One pending occurrence per habit

`completeTask` refuses to spawn a next occurrence when another pending row with the same title already exists. Without the guard, completing a habit twice in one day spawned two rows for tomorrow — the habit then showed and scheduled twice on the same day.

Same-day completion is also a no-op for the streak. The consecutive-day check is `last_completed === yesterday`; on a second completion today `last_completed` is already *today*, which read as "not consecutive" and reset a long streak to 1.

### Habits have no deadlines

The detail panel hides the due-date picker, urgency curve, and urgency breakdown for habits — all deadline machinery, and habits are stored with `urgency_score` 0 regardless. `due_date` remains internally as the next-occurrence marker the habits page filters on, but it is no longer user-editable, so it can't be set by hand in a way that breaks the occurrence chain.

### Logging a session at a time

The one-tap "+" records that a habit happened, which is all most logs need. `logHabitSession` is for when the hour matters — you ran at 7am and are logging it at noon — and optionally writes the session to Google Calendar as a record of where the time went.

**Today goes through `completeTask`, not a second row.** Logging today against the pending occurrence completes it properly: streak, weekly count and the next occurrence all follow. Inserting a done row alongside it (what `setHabitCompletion` does for past days) would leave today's card still asking to be done, and the "+" button would then create a duplicate. `completeTask` took an optional `completedAtISO` so the record sits at the real time rather than at the moment you pressed the button.

**Logged events are never tagged `plannerAuto`.** The tag is what the auto-schedule sweep deletes; a logged session is history, and the next "Schedule my week" would erase it. The event id is stored on the completion row instead, and un-logging deletes the event through it — without that, the row disappears along with the only record of the event, orphaning it on the calendar forever.

**The day it counts for is the user's local day containing the start instant**, derived server-side and returned to the caller so the optimistic update marks the cell the heatmap will draw. See *Day boundaries are the user's local days*.

**A failed calendar write doesn't fail the log.** The action returns `dateStr` whenever a row was written, with `error` describing only what didn't happen; the sheet shows the warning and still closes out the log. Reporting total failure for a session that *was* recorded would be a lie, and re-logging would then hit the one-per-day guard.

### Filling in from the calendar

If the gym block was on Tuesday and Tuesday is over, you went. `syncScheduledHabits` sweeps finished days and logs the habits that were blocked out on them.

**Only finished days.** Today's blocks are never swept, so a session you haven't done yet is never claimed for you. Seven days back, because the sweep runs on every visit to the habits page and a longer gap is one you'd want to fill in deliberately.

**Matched by title against `calendar_events`, not by the `plannerAuto` tag.** Two reasons. The tag would only find blocks Planner scheduled, and "if I have gym on my calendar" includes events you typed yourself. And `calendar_events` is already synced, so the sweep costs no Google round trip. The comparison strips a leading marker (`🎯 Gym`, `✓ Gym`) and casing, then matches exactly — so "Gym" is the habit and "Piano Lesson" is not, which is what you want when the habit is called "Piano".

**It runs from a client effect, not during render.** The page is a Server Component and rendering must not write. Same shape as `TimezoneSync`.

**Nothing is silent or one-way.** Days already logged are filtered out in one query before any writing, so the steady state costs nothing and an existing completion is never overwritten. What *was* written appears in a banner on the page with a one-click Undo for the whole batch, and individual days can still be un-clicked on the heatmap.

The premise can be wrong — a blocked session you skipped gets logged as done. That's the trade the feature asks for, which is why it's visible and reversible rather than quiet.

### Deleting and back-filling

Both act on the **title**, since a habit is a chain of rows rather than one row:

- `deleteHabit(title)` removes every occurrence, its streak rows, and any Google Calendar blocks. Calendar events are deleted *first* — once the rows are gone their event ids are unrecoverable and the blocks would linger forever. This deletes history, which is what delete means here.
- `setHabitCompletion(title, date, done)` logs or un-logs a past day from the heatmap. It inserts a *completed* occurrence rather than touching the pending row, so today's card stays actionable and the spawn chain is untouched. `completed_at` is noon UTC so slicing the date back out can't drift, the write is idempotent (one completion per day), and future dates are rejected.

### Scheduling habits

A habit with both a `weekly_target` and an `estimated_minutes` session length is expanded by `buildHabitCandidates()` into one scheduler candidate per session still owed this week (target minus `completions_this_week`). Notable choices:

- **Candidates carry the end of the current week as `due_date`.** Not the habit row's own `due_date` — that's a "next occurrence" marker and would trip the scheduler's `dayMs > dueMs` guard, pinning every session to one day. The week end is needed because "Schedule week" runs a *rolling* 7 days from today, which straddles the week boundary whenever today isn't the first day; without the bound, sessions owed for this week could be placed into next week, which would then begin with its allowance already spent.
- **`urgency_score` is overridden to `priority * 10`.** Habits are stored with score 0 since they aren't deadline work, which would sort them last and leave them only whatever space is left over. The override gives them the same baseline an undated task of that priority gets. Raising a habit's priority is the lever if it keeps losing to deadline work.
- **Sessions are `atomic`.** A session occupies one unbroken block however long it is, instead of being chunked by `maxSessionMinutes`. You don't do 90 minutes of gym on Monday and the remaining 30 on Tuesday. This is load-bearing for the target: a 120-minute session against a 90-minute cap splits into two segments, and since segments can't share a day either, "2× a week" silently produced **four** scheduled blocks across four days. A session longer than the largest free window is reported unschedulable, which is the honest answer.
- **Placed by widest gap, not earliest free day.** Taking the earliest slot each time packs a 2×/week habit into Monday and Tuesday and leaves the weekend permanently empty. For `spreadGroup` candidates the pool is sorted by distance from the days the group already occupies (ties → earliest), which distributes sessions over the whole horizon. Gym 2× + Run 2× in one group lands Mon, Tue, Thu, Sun instead of Mon–Thu.
- **Emitted round-robin** across habits, not habit-by-habit. `runScheduler`'s sort is stable, so habits on equal footing keep this order and grouped ones alternate (Gym, Run, Gym, Run) instead of running in blocks (Gym, Gym, Run, Run). A genuinely higher-priority habit still sorts ahead of the rotation.
- **Sessions share a `spreadGroup`**, keyed by `exclusive_group` when set and by title so they land on distinct days (see [Scheduler](#scheduler)). otherwise. Keyed by title rather than row id: if a habit ever ends up with two pending rows they are still one habit and must not both land on the same day.

### Mutually exclusive habits

`tasks.exclusive_group` (text, nullable — migration `0007`). Habits sharing a group are never scheduled on the same day: set Gym and Run both to `Exercise`.

This needed **no new scheduler logic** — `spreadGroup` already means "these candidates must land on distinct days", so mutual exclusion is just two habits sharing the key. A pairwise `habit_conflicts` table was considered and rejected: it expresses arbitrary conflict graphs (A–B, B–C, A fine with C) but would require real graph colouring in the scheduler, for a case that named groups cover.

**The UI takes the other habit, not a group name.** The first version asked for a group name under the label "Not on the same day as", which reads as a blank to fill with the *other habit's* title — doing that creates two groups of one, named after each other, that exclude nothing. It looks configured and does nothing. The picker is now a checkbox list of the other habits; ticking one writes the shared group to both sides. `setHabitExclusiveLink(title, other, linked)` joins whichever group already exists, else names a new one for the pair. Unticking clears both when the group is a pair (a group of one excludes nothing) and otherwise drops just the habit being unticked.

The constraint is **scheduling-only**. If you actually did both in one day you can still log both — the app records what happened rather than refusing data it knows is real.

The group is stored on *every* row of the habit chain and copied by both the completion spawn and the back-fill insert, so it survives the next completion.

Over-subscription degrades honestly: Gym 5× + Run 4× is nine sessions for seven days, so seven are placed on distinct days and two are reported unschedulable rather than silently dropped.

**Writes omit the column when unset.** The spawn and back-fill inserts spread `exclusive_group` in conditionally, so a database without 0007 still creates habits normally — sending the key unconditionally is precisely how `weekly_target` broke habit creation before 0005 was applied. Reads use `select('*')` and fall back to per-habit grouping; only assigning a group needs the column, and the setter returns a message naming the migration.

---

## Subtasks / Checklists

### Data model

`tasks.parent_id` is a self-referential FK (`REFERENCES tasks(id) ON DELETE CASCADE`). Subtasks are task rows with `parent_id` set to the parent task's id. They do not appear in the main task list (filtered by `parent_id IS NULL`).

### Subtasks inherit from their parent

A subtask is part of one piece of work, so it takes the parent's **project**, **deadline**, **location**, **priority** and **urgency**.

Priority and urgency are read from the parent at scheduling time rather than copied. Subtasks are created at priority 1 with urgency 0, so a chain under a task marked P4 used to sort to the very bottom and get whatever slots were left — the exact opposite of what marking the parent critical is for. Project, deadline and location are set at creation and cascaded by `updateTask` when the parent moves — without the cascade they keep whatever was copied on day one and drift, showing under the wrong project or outliving the deadline they belong to.

The scheduler reads the deadline from the parent row on every run rather than trusting the copy, so a subtask can never be scheduled later than the thing it's part of even if the two fall out of sync.

Subtasks appear in the main list like any other task, so each shows `↳ Parent title` — "Dahl" on its own is a mystery once it's out of the parent's checklist. The row carries a `parent:parent_id(id, title)` embed. Note the syntax: `tasks!parent_id` resolves to the *children* of a row (an array); `parent_id(...)` is the many-to-one direction.

### Chained scheduling

Subtasks of one parent share a `chainGroup` and are placed as a run: **no buffer between them, one buffer around the whole run**. Reading Dahl then Rawls needs no transition; the run as a whole does.

Each sitting takes the slot that fits the **most** members, not the tightest-fitting one — the goal is to group the chain as tightly as the week allows rather than scatter it one subtask at a time. Members still get their own block each, so each keeps its own calendar event and row; they are merely adjacent.

The run is constrained by its strictest member: widest buffer, earliest deadline, any location that isn't `anywhere`. A run is capped at `maxSessionMinutes`, so five 20-minute readings against a 90-minute cap become 4 + 1 rather than one 100-minute block — raising the max session length groups more per sitting.

### Multi-stage work (fixed waits)

`tasks.gap_after_minutes` (migration `0012`) — the wait between one subtask and the next. Washing sheets is 5 min loading, an hour of machine time, 5 min to the dryer, another hour, 15 min making the bed. The waits are unavoidable, fixed, and *yours to use*.

A chain with any non-zero gap is placed as a **fixed-offset sequence** rather than packed. The offsets aren't negotiable — if loading is at 10:00 then the dryer is at 11:05, wherever that lands — so instead of choosing a slot per stage, the scheduler looks for a single start time that makes *every* stage land on free time, stepping forward in 15-minute increments until one does.

The waits themselves are **not reserved**: each active stage is a block, the gaps between are left free, and other work can be scheduled into them. What the sequence does reserve is your *location* — the whole cycle, waits included, becomes a tether at the chain's location, so nothing marked `away` is scheduled inside it. That's what distinguishes a laundry cycle from three unrelated errands.

A sequence is all-or-nothing: if no start time fits every stage, the whole cycle is reported unschedulable rather than half-placed. A half-done laundry cycle isn't a useful plan.

How much of a wait is reusable depends on buffers — a 60-minute wait between two default-buffered stages leaves 30 usable minutes. Setting the filler task's buffer to None reclaims nearly all of it.

### Why not a separate table?

`parent_id` was already in the schema. Reusing the `tasks` table means subtasks automatically get all the same columns (status, title, timestamps) without a migration. The trade-off is that subtasks have irrelevant fields (urgency_score, energy_required, etc.) that are never used.

### Server actions

`getSubtasks(taskId)`, `createSubtask(taskId, title)`, `toggleSubtask(id, done)`, `deleteSubtask(id)` — all in `src/app/actions/tasks.ts`. The SubtaskSection component in TaskDetail handles optimistic updates locally and refreshes from the server after each write.

---

## Add Modal: Compact vs Detailed

`AddTaskModal` is the single add surface for tasks *and* habits (tasks page, projects, review, habits page), so every advanced field the scheduler understands had to live somewhere — and all of them at once made adding "call the dentist" a form to fill in.

Two views, toggled in the header beside the task/habit switch:

- **Compact** — title, project, priority, estimate, due date. Quick-add (the ✦ Claude parse) stays in both views; it's the fastest path in either.
- **Detailed** — adds notes, energy, repeat, "not before", where / ties-me-up / buffer, and the urgency curve. For habits: notes, priority, energy, schedule, the after-meals exclusion, and placement.

### The choice is remembered

`localStorage['planner.addTask.detailed']`. Someone who reaches for the advanced fields once usually wants them next time; reopening to compact every time makes Detailed feel like it never sticks. Per-viewer convenience, so browser storage is the right home — and it's read through a try/catch, since private windows throw on access.

### Compact says what it's about to apply

Quick-add can set an advanced field (energy, most often), and a remembered detailed session leaves values behind. So compact prints a one-line summary — "Also applying: 🔥 high energy · no buffer" — with a link to reveal the full form. Hidden is fine; hidden *and* silently in effect is how you end up with a task you didn't mean to create.

### Advanced fields are omitted, not defaulted

`createTask` spreads each new column in only when the caller supplied a non-default value:

```ts
...(data.span_minutes ? { span_minutes: data.span_minutes } : {}),
```

Same reason as everywhere else — those columns arrived in later migrations, and always naming them would break inserts on a database that hasn't run them. Setting one on an un-migrated database still fails, per "reads degrade, writes don't"; the modal now catches the error and shows the PostgREST message rather than leaving a dead button.

### What's not here

Habit exclusivity (gym and running never sharing a day) stays on the habits page. It's a pairing against habits that already exist, and the add modal doesn't have that list — a free-text group name here is exactly the mistake that produced cross-named groups the first time.

---

## Task List Views

### Folding is the default, everywhere

Both the list and Upcoming track which parents are **open** (`expanded`), not which are shut, so the default — an empty set — is everything tucked away. Same for project groups (`openProjects`). Inverting the state was the whole fix: a "collapsed" set defaults to nothing collapsed, which is the opposite of what these features are for.

Project grouping in particular exists to compress a long list into something you can survey. Opening it expanded shows the same wall of rows with headers added, so it starts compact and each header carries the numbers you'd otherwise expand to find — task count and total estimated time, including the group's subtasks.

Upcoming needed the same fold for a sharper reason: subtasks inherit their parent's deadline, so an unfolded reading list dumps every chapter into a single day section.

A subtask whose parent isn't in the same bucket — different due date, or filtered out — stays a top-level row rather than disappearing. Nothing is ever hidden by having a parent somewhere else.

### The "Relevant" filter

One filter for "what am I doing now", as opposed to the full list's "what do I owe anyone, ever". A task is relevant when:

- it isn't `someday` (a parking lot, never current)
- it isn't gated by a future `start_date` — you can't start it yet, however urgent it scores
- **and** it's already blocked on the calendar (that's the plan), or due within `RELEVANT_WINDOW_DAYS` (7), or — with no deadline at all — priority ≥ 3

The no-deadline fallback to priority is the one judgement call. Without a date, priority is the only signal separating "matters" from "eventually", and dropping undated tasks entirely would hide most of the Inbox.

Subtasks ride on their parent's relevance, checked against the unfiltered task list. Parents pass their deadline down, but a chain member without one of its own would otherwise vanish out from under a parent that's still showing.

Deliberately **not** a filter on `urgency_score`. Urgency blends priority and deadline into one number, so a threshold can't distinguish "critical but not due for a month" from "trivial and due tomorrow" — and both answers are wrong for a filter whose whole job is "can I act on this now".

Dates compare as local `YYYY-MM-DD` strings, the same way `formatDue` does, for the same reason: a UTC comparison makes a task due today read as overdue after local midnight UTC.

---

## Inline Search

### Approach

When the search bar was initially built, it used a dropdown/modal overlay showing matched results. This was rejected in favour of **live-filtering the existing list in place** — no overlay, no separate results view.

### Implementation

`SearchContext` (`src/contexts/SearchContext.tsx`) holds a single `query` string. The `TopSearchBar` component writes to it; `TaskList` and `UpcomingView` read from it and filter `activeTasks` before rendering. Context is provided at the app layout level via `SearchProvider` in `src/components/Providers.tsx`.

The search matches against `task.title` and `task.description` (case-insensitive substring). Pressing Escape clears the query and blurs the input; `⌘K` focuses it from anywhere.

---

## Drag-to-Reschedule

### Approach

HTML5 Drag and Drop API — no external library. Tasks in `UpcomingView` have a `draggable` attribute and a `⠿` grip handle that appears on hover (left of the done button). Day sections are drop zones.

### Optimistic update

On drop, `rescheduled` state (`Record<string, string>`) is updated immediately, overriding the task's `due_date` in the rendered list before the server action resolves. `updateTask(taskId, { due_date: newDateISO })` persists the change.

### Recurring tasks

Each occurrence is its own DB row. Dragging moves only that occurrence's `due_date`; the next spawned occurrence is unaffected. This is the correct behaviour: rescheduling "this week's review" doesn't shift future weeks.

---

## Priority-Colored Circles

The done/complete button circle in every task list view is colored by priority:

| Priority | Color |
|---|---|
| 4 — Critical | Red border + red tint background |
| 3 — High | Orange border + orange tint |
| 2 — Medium | Blue border + blue tint |
| 1 — Low | Slate/white border (neutral) |

`priorityCircleClass(priority)` is a local helper in each view file (`TaskList`, `UpcomingView`, `ProjectDetailView`). It's intentionally co-located rather than shared via a utility, because the exact class set is tightly coupled to each component's hover states.

---

## Color Themes

Choosing a color in Settings re-tints the **entire** UI — background, borders, muted labels — not just accented controls.

### Redefining `slate` instead of rewriting components

The app is written in ~1200 `slate-*` utilities across 26 files. Rather than replace them with semantic tokens, the **`slate` palette itself** is redefined in `globals.css` and remapped in `@theme`, so every existing `bg-slate-900` / `border-slate-200` / `text-slate-400` resolves through the theme. Picking a color re-tints everything with **zero component changes**; the whole feature is one CSS file plus the accent registry.

Each shade is `hsl()` built from a per-preset `--tint-h` (hue) and `--tint-s` (saturation), with **lightness values lifted verbatim from Tailwind's slate** — only the hue moves, so contrast ratios that already worked keep working. Per-shade saturation multipliers follow slate's own curve (stronger at the extremes, calmer through the midtones) so the result reads as a designed neutral rather than a colored wash.

`white` is deliberately **not** redefined: `text-white` sits on accent buttons and must stay pure. In light mode this means cards stay white on a faintly tinted ground; dark mode tints fully.

### One control, not two

The tint is driven by the **existing** `data-accent` attribute rather than a second setting. An independent theme control would allow clashing combinations (teal accent on a rose-tinted UI) and forces the user to make two decisions where they wanted one.

Verified in-browser, since the load-bearing assumption was whether Tailwind v4 honours overriding a built-in palette: it does — `bg-slate-200` resolves to `rgb(228,237,238)` under teal and `rgb(238,228,234)` under pink.

---

## Week Start

`user_scheduling_config.week_start_day` (0 = Sun, 1 = Mon, 6 = Sat) — migration `0006`. Settable in Settings → Smart scheduling.

### Reads degrade, writes don't

Every read goes through `fetchWeekStartDay()`, which uses `select('*')` and **falls back to Monday when the column is absent**, so the app works unchanged on a database where 0006 hasn't been applied. Only *saving* needs the column; the UI rolls the selection back and names the migration if the write fails. This is a deliberate response to the `weekly_target` rollout, where a missing column silently broke habit creation.

### One helper, five call sites

The week-start arithmetic was hand-rolled and hardcoded to Monday in `completeTask`, the scheduler, the habits page, the weekly review, and the Upcoming strip. It now lives in `src/lib/week.ts`:

- `weekStartOf(date, startDay)` — UTC `YYYY-MM-DD` of the week start
- `daysSinceWeekStart(dayOfWeek, startDay)` — the timezone-free half, for views working in local time
- `weekDayOrder(startDay)` — day indices in display order, for seven-across grids

Having one implementation matters beyond tidiness: if the boundary used when *recording* a completion ever drifted from the one used when *counting* it, weekly progress would be quietly wrong.

Everything follows the setting: the Upcoming week strip (and its prev/next nav), the 16-week habit heatmap (columns and row labels), the weekly review period, the analytics energy heatmap, and the working-hours / energy grids in Settings.

The **scheduling horizon stays rolling** 7 days from today. Aligning it to the week start would spend the already-elapsed days of the current week on the past, and the scheduler clamps slots to `now` — less planning, not more. Habit sessions are bounded to the current week via their `due_date` instead (see [Scheduling habits](#scheduling-habits)).

---

## Projects

### Creating and changing from where you are

`ProjectPicker` is a dropdown with inline creation, shared by the add-task modal and the task detail panel. Choosing "+ New project…" swaps the select for a name field and a colour row; creating selects the new project immediately.

Shared rather than written twice: both places need to pick a project *and* make one without losing what you're typing, and two copies of a create-then-select flow is two places for it to drift.

`createProject` returns the inserted row (it previously returned void) so the caller can select it without a refetch. The picker also keeps locally-created projects in state — the list arrives as a server prop and wouldn't include a new one until the page revalidates.

`onChange` hands back the `Project` object alongside the id, so a caller can update its own display at once. The detail panel's header badge reads from `task.project`, a joined snapshot that would otherwise show the old project until the panel was reopened.

The detail panel previously accepted a `projects` prop and never used it: a task's project was fixed at creation with no way to change it afterwards.

Habits don't get a project picker — they're deliberately project-less.

---

## Server / Client Component Split

**Default: Server Components.** Client Components (`'use client'`) only where:
1. Browser APIs are needed (timers, DOM events)
2. React state/effects are needed
3. The component is an interaction leaf (buttons, inputs)

### Mutation pattern

All mutations go through **Server Actions** in `src/app/actions/`. Components call them directly (no fetch, no API route). Server Actions call `revalidatePath()` to bust the Next.js cache.

```typescript
// In a Client Component:
import { updateTask } from '@/app/actions/tasks'

<button onClick={() => updateTask(id, { status: 'done' })}>
```

### Quick-add parsing (Claude API)

Natural-language task input is parsed server-side via `@anthropic-ai/sdk`. The result (`ParsedQuickAdd`) includes `title`, `due_date`, `estimated_minutes`, `energy_required`, `project_hint`, and `is_calendar_event`. The Claude call happens in a Server Action so the API key never reaches the client.
