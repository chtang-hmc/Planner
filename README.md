# Planner

A personal productivity planner built with Next.js 16, Supabase and Google
Calendar. Single user — one email can sign in, and the schema has no notion of
a second one.

The idea it is organised around is **capacity**: a to-do list will happily tell
you that eleven things are due tomorrow without ever mentioning that tomorrow
has four free hours in it. Working hours, breaks and real calendar events are
subtracted to leave the free gaps in a day, and everything due is measured
against that.

## Features

### Tasks

- Title, description, project, priority (Critical / High / Medium / Low),
  energy required, a time estimate, a due date and optionally a due *time*, and
  a "not before" start date.
- Status is inbox / active / done / cancelled; type is task / someday /
  recurring / habit. Duplicate, cancel, or push to Someday.
- **Subtasks** with their own estimates, energy and gap-after; a parent's
  estimate stays equal to the sum of its steps.
- **Urgency scoring** — 0–100 per task from priority and time pressure, with
  three curves (linear, exponential, step). Recomputed nightly in Postgres and
  by identical TypeScript in the app, so the two never disagree.
- **Estimate correction** — finishing a task records how long it actually took.
  Per-project bias accumulates in `estimation_profiles`, and once a project has
  three samples its future estimates are corrected. Below three, the app says
  how many more it needs rather than quoting a number it does not trust.
- **Recurrence** — iCal RRULE, with `every!` anchoring the next occurrence on
  completion rather than on the due date.

### Capacity and scheduling

- Working hours per weekday, daily breaks with cooldowns, and calendar events
  combine into the free gaps in each day. A 10pm cutoff separates "fits" from
  "fits, but only after 10".
- **Scheduler** — proposes placements for a day or a week from duration,
  urgency, energy match against a per-day/per-time-block energy schedule, a
  maximum session length, transition buffers, deadlines that bound the *end* of
  a block, atomic tasks that cannot be split, spread groups, and habits that
  must avoid landing right after a break. You review the proposal before
  anything is written.
- Accepted blocks are written to Google Calendar, colour-coded by priority.
  Unschedule or mark a block manual at any time.

### Google Calendar

Two-way. Pulls a −7/+30-day window (paginated), reconciles deletions, and
expires rows the window has left behind — keeping any row a task is linked to.
Syncs on a schedule (see *Deployment*) and on demand from Home.

Writes 🎯 focus blocks back, tagged so the app can recognise its own.
**Task ↔ event links** suggest which calendar event covers which task; a
confirmed link removes those minutes from the day's demand.

### The pages

- **Home / Today** — a capacity band that says in one sentence whether the day
  fits; a timeline interleaving events with the free gaps between them; a "right
  now" suggestion; a sortable rail of unplaced work; overdue and attention rows;
  today's habits; and Plan the day.
- **Tasks · List** — grouped by date, project or energy, with a capacity meter
  per group.
- **Tasks · Upcoming** — a fortnight. A week strip of due-against-free bars on
  one shared scale, then day sections carrying capacity, verdict, clash count
  and inline free slots, with drag-to-reschedule between days. A **Relevant**
  filter (configurable window and minimum priority) hides what you cannot act on
  yet.
- **Projects** — one table ranking every project by time left, with active
  count, progress, share of the whole, and a status chip (overdue and never
  started, never started, needs assigning, nothing active, concentration,
  stalled, on track). Rows expand to their tasks; Inbox appears as a row when
  non-empty. A project page carries one stat line, a tabbed task list, linked
  calendar events, a description, an estimate-accuracy panel and a
  repeating-tasks panel.
- **Habits** — weekly targets or "anytime", logged from the row or by clicking
  any square in a 5×7 week grid to fix a day you forgot. Four weeks of dots show
  the pattern; streaks are counted in the habit's own unit (`14d` daily,
  `2w` weekly). Habits can be mutually exclusive, and can avoid landing after
  breaks. Sessions blocked out on the calendar fill themselves in once the day
  passes.
- **Insights** — up to three finding cards (capacity, urgency, concentration),
  each of which must name a number or not appear; one stacked bar of where the
  remaining time sits, plus a table. Panels without enough data say so and count
  samples toward the threshold.
