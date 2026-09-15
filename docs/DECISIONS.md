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
10. [Inline Search](#inline-search)
11. [Drag-to-Reschedule](#drag-to-reschedule)
12. [Priority-Colored Circles](#priority-colored-circles)
13. [Color Themes](#color-themes)
14. [Week Start](#week-start)
15. [Server / Client Component Split](#server--client-component-split)

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
urgency_score = min(priority_pts + time_pressure, 100)

priority_pts  = priority × 10          →  10 | 20 | 30 | 40
time_pressure = 0–60, based on curve   →  see below
```

Tasks without a due date get `urgency_score = priority_pts` (no time pressure).

### Curves

| Curve | Behavior | Use case |
|---|---|---|
| `linear` | pressure = `elapsed_ratio × 60` | Default; steady ramp |
| `exponential` | sigmoid centred at 80% elapsed: `60 / (1 + e^{-10(r-0.8)})` | Calm until final stretch, then spikes hard |
| `step` | 5 pts below 60%, 25 pts at 60–85%, 60 pts above 85% | Hard deadlines with a clear cliff |

### Implementation

`computeUrgency()` in `src/types/index.ts` is shared between the frontend (live preview in TaskDetail) and the server (immediate recompute in `updateTask`, initial score in `createTask`). The PL/pgSQL function in migration 0001 replicates the same logic for the nightly pg_cron job — keep them in sync if the formula changes.

**Fields that trigger an immediate recompute in `updateTask()`:**
```typescript
const URGENCY_FIELDS = new Set(['priority', 'due_date', 'urgency_curve'])
```

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
| `createTaskBlock()` | `POST /calendars/primary/events` | Creates `🎯 <task title>` event; color-coded by priority (red=critical, orange=high, blue=medium, grey=low) |
| `updateTaskBlock()` | `PATCH /calendars/primary/events/:id` | Updates start/end only |
| `deleteTaskBlock()` | `DELETE /calendars/primary/events/:id` | Silently ignores 404/410 (already deleted) |
| `listAutoScheduledEventIds()` | `GET /calendars/primary/events?privateExtendedProperty=plannerAuto=true` | Lists auto-scheduled blocks in a window, for cleanup |

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

### Day boundaries are UTC

`due_date` on a spawned occurrence is written at **UTC midnight** (`setUTCHours(0,0,0,0)`), and the habits page compares against UTC day edges. Both sides must agree: an earlier version spawned at *local* midnight while filtering on *local* end-of-day, which are 1 ms apart — a spawned habit could never satisfy "due today or earlier" and the page rendered empty. This follows the same rule as all-day calendar events (always `T00:00:00Z`).

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

### Why not a separate table?

`parent_id` was already in the schema. Reusing the `tasks` table means subtasks automatically get all the same columns (status, title, timestamps) without a migration. The trade-off is that subtasks have irrelevant fields (urgency_score, energy_required, etc.) that are never used.

### Server actions

`getSubtasks(taskId)`, `createSubtask(taskId, title)`, `toggleSubtask(id, done)`, `deleteSubtask(id)` — all in `src/app/actions/tasks.ts`. The SubtaskSection component in TaskDetail handles optimistic updates locally and refreshes from the server after each write.

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
