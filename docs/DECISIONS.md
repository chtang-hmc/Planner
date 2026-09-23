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
10. [Add Modal: Compact vs Detailed](#add-modal-compact-vs-detailed)
11. [Quick Add: natural-language dates](#quick-add-natural-language-dates)
12. [Task Row Layouts](#task-row-layouts)
13. [Task List Views](#task-list-views)
14. [Inline Search](#inline-search)
15. [Drag-to-Reschedule](#drag-to-reschedule)
16. [Priority-Colored Circles](#priority-colored-circles)
17. [Projects](#projects)
18. [Color Themes](#color-themes)
19. [Week Start](#week-start)
20. [Tests](#tests)
21. [Server / Client Component Split](#server--client-component-split)

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
- `0015_task_due_time_and_completion_anchor.sql` — `tasks.due_time_minutes` (a wall-clock time beside the day, never inside it) and `tasks.rrule_from_completion` (`every!`)

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

### The list, and the week you can click (2026-09-21)

Five cards became five rows. Each card carried a header, three tiles holding
the same number on four of five habits, and a 16-week heatmap — 448 squares to
represent twelve piano sessions. What survives is what is acted on.

**The streak is computed, not read from `habit_streaks`.** That table is keyed
by `task_id` and a habit is a family of rows, so the id on screen is usually an
occurrence created *after* the completions being counted. On 2026-09-21 every
row in it said `current_streak: 1` — including Piano's, which had run fourteen
days. `habitStreak` derives it from the same completion days the dot strip
draws, so the number and the picture cannot disagree.

**Counted in the habit's own unit, and the unit is in the cell.** `14d` for a
daily habit, `1w` for a weekly-target one — consecutive weeks that met the
target being the only sensible reading of a streak for something done twice a
week. A column headed `STREAK` cannot say which of the two it is holding.

**Today's absence does not break a streak.** A daily streak counts back from
today when today is logged and from yesterday when it is not, so a habit you
have not got to at nine in the morning still reads as a streak rather than
resetting to zero and recovering at lunchtime. The same grace applies to the
current week.

**An anytime habit has no streak and no fraction.** `1/—` is not a number.
With no cadence there is nothing for anything to be consecutive in, so the
streak cell is `—` and the week cell is a plain count.

**Over-target keeps its true numerator.** `3/2` reads oddly as a fraction, but
capping it at the target would be lying about the week; the colour says the
target is met and the third session stays a fact.

**One list, in a stable alphabetical order.** The old page moved a habit into a
"done today" section the moment you logged it, so the row you had just aimed at
jumped elsewhere and the page reordered itself all day.

**The heatmap's useful half comes back as `This week`** — five habits by seven
days, every square a control. The heatmap could only be read; the common
failure is having done the thing and forgotten to log it, and there was nowhere
on the page to say so. `setHabitCompletion` already existed for it. A future
square is drawn but is not a button: the action refuses a future date, and a
control that is always rejected is a control that lies.

**The first column is the configured week start**, and the letters derive from
it. Monday was an accident of the reference drawing.

**The headline says what the table cannot.** `2 of 5 logged today · Gym and
Piano are already on the calendar today` — the rows each carry their own count,
so restating the total would be the heading reading the table back. It says
*on* today rather than *later* today deliberately: knowing whether a block is
still ahead means reading the clock during render, which is impure and would
have the server and the client disagree about the sentence.


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

### A due date is a day, never an instant

`due_date` stores a calendar day at UTC midnight. Two things follow, and the weekly review got both wrong:

- **Compare it as a day.** `due_date < new Date().toISOString()` marks a task due *today* as overdue the moment UTC midnight passes — mid-afternoon the day before on the US west coast. Compare `due_date.slice(0,10)` against the user's today instead.
- **Render it as a day.** Passing the whole instant to `toLocaleDateString` shifts it backwards west of UTC: `2026-09-16T00:00Z` is 5pm on the 15th in California, so a task due tomorrow displayed as today. Format `slice(0,10) + 'T12:00:00Z'` with `timeZone: 'UTC'` to get the day that was picked.

The list view already did this (`formatDue` compares local date strings); the review page and `ReviewView` were written before that and kept the instant comparison. Checked against real data: three tasks due the 16th read as overdue and dated the 15th, and every other due date displayed a day early.

Habit *completions* are different — those are real moments, filed under a day by timezone. See below.

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

### Settings fills the panel

`max-w-lg` with no `mx-auto` pinned every control to the left edge and left the rest of the width blank — the same thing Projects and Analytics were doing. Sections are now cards in a grid that breaks into two columns as the panel grows, rather than one column stretched to the window: a 1400px-wide row of radio buttons "fills the panel" and reads worse than the 512px it replaced. Scheduling spans both columns, since it holds a week grid and an hours table and was laid out to be wide.

The horizontal rules between sections went with the change. A divider only reads as a separator while the sections are in one stack; in a grid it is a line across the middle of nothing. The card edges do that job now.

### "Relevant" is two settings, not two constants

The task list's default filter answers "what am I doing now" rather than "what do I owe anyone, ever". Its two numbers — a seven-day deadline window, and priority 3 as the line an *undated* task must clear — were constants in `TaskList.tsx`. Both are judgement calls about how much of the future counts as now, and the right answer differs by how someone works: a week is a long horizon for errands and a short one for coursework. They live in `user_scheduling_config` (migration `0017`), alongside the week start day.

**The deadline and the priority are an `or`, and each rescues what the other would drop.** A Low errand due tomorrow is current because it is due tomorrow, not because it is important; a Critical piece of work due in three months is current because it is Critical, even though the date is far off. Priority was originally consulted *only* when a task had no date at all, so that second case — important work with a distant deadline — was hidden, which is the gap this closes. Requiring both instead would hide both, and they are the two things a person most often wants to see. What falls out is the genuine backlog: unimportant work that is neither soon nor undated-and-important.

The rule itself moved to `src/lib/relevance.ts`. It is the interesting part and the component is not — pulling it out is what made it testable, and `relevance.test.ts` pins each rule *and the order they run in*, because the order is where the meaning is:

- `someday` and an unopened "not before" gate disqualify outright, whatever else is true — including a calendar booking, since you still cannot start
- the calendar admits anything, however small or far off: booking something *is* the statement that you are doing it
- the deadline window and the priority bar are independent grounds; either alone is enough

Settings shows the rule back in the terms just chosen, live. "Relevant" is a word with no visible meaning until something goes missing from the list, and a filter that is on by default has to explain itself.

### Subtasks inherit from their parent

A subtask is part of one piece of work, so it takes the parent's **project**, **deadline**, **location**, **energy**, **priority** and **urgency curve**. All of them are set at creation and cascaded by `updateTask` when the parent changes; without the cascade they keep whatever was copied on day one and drift.

**Urgency is derived, not copied.** With the parent's priority, deadline and curve in place a subtask computes to the same score, and stays right when either input moves — `computeUrgency` ignores `created_at` entirely, which is what makes this safe. Copying the score itself is how it would drift.

Priority was the last input to join that list, and the delay was expensive. Subtasks were born at priority 1 with urgency 0, so a row could claim it did not matter while the thing it belonged to was due today: five Public Policy readings sat at urgency 10 under a parent at 80. Three separate readers grew a workaround for it — the scheduler resolving upward, `UpcomingView.dueDay()` falling back to the parent, the relevance filter checking the parent — and a fourth would have been needed for the Home page. Fixing the data removed the need for any of them.

The scheduler still reads importance from the parent on every run as belt and braces. It costs nothing and it is what kept this from being a visible bug.

The scheduler reads the deadline from the parent row on every run rather than trusting the copy, so a subtask can never be scheduled later than the thing it's part of even if the two fall out of sync.

**Views must not trust the copy either.** Upcoming files tasks by date and originally skipped any task with no `due_date`, so a subtask carrying null — one created before inheritance existed, or after the parent's date was cleared — appeared on no day at all. It vanished from that view while the list, which nests by `parent_id`, showed it correctly: five of six readings missing under "Public Policy Readings", which read as a nesting bug and wasn't one. `dueDay()` now falls back to the parent's date, matching what the scheduler already did. A subtask that *does* have its own date keeps it, so dragging one to another day still moves it.

**A subtask does not outlive its parent.** Completing a task closes every step still open underneath it — `completeTask` and the weekly review's `done` triage both cascade. Left pending they stayed in the list, kept their urgency, and, *because* they inherit the parent's deadline, went overdue under a parent that was already finished; the checklist that was the point of the parent became six rows of noise. Only pending steps are touched, so one already ticked off keeps its own `completed_at` and `actual_minutes`. They take the parent's close status rather than always `done`: a habit occurrence closed as `cancelled` by the duplicate-day guard did not record the day, and its steps must not claim to either. A failure to cascade is logged, not thrown — the task itself is already done, and throwing would tell the user their completion didn't land.

**Recurring work respawns without its checklist.** The next occurrence is the parent row alone; subtasks belong to the occurrence that was just closed out, not to the shape of the recurrence. Respawning them would resurrect steps already ticked off, week after week. `duplicateTask` *does* copy subtasks — a copy of a checklist without its items is not a copy — so the two paths differ deliberately.

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

## Quick Add: natural-language dates

Typing the date into the task — "Email Rosner tomorrow at 5pm" — the way Todoist does. `src/lib/quick-add.ts` finds the tokens, returns their source offsets so the field can highlight them where they were typed, and hands back the title with those spans removed.

### Deterministic grammar beside the LLM parser, not instead of it

The field already had a parser: `/api/parse-task` sends the text to Claude and fills in energy, project and an estimate. That stays, because a fixed grammar will never infer "deep work" from a phrase. But it is a network round trip behind a button, and the thing that makes quick-add feel like quick-add is watching the date light up *as you type*. So the two split by what each is good for:

- the grammar runs on every keystroke — pure, synchronous, free, and always the same answer twice
- **Enter** applies what the grammar found, with no network at all
- **✦ Parse** still calls the model for the fields the grammar has no opinion about

### Hand-rolled rather than `chrono-node`

`chrono-node` covers the date and time columns well and would have saved a day's work. Against it: the grammar also has to produce recurrence (`every monday` → an RRULE) and the metadata tokens, which chrono does not do at all, so half the input would be parsed by a library and half by us — two sets of offsets to reconcile for one highlight layer. And the timezone contract here is strict in a way chrono's reference-date API makes awkward to guarantee. One tokenizer that owns the whole string is simpler than a library plus a second parser, and the grammar is bounded — it is keyword-driven, not open-ended prose.

### Days are resolved as days, never by `Date` arithmetic

Every resolution runs on day strings through `lib/day`. This is the rule the module exists to protect: `new Date(Date.now() + 86400000)` gives the wrong "tomorrow" for anyone west of UTC in the evening, which is the same bug this codebase has already fixed in the habit heatmap, in Upcoming, and in the weekly review.

`dueISO` is **UTC midnight of the local day** — the `due_date` convention everything else relies on, since every comparison in the app does `due_date.slice(0, 10)`. A parsed *time* is returned as a separate `timeMinutes` and deliberately **not** folded into that timestamp: doing so would make a task due at 5pm in Los Angeles read as the following day.

There is nowhere to store a time yet — `tasks.due_date` is a day and there is no time-of-day column — so the field says the time was understood and that the task will be due that day. Recognising it and dropping it silently was the one option not on the table.

### Choices the grammar makes on purpose

- **A bare number is not a time.** `at 5pm`, `17:00` and `noon` are times; `at 5` is not. In "Read at 5 pages" the 5 is a quantity far more often than an hour, and silently scheduling the wrong time is worse than leaving it alone.
- **`next friday` is that weekday in the *following* week**, anchored on the configured first day of the week so it agrees with everything else that talks about weeks. From a Wednesday it coincides with plain `friday`; standing on a Friday the two differ, which is the case where treating them as synonyms would be wrong.
- **A month-day with no year means the next one to come round**, searching forward several years rather than one — `feb 29` is a real date whose next occurrence can be three years out.
- **The first date wins.** "Call mom monday about friday plans" takes only `monday`. One task has one deadline; a second date is nearly always part of what the task is about.
- **Anything unrecognised stays in the title.** `Buy Tomorrowland tickets` is a festival, not a due date, and `feb 30` is declined rather than rounded to the 28th.

### The highlight is two layers, and they must lay out identically

`QuickAddInput` stacks a transparent textarea over a backdrop that renders the same string in transparent ink — the backdrop contributes only the coloured rectangles, the visible glyphs are always the textarea's. Any difference in font, size, line height, padding or border between the two shows up as highlights drifting off their words, worse the further down you read, so the box metrics are written once and shared. The background sits on the *backdrop*: an opaque textarea would paint over the very highlights it is meant to reveal.

### The reference page is public and computes itself

`/help/quick-add` — exempted in `src/proxy.ts` alongside the auth routes. It documents syntax and holds no data, and a page you must log in to read is a poor place to explain how to type into a box.

Every example in its tables is resolved by calling `parseQuickAdd` in the reader's own zone as the page renders, rather than being written out by hand. A table that *claims* "friday → the next Friday" goes stale the moment the grammar moves; this one can only be wrong if the parser is wrong, in which case it is showing a real bug rather than hiding one.

### Recurrence produces RRULE strings the app already speaks

`every monday` becomes `FREQ=WEEKLY;BYDAY=MO` — a bare `FREQ=…` string with no `RRULE:` prefix, which is exactly what `tasks.rrule` stores and what `rrule-utils` accepts. Where a phrase names one of the presets in `PRESETS` the string is **byte-identical**, so the recurrence picker shows "Every Mon" rather than falling back to "custom". The grammar is a second way to reach the picker's settings, not a parallel set of them. `every 1 week` deliberately drops `INTERVAL=1` for the same reason: a redundant parameter would miss its preset.

A test round-trips every string the grammar can emit through `getNextOccurrence` — the helper `completeTask` uses to spawn the next occurrence — because a rule that parses but cannot advance would fail silently, one completion later.

### Recurrence is scanned before dates, and that order is load-bearing

"every monday" contains a weekday; "every jan 27" contains a date. Letting the date scanner run first would strand a bare "every" in the title and set a one-off deadline where a repeat was asked for. Each pass masks its span before the next runs, so the three scans — recurrence, date, time — cannot read each other's digits.

### A repeat sets its own first occurrence, inclusively

`every monday` is due the coming Monday, not undated. The day is asked of the rule itself via a new `getFirstOccurrence`, so one implementation answers "when does this fire" — and asked **inclusively**, which is the difference from `getNextOccurrence`: that one is strictly *after* its anchor because it answers "the one after the one just completed". Typed on a Monday, `every monday` has to mean today; using the strict helper would push it a week out and quietly lose a session.

An explicit date always wins, which is what makes `every day starting friday` mean what it says. `starting`, `start`, `starts` and `from` joined `by`/`on`/`before`/`due` as date prefixes.

### `every!` counts from completion (migration 0015)

Todoist's `every! 3 days` advances the chain from when the task was *finished* rather than from when it was due. Watering the plants every three days means three days after you last watered them; a fortnight away should not come back as four missed waterings.

This cannot live in the rrule string — iCal has no way to express it. It is a property of how *this app* advances a chain, not of the rule, so it is a column: `tasks.rrule_from_completion`, defaulting to the existing behaviour.

`completeTask` picks the anchor accordingly:

```ts
const anchor = taskRow.rrule_from_completion
  ? new Date(completedDay + 'T00:00:00Z')          // the local day it was finished
  : (taskRow.due_date ? new Date(taskRow.due_date) : today)
```

Due-date anchoring stays the default, and stays **correct** for anything with a real deadline: rent is due on the 1st however late you paid last month. The difference only shows when you fall behind, which is exactly when it matters — `src/lib/recurrence-anchor.test.ts` pins both, side by side, because "due 1 Sep, every 3 days, finished the 14th" returns **4 September** under the default, a date already a fortnight past.

The flag is carried forward on every spawn. Without that the second occurrence would silently revert to due-date anchoring, and the bug would only appear one cycle in.

### A due time is a deadline, not an appointment

The scheduler treats `due_time_minutes` as the instant the work must be *finished*, not the instant it starts. "Due at 5pm" says when the thing is wanted; placing the work at 5pm because of it would stop the scheduler putting it anywhere earlier, which is usually exactly where it belongs. A chain is bound by its strictest member's hour, the same way it already is by the earliest deadline.

**Adding it exposed a latent bug.** The placement loops tested a candidate's *start* against the deadline. While `dueMs` was always the end of the due day that was the same test — a day boundary sits well past working hours, so nothing could begin inside the day and end after it. A mid-day deadline makes the two differ: a 90-minute session starting at 9 against an 11am deadline begins in time and finishes half an hour late. All three sites now bound the end — the single-task loop, the chain run (which also caps its length at the deadline), and the fixed-offset sequence, where it is the *last* stage that has to land in time rather than the first.

### A time of day lives beside the day, never inside it

`tasks.due_time_minutes` — minutes from local midnight, 0–1439, NULL for all-day.

It is deliberately *not* folded into `due_date`. That column is a `timestamptz` the whole app treats as UTC midnight of the local day: every comparison does `due_date.slice(0, 10)`. Storing the real instant of "5pm in Los Angeles" there would make it read as the following day — the bug class already fixed three times elsewhere in this codebase.

Minutes-past-midnight is also the right *type*. A wall-clock time is timezone-independent by nature: "due at 5pm" means 5pm after a move or a DST change, which an instant would not. `formatDue` appends it and deliberately does not let it affect the tone — a task due at 9am today reads as due today at half past nine, not overdue. The scheduler does not yet treat it as a fixed appointment; that is a separate decision about pinning.

### `p1` is Critical — the typed convention beats the stored one

`pN` follows **Todoist**: `p1` is the most urgent and stores priority 4; `p4` stores 1. The inversion lives in one table, `PRIORITY_FROM_TOKEN`, so there is exactly one place to look when the two numbers disagree.

This was decided the other way first, and changed. The argument for matching the stored scale was real: the add-task form numbers its priority buttons 1–4 with 4 as Critical, so typing `p1` now lights up the button marked `4`. But `pN` is a *borrowed* idiom, and people arrive with `p1` meaning "drop everything" — a grammar that silently means the opposite of the habit it borrows is a worse trap than a number disagreeing with a button elsewhere in the same form.

The help page states the mapping outright rather than leaving it to be discovered, and the token chip shows the *stored* word ("Critical") rather than echoing the digit, so the inversion is visible before the task is created rather than after.

**The button labels are the remaining inconsistency.** Showing `Low / Med / High / Crit` instead of `1 2 3 4` would remove it at the source; the numbers are currently only a tooltip away from their names.

### `#project` never creates a project

Matching is case-insensitive, and a unique prefix is enough — `#teach` finds Teaching. Two things deliberately do *not* happen: an ambiguous prefix does not pick one, and a name that matches nothing does not create it. Both leave the token in the title, visibly doing nothing, which is the same contract the rest of the grammar keeps (`feb 30` is declined rather than rounded).

Creating on a typo would be worse here than elsewhere: the add flow has no undo, so a mistyped `#Tecahing` would leave a permanent second project behind. `#{Public Policy}` handles a name with spaces, since otherwise there is no way to tell where the name stops and the task resumes.

### Metadata is scanned before the date grammar

The same discipline as recurrence-before-date, for the same reason. `#{4th floor}` contains an ordinal the monthly-repeat rule would claim; `for 2h` contains a bare number. Each pass masks its span before the next runs, so no later rule can read a digit that already belongs to something else.

### Staged

Dates, times and recurrence are in, and both are now stored. `#project`, `p1`–`p4` and `for 45m` are not. Their token types are already declared in `TokenType` and already have highlight colours, so adding them changes no consumer contract.

---

## Reading browser-only values

`src/lib/use-stored.ts`. `localStorage`, the resolved timezone and "has this hydrated yet" are all things the server cannot know, and the obvious approach — default state plus an effect that overwrites it on mount — renders once with a value known to be wrong and then again with the real one. `useSyncExternalStore` does it in a single pass React understands.

The idiom had been written out by hand in five places before it was extracted. The extracted version adds a **real subscribe**, which the hand-rolled copies did not have (they passed `() => () => {}`), and that changed the shape of the settings sections: they had carried each preference in local state *as well as* in `localStorage`, keeping the two in step by hand, because a no-op subscribe meant writing storage did not re-render anything. Now `writeStored` notifies and there is one source.

Subscribing also picks up the `storage` event, so two windows of the app stay in step for free.

**Snapshots must be primitives.** React calls the read on every render and compares by identity, so a fresh object each time is an infinite loop. `Sidebar` packs its width and collapsed flag into one string for exactly this reason.

### Both React-compiler rules are errors now

`set-state-in-effect` and `purity` were warnings while ten instances were outstanding, which meant they blocked nothing and were read by nobody. Every instance is now fixed or disabled inline with a reason at the site, so the rules can catch the next one.

What stays disabled is the handful the rules genuinely cannot distinguish: resetting state when a prop changes (`FloatingTimer` clearing its reflection panel when the timer goes idle, `SearchModal` clearing the last query on open — where the reset belongs with a DOM focus call that has to be in an effect anyway), and `Date.now()` in an async Server Component, which renders once per request.

### Unused-variable warnings, narrowed to discards

`varsIgnorePattern: '^_'` exempts the deliberate strip-fields-by-destructuring idiom (`const { id: _id, ...shape } = row`) and nothing else. Twelve genuinely dead bindings were hiding behind the un-narrowed rule — unused imports, a superseded `useState`, a prop `ProjectCard` never read — and were deleted.

## Icons

`lucide-react`, reached only through `src/components/icons.tsx`.

Emoji were doing this job and doing it badly for anything ordinal. The five energy faces (😴 😔 😐 😊 ⚡) are five unrelated pictures the reader has to rank from memory, and whether 😔 reads as lower than 😐 depends on the platform's font — poor encoding for a value whose entire meaning is its order. They also sat at whatever size the surrounding text happened to be, so the same meaning was a different weight in each of the six files `ENERGY_ICON` had been copied into.

**One module is the whole dependency surface.** Nothing else imports `lucide-react` except for a handful of one-off glyphs, and icons are re-exported under the app's own names — `RecurringIcon`, not `Repeat` — so a call site reads in this app's vocabulary rather than the icon set's. If the set is ever swapped, that file is the diff.

**Ordinal values get a ramp, not a set.** The 1–5 energy scale is one glyph at five opacities (`ENERGY_RAMP`), which is ordinal by construction and matches what Analytics already does with the same numbers (`ENERGY_OPACITY`). The three-level task scale keeps Leaf → Zap → Flame, because that reading was already in people's heads from 🌿 ⚡ 🔥.

### What is not an icon

**The typographic marks stay**: `✓ ✕ ↻ ↗ ⌂ ◎ ↳ ↵`. They are a deliberate language, they align on the text baseline in a way an SVG does not, and they are not pictographs pretending to be data. A global replace caught the location options (`◎ ⌂ ↗`) by accident once — they are marks, not emoji.

**The Google Calendar prefixes stay emoji**: `🎯` for planned work, `✓` for a finished session. They are the *title text of a real calendar event*, rendered by Google's clients — an SVG cannot go there, and changing the glyph would leave every event written afterwards inconsistent with the ones already in the calendar.

## Settings: simple and advanced

Two tabs, not two routes. Settings is one sidebar entry, and a second one for "Settings (advanced)" would put the split in the navigation — read on every page, to answer a question you only have while inside Settings. The choice is remembered, because whichever half you use is the half you keep returning to.

The split is **how it looks** against **how it decides**:

| Simple | Advanced |
|---|---|
| Appearance, colour theme | Relevant tasks |
| Default view, task layout | Working hours, energy grid |
| Google Calendar connection | Session length, buffers, breaks, week start |

Google Calendar sits in Simple despite being the most technical thing there: it is a *setup* step you do once and then never touch, which is exactly what Simple is for. Relevance sits in Advanced despite being two numbers, because changing it silently changes what the task list shows — the kind of thing that should be somewhere you went on purpose.

Unlike Analytics, this grid keeps `items-start`. Its cards hold genuinely different amounts, and stretching a three-option radio group to match a working-hours table gives it a field of empty space rather than a matching neighbour.

## Calendar sync

### It syncs on its own, and the table stops growing (2026-09-23)

Two problems that presented as one. A deleted event still showing on Home was
reported as a sync bug; the sync was fine by then, it had simply not run.

**Nothing pulled the calendar on a schedule.** The only triggers were the OAuth
callback on first connect and the `refresh` link on Home, so Home could show a
day that changed hours ago and the only hint was a "synced 36m ago" label
nobody reads as a warning. `/api/cron/sync-calendar` runs it hourly via
`vercel.json`.

**The cron route authenticates itself**, because a scheduled request carries no
session and the edge gate would bounce it to `/login`. `proxy.ts` exempts
`/api/cron/` by exact prefix and every route under it must do its own check;
this one compares `Authorization` against `CRON_SECRET` and **refuses
everything when that variable is unset** rather than defaulting open. It also
returns 200 on a failed pull: Vercel retries nothing, and an expired Google
token should not read as a broken deployment.

**Retention, not a cleanup script.** The window only moves forward, so a row
that falls behind it is never asked about again — it cannot be reconciled,
corrected or removed by any later sync. There were 72 such rows against 118
live ones. Every query over `calendar_events` is bounded at today or later, so
nothing reads them.

Each sync now expires rows whose event *ended* before the window starts —
judged on the end, so a meeting running into the window survives. **Rows a task
is linked to are kept regardless**, because `task_event_links` cascades and a
confirmed link is a decision made by hand; reclaiming a row nobody reads is not
worth destroying one. Dry-run against the live table: 71 expired, 0 kept for a
link, 119 remaining.

A rule rather than a script, because a script is a thing you have to remember
to run and this is a thing that keeps happening.

### The sync deletes now, and had to learn to paginate first (2026-09-23)

Reported: events deleted in Google still showed on Home. They did — the sync
only ever upserted. Nothing removed a row, so a deleted event stayed in
`calendar_events` for good. Measured against the live calendar the day this was
written: Google returned 120 events for the window, the table held **150**, so
**31 were phantoms**.

Google does not report deletions. With `singleEvents=true` a deleted event is
simply absent, so the only way to see one is to compare the whole window
against what came back.

**Pagination came first, because it had to.** The pull asked for
`maxResults: 250` and took whatever arrived. That was survivable while the sync
only added — a truncated page meant a few missing events until next time. It
stops being survivable the moment the sync deletes, because a truncated
response is indistinguishable from "the user deleted the rest". `complete` says
whether the last page really was the last one, and reconciliation is skipped
when it was not.

**Three things the deletion refuses to do:**

- Touch anything outside the window that was fetched. Rows beyond ±7/+30 were
  never asked about and their absence means nothing. The local filter is on
  `start_time` while Google filters on overlap, which makes the two disagree at
  the edges — always in the direction of deleting less.
- Touch a row from another `source`.
- Run on an empty or incomplete response. `task_event_links` cascades on
  delete, so a fluke empty page would not merely drop a cache: it would discard
  hand-confirmed task↔event links, and the next sync would re-add the events
  under new ids with nothing pointing at them. An emptied calendar is the one
  case this will not reconcile, which is rarer than a bad response.

**The links that do cascade are supposed to.** Three of the four confirmed
links pointed at events in the stale set. A link says "this event covers this
task", and it stops being true when the event is gone — `capacity()` should
stop excluding those minutes, which is exactly what the cascade produces.

`staleEventIds` is a separate pure function, tested, rather than a
`not in (…)` filter. The ids are Google's strings and that filter has to be
built by concatenating them into a quoted list, which is the shape of a
problem; and a query cannot be unit-tested while a function can.

## Deployment

### Vercel, single-user, `planner-nine-snowy.vercel.app` (2026-09-22)

Hosted on Vercel because it is a Next app and there is one user; Supabase keeps
holding the data and the nightly pg_cron jobs, so nothing needed a worker.
`next build` had **never been run anywhere** — CI did types, lint and tests
only — so the first thing was to run it. It passed. It is now a CI step, with a
throwaway `NEXT_PUBLIC_SUPABASE_*` pair because those are inlined at build time
and the build needs *a* value; nothing the app talks to is configured there.

**Two fire-and-forget calendar syncs had to become `after()`.** Both OAuth
callbacks kicked off `syncCalendarEvents()` without awaiting, which is fine on
a long-running server and silently killed on a serverless one — the function is
frozen the moment the response goes out. `after` is the supported way to say
"once the response is sent".

**`/auth/design` is not in production, and already was not.**
`src/app/auth/design/page.tsx` calls `notFound()` when `NODE_ENV` is
`production`, so the route matches, renders nothing, and returns 404. Worth
knowing before anyone tries to check a component on a real phone against the
deployment: it will not be there. The page is a development tool and reachable
only from a dev server, including over the LAN.

### Closing the gate, before the URL was public

The deployment made two long-standing weaknesses matter.

**`pathname.includes('.')` meant "this is a static file".** That is true of
`/logo.png` and equally true of `/projects/anything.else`, and the test returned
*before* the session and owner checks. Verified against the live deployment:
`/projects/a.b` returned 404 from the page itself with nobody signed in, having
already queried the database with the service-role key, while `/projects/abc`
redirected to `/login`. Nothing was exploitable — the only dynamic route takes
UUIDs and a UUID has no dot — but that is luck, and it expires the first time
someone adds a route with a slug. It is an extension allow-list now.

**`ALLOWED_EMAIL` was checked in one place, and 63 service-role call sites
trusted it.** The middleware was the only thing between a signed-in stranger
and everything, because service role bypasses RLS and the policies are
`using (true)` (see #82). The check now also runs in the OAuth callback, which
is the single place a session can be issued: a wrong email is signed straight
back out and never holds a cookie. The middleware check stays as the second
line rather than the only one. Signing out matters — without it the cookies are
already set and only a redirect stands in the way.

This is not multi-tenancy and does not pretend to be. It makes a middleware
failure survivable; #82 is the real fix.

## Signing in from somewhere other than this machine

### The login page does not depend on hydration (2026-09-22)

The sign-in button was a client component calling the server action from
`onClick`. That works only once React has hydrated; when it has not — a phone
on a flaky connection, a chunk that did not arrive, anything that throws during
hydration — the button is inert and the page has no way to say so. The reported
symptom was exactly that: tap, nothing, no error.

It is a `<form action={signInWithGoogle}>` now. With JS, Next intercepts and
posts it; without, the browser posts it natively and follows the 303 itself.
Verified over the LAN address with no JavaScript involved at all: a plain POST
returns `303 See Other` to Supabase with
`redirect_to=http://172.28.151.110:3000/auth/callback`.

The one page you cannot get past when it fails should be the page that needs
the least to work. `useFormStatus` still gives the pending label when there is
JS, and the failure message moved from `useState` to the `?error=` the callback
already redirects with — a state variable does not survive the full page load
that a native form post causes.


### Both OAuth legs read the same origin, from the headers (2026-09-22)

`lib/request-origin.ts` is the one definition, because two places need it and
they have to agree: the sign-in action builds `redirectTo` from it, and the
callback builds the address it sends you to after the exchange. If they
disagree you are sent to Google from one host and returned to another — a
sign-in that completes and then lands nowhere.

**The callback used `new URL(request.url).origin` and that was wrong.** On a
request to `http://172.28.151.110:3000/auth/callback` it resolved to
`http://localhost:3000`, so signing in from a phone would have succeeded and
then redirected to the laptop. Found by curling the callback across hosts
before claiming the flow worked, not by anyone hitting it. `request.url` has
been through Next; the headers are what the browser sent.

Verified on all three shapes, both legs:

| host | `redirectTo` | callback returns to |
|---|---|---|
| `localhost:3000` | localhost | localhost |
| `172.28.151.110:3000` | the LAN address | the LAN address |
| forwarded headers | the tunnel host, over https | the tunnel host |

### The OAuth return address comes from the request (2026-09-22)

`redirectTo` was `NEXT_PUBLIC_SITE_URL`, baked in at build time as
`http://localhost:3000`. Open the app from anything that is not the machine
running it — a phone on the same network, a tunnel — and signing in sent you
to *your own* localhost, which is nothing. `siteUrl()` reads
`x-forwarded-host` / `host` instead, so the return address is wherever you
actually asked from. Verified against all three shapes: localhost, a LAN
address, and forwarded headers standing in for a tunnel.

**The host header is attacker-controllable and this is deliberately not an
open redirect.** Supabase refuses any `redirectTo` outside the redirect
allow-list configured on the project, so the allow-list is the control — one
list, checked server-side, rather than an env var per host. Adding a host to
that list is a dashboard step and the only remaining manual one.

**Google never sees the app's own host during sign-in.** The flow is app →
Supabase `/auth/v1/authorize` → Google → Supabase's own callback → back to
`redirectTo`, so the only URI registered with Google is Supabase's. The
separate calendar-write flow in `src/app/api/auth/google/` is not like this:
it hands Google `GOOGLE_REDIRECT_URI` directly, that URI is registered in the
console, and Google rejects private addresses — so *granting* calendar write
only works from localhost. Tokens already granted keep working everywhere,
which is why this does not block using the app from a phone.

## Navigation

### Below 640px the sidebar is replaced, not shrunk (2026-09-21)

236px of a 390px viewport, and its collapsed rail is still 56px of furniture
on a screen that has none to spare. `MobileTabBar` takes over below
`--bp-narrow`: five destinations at 62px, in the column rather than fixed over
it, so a page's last row is never hidden underneath.

**Five tabs, and which five.** Today, Tasks, Habits, Projects, Insights — the
comfortable maximum at 390 and exactly the set that earns a permanent slot.
Review is a weekly ritual rather than a daily destination and keeps its link at
the top of Insights. Settings is a gear in the top bar, shown only below 640
where the sidebar that holds it is gone; it was never a peer of Today and
Tasks.

**The sidebar's project list does not come with it.** It is a workload glance,
not navigation, and the Projects tab carries the same information with room to
read it.

### The tab bar was rendered and off the bottom of the screen (2026-09-23)

Reported after the first phone session: no row of five icons. The CSS was
right — `.narrow\:flex{display:flex}` inside `@media (min-width:640px)`, so
the sidebar hides and the bar shows below 640 — and the component was in the
tree. It was simply below the fold and unreachable.

`h-screen` is `100vh`, and on iOS Safari `100vh` is the viewport with the
browser chrome **retracted** — roughly 110px taller than what is visible while
the URL bar is showing. The shell is `overflow-hidden`, so the bottom 110px is
not merely off-screen, there is no way to scroll to it. The tab bar lives
exactly there.

`.app-shell` uses `100dvh`, which tracks the visible viewport. The fallback is
an `@supports` block rather than two `height` lines in one rule: **the minifier
collapses duplicate declarations and keeps the last**, so a plain `100vh;
100dvh;` pair shipped as `100dvh` alone and a browser without `dvh` would have
got no height at all. Confirmed by grepping the production bundle both ways.

Worth remembering for the next one of these: emulating 390px in a desktop
browser does not reproduce it, because desktop `100vh` is the visible height.
Nothing short of the real device would have found this.

### The shapes that existed and were never reached

Building the chrome exposed two components whose narrow form had been written
and then never rendered:

- **`TaskRow`'s narrow shape was behind a prop nothing passed.** At 390 every
  row drew the wide form — about 170px of fixed columns against a ~343px
  viewport, leaving two words of title. Which shape to draw is a viewport fact,
  so it is a media query now; the prop survives as a *force* for
  `/auth/design`, which shows both at one width.
- **`CapacityBand` kept its action beside the headline.** `flex-wrap` alone did
  not help: the headline is `min-w-0 flex-1` and the action `shrink-0`, so the
  action kept its width and the sentence wrapped to one word a line. It is a
  column below 640 with a full-width primary, per A2.

The lesson is the same both times: a narrow form that no caller selects is a
narrow form that does not exist. `ProjectTable` and `ds/TaskRow` now both pick
their own shape from the viewport, which is the pattern to copy.

### Page titles are two sizes

`.page-title` in `globals.css`, 24px below 640 and `--text-display-m` above —
the handoff's narrow boards draw 26px where the wide ones draw 34, and 34px of
serif on a 390px screen is a headline rather than a title.
`.page-title-today` takes `--text-display-l` at width, which is the one page
the boards set larger.

## Page titles

### One treatment, and it is the display face (2026-09-21)

Reported: the Tasks title does not match the other pages. It did not — there
were four treatments across eight headers.

| page | was |
|---|---|
| Home, Tasks | `text-lg font-semibold` — 18px sans |
| Upcoming | `text-xl font-bold` — 20px sans, **inside** the Tasks page |
| Review, Settings | `text-sm font-semibold` — 14px sans |
| Projects, project detail, Habits, Insights | `text-display-xs display` — 23px serif |

Every board in the handoff sets its page title in Instrument Serif at 34px, and
Today at 38px. All eight now do: `display text-display-m`, with
`text-display-l` on Today. The three redesigned pages were wrong too — I had
set them at `display-xs`, which is the size for a finding headline, not a page.

**`September 2026` is not a page title.** It was an `h1` at 20px bold, nested
inside the Tasks page's own `h1` at 18px — two competing headings on one
screen, with the subordinate one larger. It is where you are in a scroll, so it
is now an `h2` at 15px.

This is the kind of drift no test catches and nothing fails over. `.display` is
one class and the sizes are four tokens; the only way they stay consistent is
that every page title uses them.

## Task Row Layouts

The task list draws a row four ways, chosen in **Settings → Task list layout** and stored per browser in `localStorage['planner-task-layout']`.

| Layout | Density | What it is | Leaves out |
|---|---|---|---|
| **Rail** (default) | compact | One surface, hairline dividers, priority as a left edge shown only for high and critical. Metadata on a single muted line. | — |
| **Ledger** | compact | Fixed columns under a header, so attributes line up down the page. Densest; best for "what's due soonest". Subtasks indent inside the title cell only, so columns stay true. | Energy — no column for it without crowding the title |
| **Airy** | spacious | Generous rhythm, larger title, metadata demoted to a quiet second line. About half the rows per screen. | — |
| **Editorial** | spacious | Large titles, project as a small uppercase label plus a hairline of project colour in the margin, deadline top-right in small caps. | Energy — the metadata line is kept to three items |

### Where they live

- `src/lib/task-layouts.ts` — the registry: ids, labels, descriptions, `omits`, and the localStorage helpers. No JSX, so both the settings page and the list can import it.
- `src/components/TaskRowLayouts.tsx` — the four implementations and `TASK_LAYOUT_IMPLS`. Each exports a `Shell` (container, plus a header for Ledger) and a `Row`.
- `src/lib/task-format.ts` — `formatMinutes`, `formatDue`, `dueToneClass`, shared so a duration reads identically in all four.
- `src/app/(app)/tasks/TaskList.tsx` — decides *which rows exist and in what order*; the layout decides what one looks like.
- `/auth/design` — preview endpoint. `?layout=rail|ledger|airy|editorial` isolates one. Under `/auth` because the proxy lets that prefix through without a session, which is the only way to look at the list in a browser that isn't logged in. It renders the shipping components against fixtures, not copies of them — a preview that drifts from the app is worse than none.

### The cost, accepted deliberately

Four layouts means four row implementations, and every feature that touches a row has to be built four times — the fold toggle, the subtask count, the parent breadcrumb, the someday and recurring tags all exist once per layout. That was raised as an argument for one layout plus a density setting and a date-grouping option, which would have covered the same ground from one component. The owner chose to keep all four; this is a single-user app and the preference is theirs.

**`TaskRowProps` is the contract.** Everything a row can show arrives through it, so adding a field makes the compiler point at each layout that hasn't handled it. If a layout should skip it, add a line to that layout's `omits` so the settings page says so.

### The toolbar and the habits section

The rows were redesigned first; the chrome around them followed, in the same language.

**One control idiom.** The filter row used to sit in its own band below the header and mixed three ways of saying "this is a control" — a segmented group, a bare `<select>`, and toggle pills, each with its own height, radius and border. `CONTROL` in `TaskChrome.tsx` is now the shared shell, with `Segmented` for mutually exclusive choices and `Toggle` for on/off filters. Accent means a control is actively changing what you see; everything else stays neutral.

**Actions grouped with actions.** Plan and Schedule week started in the filter row. They aren't filters, and at full width they wrapped onto a line of their own holding nothing else. They now sit beside Add task in the title row: things you *do* on top, ways of *looking* below.

**Habits stopped being a different app.** The section was violet-bordered cards with emoji buttons, sitting under a list of neutral hairline rows. It's now the same surface as Rail — one container, hairline dividers, neutral circle, "Log time" appearing on hover. The weekly dots survived because they're genuinely information-dense, but they use the accent rather than violet, and only when the target is met. The streak reads "12 days running" instead of a flame.

`TaskChrome.tsx` exists so these can be rendered against fixtures at `/auth/design` — the app can't be opened in a browser without a session, and a redesign you can't look at is one you're guessing at.

### Upcoming uses the same rows

Upcoming had its own `TaskRow`, so switching between List and Upcoming changed what a task looked like. It now renders the selected layout too.

**`Row` without `Shell`.** A day section is already a bordered card; nesting a layout's own container inside it would double the border, and Ledger would grow a column header per day. The day supplies the dividers instead.

**Horizontal padding moved from the row to the shell.** Airy bled its hover highlight outside its own box with `-mx-3`, which works in a container-less list and gets clipped by a day card's `overflow-hidden`. The row now carries its padding and the shell cancels it, so a standalone list still sits flush with the page and a row dropped into any container behaves.

**Dragging wraps the row rather than living inside it.** It is specific to this view, and putting it in `TaskRowProps` would mean building a drag handle four times for one caller. The row-level drag handle is gone; the whole row is the grip.

### Upcoming's day sections (2026-09-20)

`DaySection` draws the day; `UpcomingView` supplies what goes in it. Three calls worth keeping:

**Tasks are passed as `children`, below the timeline, not merged into it.** The timeline is *when the day happens* — events, and the free slots between them, in clock order. A due task mostly has no time at all, so it has no place on that axis; forcing one would mean inventing a start. They are also what you drag between days, which is the reason this view exists, so they stay rows the caller owns and the drag handlers keep working untouched.

**All-day events get their own row above the timeline** (`DayAllDayModel`). Sorting one by its UTC-midnight start would file "Fall break" before the first working hour of every day, and the clock column would have to print a time it does not have. It prints `all day` instead.

**Collapse state is local component state, not a setting.** Today and tomorrow open; the rest collapse. It is a reading position, not a preference — it should reset when you come back tomorrow, and a persisted one would mean a day you opened in March is still open in April.

**The day's unplaced footer is not drawn here.** `unplacedCount` is passed as 0. Saying a task has nowhere to go requires the packer's answer, which is Triage's; counting "due and unscheduled" here would call a task unplaceable that fits the very next gap the section is drawing.

### Sidebar: collapse and resize

Width and collapsed state live in `localStorage` (`src/lib/sidebar-prefs.ts`), read the same way as the task layout — the server renders the defaults, `useSyncExternalStore` swaps in the stored values on hydrate, and anything changed since load is held in an override.

- **Collapsed** is an icon-only rail (56px), not a hidden sidebar: nav glyphs, project colour dots and settings stay reachable, each carrying its label as a `title`. The project heading and the energy logger have no useful rail form and are dropped.
- **Resize** drags a 6px grip on the right edge, clamped 168–400px. 168 is where project names stop being readable. Double-click resets to 208, the width it always had; arrow keys move it 16px at a time, so the grip is not mouse-only.
- Pointer events, not mouse events, so a trackpad or pen drags too. The listeners are on the window because the pointer leaves a 6px grip almost immediately and a handler bound to the grip would stop receiving moves. Cursor and `user-select` are set on `<body>` for the duration so they survive the pointer crossing other elements.
- The drag measures from the sidebar's **own left edge**, not from `clientX` alone. They are identical in the app, but assuming x=0 makes the component work in exactly one position and misbehave anywhere it is previewed or embedded — which is how the bug showed up.

### Insights, and the three charts that went (2026-09-21)

Analytics is Insights. The route stays `/analytics` — renaming it means
touching five `revalidatePath` calls and breaking any bookmark to buy nothing;
the name the user reads is the sidebar label.

**Three charts deleted, for one reason.** The estimate-accuracy donut (50% from
four samples), the urgency histogram (its one finding is now a card) and the
seven-day energy chart (five bars between 2.0 and 3.0) all drew a picture of
data too thin to carry one. `thinData` says the same thing in words, with how
close the threshold is.

**If a finding cannot name a number, it is not a finding.** Each of the three
cards returns null rather than render a hedge, and the page shows what
survives. On 2026-09-21 that is two: Research sits at 32%, below the 35%
concentration threshold, so that card stays silent — the same rule the project
table uses, so the two pages cannot disagree about whether it is worth
mentioning. A page with one card on it is telling the truth about how much it
knows, and the no-findings state is a sentence rather than an apology.

**The capacity card is null, not zeroes, on a day off.** A day with working
hours switched off and a day with no calendar connected both produce
`free = 0`, and "today holds 10h of work and 0h of time" is a finding about
your settings, not your workload.

**One stacked bar replaces seven project bars.** Each of those was scaled to
itself, which made the only comparison worth having — how the whole is divided
— the one thing you could not read. Inbox gets a real `done %` in the table:
C7 settled that it is not exempt from `done / (active + done)`, and the
reference board's `—` there was wrong.

**No range control.** The design drew `This week / Month / All time` and never
decided what they did. With no `daily_capacity` history only one window is
honest, so two of the three would lie. When the history exists the page splits
— a Today band outside the range entirely, and a ranged section where the range
*recomputes* the findings rather than re-scoping the same three.

**Review's permanent entry point is here.** It is a weekly ritual rather than a
daily destination, so it does not earn a narrow tab slot — but acting on
findings is what it is for, which makes the top of this page its home.

### Analytics — the previous pass, superseded above

Six chart components each carried their own copy of the card shell — border, radius, padding, heading — so they had already drifted between `tracking-wide` and `tracking-wider`. `Panel` is now the one shell, with `Empty` for the no-data state.

**Colour encodes magnitude, not category.** Urgency buckets were slate / slate / amber / orange / red, and energy was slate / orange / amber / emerald / teal. Both are *one scale*, so five unrelated hues made the colour say "which category" when what it encodes is "how much". Each is now a single hue deepening across the range: red for urgency, the accent for energy, in the bars and the time-of-day heatmap alike.

**Four stat boxes became one strip** divided by hairlines, with 2xl numbers instead of 3xl. Two of the four were tinted for decoration; only average urgency keeps colour, because it is the one number there that is telling you to act.

**Project workload reads across, not down.** Name, bar and figures on one line with the track capped, instead of a full-width bar stacked under its label — past 1200px that was a very long hairline saying very little, with the name and its numbers at opposite ends of the screen.

Bars throughout are slimmer, capped in width, square-cornered rather than heavily rounded, and sit on a real baseline.

### Calendar panel

Restyled to the row language: hairline-separated events on one surface instead of a filled, bordered box per event; 13px titles with 11px muted times; the same uppercase micro-label and day dividers as the Habits section. The `📅` prompt and the `↺` / `✕` glyph buttons became words.

**Disconnect hides until the header is hovered.** Spelling it out made a destructive, rarely-wanted action louder than Sync, which is the opposite of what the glyph version achieved by accident.

### What all four dropped

- **The urgency score and curve glyph** (`67`, `╱ ⌒ ⌐`). An internal model leaking into the UI — nobody acts on "67". It stays on the task detail panel.
- **Emoji as data encoding** (🌿 ⚡ 🔥 ↻ 📦). Renders differently on every platform and can't be styled. Replaced with words.
- **The filled project chip.** A coloured dot says the same thing without competing for attention.

Colour in a row is now reserved for one thing: how close the deadline is. The priority circle is neutral in three of the four layouts for the same reason.

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

### The overview is a table (2026-09-21)

Cards forced a one-task project and a six-task project to the same size, which
left ragged holes down the page and made nothing comparable — and comparison is
the only reason to have an overview. `src/lib/projects.ts` derives the rows and
`src/components/ds/ProjectTable.tsx` draws them.

**`isActiveTask` is the one definition of active.** Open, not someday, and
`parent_id IS NULL`. It lives in the library rather than being re-filtered per
caller, so a per-project sum and a global count cannot disagree; if they ever
do, the fix is to route the global count through it. Subtasks are excluded
because they inherit their parent's deadline — otherwise one task with six
steps outranks six projects.

**Share of time is drawn against the whole table, not against the largest
row.** The handoff scaled the bar to the biggest project, so the top row ran
full width while its own chip read "35% of all time left" — a graphic
contradicting the number beside it, the same fault as a week-strip column that
drew a no-ratio dash next to a deficit. Scaled to the total, three projects
visibly holding most of the width *is* the finding.

**Three status tones, not four.** The spec asks for orange on three of six
conditions and there is no orange: `--warn` and `--caution` were deleted in
`tokens.css` rev 2 (handoff A1), because they collided with two project colours
and made a dark palette impossible. The reference boards still paint that chip
`#FBF0E4` / `#8A4409` — which *is* `--p-jobs-tint` / `--p-jobs-shade`, the
exact collision A1 removed — so the boards predate the decision and A1 wins.
`attention` is neutral ink on a filled chip, the call `VERDICT_CLASS` already
makes where `tight` is deliberately not `ok`. The chips carry words; colour's
job is to let you scan for red. Every chip clears 4.5:1 — `quiet` uses
`--ink-3`, not `--ink-faint`, which is 2.28:1 on white and would have made a
status unreadable.

**`Nothing active` is a seventh chip the spec does not have.** A project with a
completed history and nothing open is finished or forgotten, and calling that
"On track" claims progress on work that does not exist. On 2026-09-21 that is
CS134.

**Two row shapes, not one narrowed**, and the narrow one is drawn in
`ui/narrow-projects.html`: no chevron, because the whole row is the link and
the shed columns are reached by opening the project rather than expanding it in
place; name over a meta line reading `9h 45m · due Tue 22`; chip and a 64px bar
stacked at the right. The deadline is absolute there and relative in the wide
`Next due` column, because the narrow form is read as prose and "· due 3d" is
not a sentence — overdue is said by the line being red. Above 640, columns shed
by the handoff's rank order at the `narrow` / `mid` / `wide` breakpoints, which
are now declared in `@theme` and generate real Tailwind variants instead of
only being commented on.

**Inbox renders only when non-empty.** An empty inbox is a small quiet win and
the table should not manufacture a row to announce it. It is also excluded from
the concentration chip: that is a claim about a project, and letting Inbox hold
the title would suppress the chip on whichever project actually ran away with
the time.

Measured against the live database on 2026-09-21: 7 projects, 20 active tasks,
24h 05m left, Research at 32% — **below** the 35% concentration threshold, so
no project fires that chip today. The handoff's "Research is 35%" and "19 active
tasks · 27h 55m" are the reference day's numbers, not the current ones.

### Wiring the table to the page (2026-09-21)

**`toRowModel` moved out of `TaskList` into `src/lib/task-row.ts`.** The
project table's expanded rows are the second caller, and the chip rule — "say
what the container does not" — is a judgement that would not survive being
re-derived in a second place.

**`TaskRow` gained `hideProject`**, and the expansion uses it. `RESEARCH`
printed five times inside a row headed Research is precisely the noise that
chip rule was written against.

**Completing a task from the overview opens the same `MicroReflection` the list
does.** Calling `completeTask(id, null, null, null)` directly would have been
one line, and would have silently dropped the logged actual — the only thing
feeding the estimate bias.

**Edit and Archive moved from a per-card `⋯` menu into the expanded row's
footer**, beside `Open <project> →`. A table has no room for a menu button per
row, and both are things you do having just looked at a project's tasks.

**The estimate-accuracy chip is gone from this page.** It is internal plumbing
("Need 2 more samples"), and the project detail page already shows it.

**The sort control has two shapes.** Four segments need about 300px; at 390
they wrap into a two-line control with uneven segments. Narrow gets the board's
pill — implemented as a real `<select>`, so it is keyboard-navigable and gets
the platform picker on a phone.

`Task['project']` is optional because most queries do not join it, but this one
always does and PostgREST returns `null` rather than omitting the key. The view
types it as `Omit<Task, 'project'> & { project: Project | null }` instead of
intersecting, which would give the impossible `undefined & null`.

### Inside a project (2026-09-21)

Four billboard numbers that between them said "2 tasks", above 60% empty page.
It was not too short — it was loud and empty at the same time. One stat line
carries every number the billboards did; the space goes to the three things
the page never said.

**`projects.description` (migration 0021).** The page had nowhere to say what a
project is for, which the designer called the main reason it felt hollow.
NULL, `''` and absent all mean "never written" and draw one empty state —
distinguishing them would invent a state nobody asked for, and "absent" is what
a `select('*')` returns before the migration runs.

**The calendar block follows `task_event_links`, not a field on the event.** An
event belongs to Google; the only thing tying one to a project is a task the
user confirmed it covers. Unconfirmed suggestions are excluded — a guess is not
a commitment, and the block is read as a record of what is booked.

**The window is local midnight, not `todayStr + 'T00:00:00Z'`.** The first
version used UTC and would have dropped an evening event from a window that is
supposed to start today, anywhere west of London. `startOfLocalDay` exists for
exactly this.

**Repeating collapses occurrences by title**, the same key habits use: every
occurrence is its own row, so a weekly task that has run a term is twenty rows
with one name. Its history line is derived from the finished ones and is null
when there are none — "it has never been late" about a task that has never run
is a claim about nothing.

**`estimateAccuracy` will not quote a bias ratio below the threshold.** One
sample at 0.33 is not "67% faster", it is one task. Under three samples the
panel says what arriving unlocks; at three it says what the number means.

**The thin-data panel's right-hand value always carries a noun** — `1 of 3
samples`, `1 of 7 projects`. Two denominators in one component with no units is
how the same widget ends up meaning two things.

**The done list is no longer capped.** The old page fetched active and done
separately with `.limit(50)` on done, so the completion percentage quietly
stopped being a percentage on the 51st finished task. One query, every status.

**`projectContext` returns null on an ordinary project**, which is the common
case. A line that always renders has to invent something, and an invented
finding is worse than a blank — the same rule the week strip's finding follows.

### Creating and changing from where you are

`ProjectPicker` is a dropdown with inline creation, shared by the add-task modal and the task detail panel. Choosing "+ New project…" swaps the select for a name field and a colour row; creating selects the new project immediately.

Shared rather than written twice: both places need to pick a project *and* make one without losing what you're typing, and two copies of a create-then-select flow is two places for it to drift.

`createProject` returns the inserted row (it previously returned void) so the caller can select it without a refetch. The picker also keeps locally-created projects in state — the list arrives as a server prop and wouldn't include a new one until the page revalidates.

`onChange` hands back the `Project` object alongside the id, so a caller can update its own display at once. The detail panel's header badge reads from `task.project`, a joined snapshot that would otherwise show the old project until the panel was reopened.

The detail panel previously accepted a `projects` prop and never used it: a task's project was fixed at creation with no way to change it afterwards.

Habits don't get a project picker — they're deliberately project-less.

---

## Tests

`npm test` (vitest, `npm run test:watch` to iterate). 438 tests over the pure logic (checked 2026-09-21) — the scheduler, urgency, the day and week helpers, and everything the redesign added: capacity, the band, task↔event matching, the week strip, conflicts, the design tokens and the project rows.

### Why these four and nothing else

Every one of them is a place a real bug shipped from. The urgency formula and its PL/pgSQL twin once disagreed by a sign, so the nightly recompute silently overwrote correct scores. Habit days were bucketed in UTC, filing evening sessions under the wrong date. `weekEnd` read a local day string as UTC midnight and cost the scheduler the last evening of every week. The scheduler itself — 863 lines deciding what the product actually does — had no coverage at all.

They are also the cheapest things in the app to test: data in, data out, no database, no network, no DOM. The whole suite runs in under half a second.

### They are behaviour tests

They assert the rule a user would describe — "gym and running never land on the same day", "a chain runs back to back", "the more urgent task is booked earlier" — not the exact minute a block starts. Placement heuristics can change without rewriting the suite; the rules can't change without someone noticing.

Several encode a specific incident, and say so in a comment: the 120-minute session that became two blocks under a 90-minute cap, the laundry chain that came out in the wrong order, the four habit sessions that reported zero failures.

### Two behaviours pinned rather than fixed

- **`step` urgency floors at 0.08, not 0**, so a step task carries ~4 points of pressure even beyond the horizon where the other curves carry none. Migration 0011 does the same, so the two sides agree — changing it would move every existing score and need a new migration. The comment above `curveShape` used to claim every curve starts at 0; it no longer does.
- **A zero-duration task is silently skipped** by the scheduler — neither placed nor reported. Callers filter those out first, so it is unreachable in practice.

### CI

`.github/workflows/ci.yml` runs types, lint and tests on every pull request and on pushes to `main`. `npm ci` rather than `npm install`, so a green run means the tree the lockfile describes.

**No CD.** Nothing is deployed — there is no Vercel, Docker or other hosting config, and the app runs from `next dev`. A deploy pipeline would be answering a question this project does not have; if it is ever hosted on Vercel, that platform deploys on push by itself.

**The lint backlog was decided, not fixed.** Turning lint on surfaced 22 errors, one of which was real (a breadcrumb using `<a>` where `<Link>` belongs — a full page reload). The other 21 were two rules misfiring on deliberate patterns, so they were configured rather than worked around:

- `react/no-unescaped-entities` — **off**. Apostrophes in prose; the codebase writes them literally throughout, and escaping eleven of them would leave the only escaped apostrophes in the project.
- `react-hooks/set-state-in-effect` and `react-hooks/purity` — **warn**. The first flags reading `localStorage` on mount, which is how a client preference applies without a hydration mismatch; `useSyncExternalStore` is used where it fits, but the settings sections need the mounted guard. The second flags `new Date()` inside async Server Components, which render once per request. Both stay visible so new instances still show up.

CI that is red on the day it lands is CI that gets ignored, so the rules a project does not intend to follow are turned down deliberately rather than left to fail.

**Migrations get a warning, not a gate.** CI cannot see which migrations are applied to Supabase, but a PR that adds one prints a warning naming the files. 0013 sat unapplied for days once while the feature that needed it silently did nothing.

### What is not covered

Anything touching Supabase or Google Calendar: the server actions, the sweep, the calendar writes. Those need fixtures and a fake for two external services, which is a much bigger commitment than the value it would return right now. The riskiest of them — logging a session to the calendar, and the habit sweep — are worth exercising by hand instead.

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

---

## Home / Today

The landing page, and the answer to *"what should I do now?"*. `/` renders it
instead of redirecting to `/tasks`. The full reasoning is in
[`docs/HOME.md`](HOME.md); what follows is what was settled while building it.

### Plan Day was promoted, not duplicated

`DayPlanModal` showed one day's ranked list, its proposed blocks and the
calendar around them — most of this page behind a date picker in a toolbar.
Building Home beside it would have left four surfaces showing time. The modal,
its date picker, the `planDay` action and `buildAttackList` are all deleted;
what they did well — writing blocks to Google — is the **Block today** button,
which runs `proposeSchedule(1, …)` and opens the existing
`SchedulePreviewModal`. One preview surface instead of two nearly identical ones.

The one-way door is muscle memory: if Home does not land, putting the modal back
is easy, but changing the habit twice is not.

### The page never calls Google

Everything Home needs is already local — `calendar_events` is synced, tasks and
habits are ours, working hours are config. The freeBusy round trip is what made
"Schedule my week" unpleasant and it must not sit on the landing path.

The cost is staleness, and the page states it rather than hiding it: migration
0018 adds `user_integrations.last_synced_at`, stamped after a successful pull,
and the header reads *"Synced 2h ago · refresh"*. NULL prints nothing at all —
"unknown" and "never" are different claims, and only one of them is true of a
database that predates the column.

### `freeGaps` is lifted out of the scheduler

`workWindow`, the break placement and the free-slot arithmetic were closures
inside `runScheduler`. They are now `workWindowFor`, `placeBreaks` and
`freeGaps` at module scope, and `runScheduler` calls them — so Home and a
proposed schedule cannot disagree about where the free time is.

`freeGaps` is where the **overlap trap** lives, and it has its own tests. Fall
Fest 11:00–13:15 runs under ENTR 179A 11:00–12:15; the free block after them
starts at 13:15, not 12:15. `subtractIntervals` removes each busy span from
what is left of the day rather than walking events pairwise, so a nested event
takes nothing the longer one had not already taken.

### Away work pays the transition twice

A task's `buffer_minutes` (or the global default) is charged at each end of its
block; a task with `location: 'away'` is charged **double** at each end, for the
trip out and the trip back. With the default 15 minutes an errand needs a full
hour of clear space, which is what keeps it out of the half-hour between two
classes — the case the spec names.

Alternatives considered: a minimum-gap constant for away work (arbitrary, and a
second knob saying the same thing as the buffer), and asking the calendar where
the neighbouring events are (Google does not carry a location we could trust).

### Each gap gets work the earlier gaps did not take

Ranking every gap independently gives every gap the same most-urgent task, and
the column becomes one answer printed five times — which is what the first
build did. `buildHome` walks the day in order and spends each suggestion once,
so the shape reads as a plan: the readings in the afternoon, the errand in the
evening. The first gap is exempt from nothing, so it agrees with "Do this now"
above it.

### A subtask's importance is its parent's — resolved at the edge

Subtasks are created at priority 1, urgency 0, no deadline, so ranked on their
own rows the most urgent work in the app sorts to the bottom. `proposeSchedule`
already re-reads the parent on every run; Home would have been the fourth
reader of that rule, so it happens once in `resolveAgainstParent` and nothing
downstream has to remember.

The same rule makes "Needs attention" readable: three readings under one parent
collapse to one line, *Readings · 3 steps*, which opens the work rather than
one step of it. A collapsed row has no completion circle — three readings are
not finished in one click.

### Clock times keep their meridiem

The spec's mock-up wrote times bare ("1:15 – 2:45"). Working hours in this app
can run 10:00 → 01:30, and the live day this was checked against had an event
at 10:00am and a free stretch starting at 10:00pm — printed identically.
`formatClock` returns "10:00pm", lowercase and unspaced so it stays a time
rather than a sentence.

### A habit is a family of rows, not a row

`src/lib/habits.ts` owns "today's habits" and "how far through the week", and
both pages call it. Home originally read `habit_streaks.completions_this_week`
straight from the table, which is keyed by `task_id` — and completing a habit
closes its row and spawns the next occurrence with a fresh id, so the count
belongs to a row that is no longer on screen. Checked on 2026-09-20 there was
no `habit_streaks` row at all for any of the five open habit rows, and Home
showed Piano at 0/7 in a week it had been played six times.

The only identifier a habit keeps across a week is its **title**, so weekly
progress is counted as distinct local completion days per title since the
configured week start. `/habits` had worked this out and said so in a comment;
a comment asking the next reader to remember is not a mechanism, which is why
this is a function now.

Two things came with the extraction, both of which Home had wrong:

- **Tomorrow's spawned occurrence stays hidden** until its local day begins.
  Without the cutoff, logging a habit made it reappear immediately as unticked.
- **A habit done today stays on the page, ticked** rather than disappearing.
  Dropping it made the section empty by the evening, which reads as "no habits
  today" — the opposite of what a finished day should look like. `HabitRow`
  takes a `doneToday` prop, default false, so the task list is unchanged.

### One place to bust the task views

`revalidateTaskViews()` in `src/lib/revalidate.ts` replaces twenty-six
`revalidatePath('/tasks')` calls. Home and `/tasks` read the same rows, and
"remember to add a second line at each of twenty-six sites" is not a rule
anyone keeps. The next surface that reads tasks changes one function.