- **Review** — a guided weekly pass over overdue, inbox, upcoming and someday,
  with triage actions, ending in a saved review record.

### Everywhere else

- **Focus timer** — start, pause, finish; logs the session and prompts a
  micro-reflection on how long it really took and what blocked you.
- **Quick add** — type naturally; a parser highlights dates, times, durations,
  projects, priorities and recurrence in place. Claude parses the harder cases.
  [`/help/quick-add`](src/app/help/quick-add) explains the grammar by running
  the real parser, so it cannot go stale.
- **Inline search** — filters the task list or upcoming view in place.
- **Themes** — light / dark / system with ten accent presets; four task-row
  layouts.
- **Phone** — collapsible resizable sidebar on desktop, a five-item tab bar
  below 640px.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3 (App Router, Server Components, Server Actions) |
| UI | React 19, Tailwind CSS v4 |
| Language | TypeScript 5 strict |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Auth | Google OAuth via Supabase Auth, restricted to one email |
| AI | Anthropic Claude API — natural-language task parsing |
| Recurrence | `rrule` (iCal RRULE) |
| Tests | Vitest — the scheduler, urgency, capacity and the date helpers |
| Scheduled jobs | `pg_cron` for urgency and energy; Vercel Cron for calendar |

## Local setup

### Prerequisites

- Node.js 20+
- A Supabase project
- A Google Cloud project with OAuth 2.0 credentials (one for Supabase Auth, one
  for the separate Calendar write flow)
- An Anthropic API key

### Environment variables

Create `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google Calendar OAuth (for /api/auth/google — separate from Supabase Auth)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Claude API
ANTHROPIC_API_KEY=

# Access control — only this email can sign in
ALLOWED_EMAIL=you@example.com
```

Two more matter only in production, and are covered under *Deployment*:
`CRON_SECRET` and `NEXT_PUBLIC_SITE_URL`.

### Database

Apply everything in `supabase/migrations/` in filename order — `0001` through
`0021` as of 2026-09-23. `0001` carries the full schema, the PL/pgSQL functions
and RLS; the rest are additive. There is no `0003`.

Then set up the nightly jobs once, in the Supabase SQL editor:

```sql
select cron.schedule('recompute-urgency', '0 2 * * *', 'select recompute_urgency_scores()');
select cron.schedule('recompute-energy',  '0 3 * * *', 'select recompute_energy_patterns()');
```

`recompute_urgency_scores()` overwrites every active task's score every night,
so it has to stay in step with `computeUrgency()` in `src/types/index.ts`.
Changing the urgency formula means changing both. See
[`docs/DECISIONS.md`](docs/DECISIONS.md).

### Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

### Google Calendar write access

**Settings → Google Calendar → Connect.** The flow requests the
`calendar.events` scope, which covers both reading events and creating focus
blocks. If you connected earlier with read-only access, Settings offers
**Upgrade access**.

## Deployment

Deployed on Vercel. Beyond the variables above, production needs:

- **`CRON_SECRET`** — the calendar cron route compares `Authorization` against
  it and **refuses every request when it is unset**, rather than defaulting
  open. Vercel sends this header to cron routes automatically.
- **`NEXT_PUBLIC_SITE_URL`** — a fallback for the OAuth redirect origin, used
  only when the request carries no `Host` header to derive it from.

`vercel.json` runs the calendar sync **daily**. Hourly was the intent, but the
Hobby plan does not downgrade a sub-daily schedule — it refuses to create the
deployment. Hourly needs Pro, or any external scheduler calling the same route
with the same bearer token.

Access control is enforced twice: edge middleware in `src/proxy.ts` gates every
route, and `src/app/auth/callback/route.ts` rejects a non-`ALLOWED_EMAIL` user
at the one place a session is issued.

## Development

```bash
npm run dev       # dev server
npm test          # vitest — must pass before committing
npx tsc --noEmit  # type-check — must pass before committing
npm run lint
```

`docs/DECISIONS.md` is the architecture and the reasoning behind every
significant call. Read it before changing how something works.
