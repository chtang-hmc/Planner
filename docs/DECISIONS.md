# Architecture & Design Decisions

> **Keep this file current.** When you add a feature, change a library, or make a call that a future reader might second-guess, add or update the relevant section. Small edits beat big catch-up sessions.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Data Layer](#data-layer)
3. [Auth](#auth)
4. [Urgency Scoring](#urgency-scoring)
5. [Focus Timer](#focus-timer)
6. [Google Calendar Sync](#google-calendar-sync)
7. [Server / Client Component Split](#server--client-component-split)
8. [Planned Features (schema-ready, UI pending)](#planned-features)

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
| Google APIs | `googleapis` | 180.x | Calendar token exchange; `google-calendar.ts` wraps the raw REST calls |
| AI | `@anthropic-ai/sdk` | 0.125 | Claude API for natural-language task parsing (quick-add) |
| Recurrence | `rrule` | 2.8.1 | iCal RRULE parsing; schema column exists, UI not yet built |
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

RLS is enabled on every table. The current policy is trivially permissive for authenticated users (`using (true)`) because this is a single-user app. If multi-user support is added, policies need `user_id` columns and per-row checks.

### Schema overview

```
projects          — colour-coded workspaces
tasks             — core entity; urgency_score, rrule, parent_id, etc.
focus_sessions    — per-timer-run log; estimate_accurate + blocker_note from reflection
estimation_profiles — per-project bias_ratio (actual ÷ estimated, running average)
energy_logs       — manual 1–5 energy check-ins
energy_patterns   — nightly rollup of energy_logs by (hour, day_of_week)
habit_streaks     — current/longest streak for recurring tasks
calendar_events   — synced from Google Calendar; gcal_id unique key for upserts
weekly_reviews    — one row per Monday; completed/postponed counts + notes
user_integrations — server-side OAuth tokens (Google Calendar); never sent to client
```

### Migrations

- `0001_initial_schema.sql` — full schema + `recompute_urgency_scores()` + `recompute_energy_patterns()` PL/pgSQL functions + RLS policies
- `0002_nullable_project_id.sql` — made `tasks.project_id` nullable so tasks can live in an "Inbox" (no project assigned)

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
- **Not free?** Google OAuth is free. The Google Cloud Console OAuth client costs nothing as long as it stays in "Testing" mode (or gets verified).
- Supabase Auth handles the token lifecycle. The OAuth callback at `/auth/callback` exchanges the code for a session using `createClient()` (the session-aware helper — never the service-role client here, since the purpose is to set the user cookie).
- The Google OAuth credentials for **Calendar** are separate env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) from the Supabase dashboard credentials. They're stored in `.env.local` only.

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

### Known caveat

`FloatingTimer` stays mounted across route navigations (because it's in the root layout). Local state (`finishing`) is therefore long-lived. A `useEffect` resets it to `false` whenever `phase` returns to `idle` — without this, the next session would immediately render the reflection panel.

---

## Google Calendar Sync

### OAuth separation

The Google OAuth client used for **Supabase Auth** (login) is configured in the Supabase dashboard. The Google OAuth client used for **Calendar API** is in `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). They can be the same Google Cloud project, but they're configured in two places.

### Token storage

Tokens are stored in `user_integrations` (server-side only). The service-role client is used for all token reads/writes. Tokens are **never sent to the client**.

### Refresh strategy

`getValidToken()` in `src/lib/google-calendar.ts` checks if the access token expires within 60 seconds and refreshes proactively. Refresh uses the `refresh_token` from `user_integrations` against `https://oauth2.googleapis.com/token`.

### Sync function placement

`syncCalendarEvents()` lives in `src/lib/google-calendar.ts` (not in the API route). This means both the Route Handler (`POST /api/calendar/sync`) and the Server Action (`triggerCalendarSync`) can call it directly, avoiding HTTP self-calls that fail in serverless environments when `NEXT_PUBLIC_SITE_URL` is unset.

### All-day events

All-day event dates from the Google Calendar API are `YYYY-MM-DD` strings (no time). We append `T00:00:00Z` (UTC midnight) when converting to `timestamptz` — **not** `T00:00:00` (local midnight). The distinction matters on any server not in UTC.

### Calendar display cutoff

The query fetches events where `end_time >= now()`, which correctly includes in-progress events (e.g. a meeting that started 30 minutes ago). The CalendarPanel client-side filter uses the same `end_time >= now()` logic.

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

## Planned Features

These are schema-ready but have no UI yet. Implement them without a migration.

### Energy logging

- Table: `energy_logs` (level 1–5, optional task_id)
- Nightly rollup: `recompute_energy_patterns()` (pg_cron, already scheduled)
- UI needed: quick-log button (sidebar or floating chip); analytics heatmap

### Recurring tasks

- Column: `tasks.rrule` (iCal RRULE string, e.g. `FREQ=WEEKLY;BYDAY=MO`)
- Library: `rrule` (already installed)
- Logic needed: on task completion, compute next occurrence date and insert a new task row with the same template fields
- Table: `habit_streaks` (current/longest streak per recurring task_id)

### Subtasks

- Column: `tasks.parent_id` (self-referential FK, cascade delete)
- UI needed: subtask list in TaskDetail; "add subtask" input; collapse/expand
- Query: `tasks.select('*, subtasks:tasks!parent_id(*)')` for nested fetch
