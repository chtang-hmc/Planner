# Planner

A personal productivity planner built with Next.js 16, Supabase, and Google Calendar. Single-user, self-hosted.

## Features

- **Task management** — inbox, projects, priorities (Critical / High / Medium / Low), energy levels, time estimates, due dates
- **Urgency scoring** — 0–100 score per task, computed from priority + time pressure with configurable curves (linear, exponential, step)
- **Upcoming view** — day-by-day calendar layout with drag-to-reschedule; tasks snap to any date
- **Recurring tasks & habits** — iCal RRULE support; completion spawns the next occurrence from the task's due date (not today)
- **Habits page** — dedicated habit tracker with 16-week GitHub-style completion heatmap, streak stats, and "anytime" habits (no fixed day)
- **Subtasks / checklists** — break any task into steps with a progress bar
- **Focus timer** — in-app Pomodoro-style timer with start/pause/finish; logs focus sessions and prompts a micro-reflection on completion
- **Google Calendar sync** — bidirectional: pull events into Upcoming view; push tasks as focus blocks (🎯) to your calendar, color-coded by priority
- **Inline search** — type in the top bar to live-filter the task list or upcoming view in place; no separate search page
- **Analytics** — estimation accuracy, energy patterns, streak history
- **Weekly review** — guided review flow (completed / postponed / notes)
- **Themes** — light / dark / system, with configurable accent colors

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| UI | React 19, Tailwind CSS v4 |
| Language | TypeScript 5 strict |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Auth | Google OAuth (via Supabase Auth) |
| AI | Anthropic Claude API — natural-language task parsing |
| Recurrence | `rrule` library (iCal RRULE) |
| Scheduled jobs | `pg_cron` — nightly urgency recompute + energy rollup |

## Local setup

### Prerequisites

- Node.js 20+
- A Supabase project
- A Google Cloud project with OAuth 2.0 credentials (one for Auth, one for Calendar)
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

# Access control — only this email can log in
ALLOWED_EMAIL=you@example.com
```

### Database migration

Run migrations in order from `supabase/migrations/`:

```bash
# 0001_initial_schema.sql  — full schema + PL/pgSQL functions + RLS
# 0002_nullable_project_id.sql
# 0003_scheduling_columns.sql  (gcal_event_id, scheduled_start, scheduled_end on tasks)
```

Or apply manually — see `docs/DECISIONS.md` for the schema overview.

### pg_cron jobs (run once in Supabase SQL editor)

```sql
select cron.schedule('recompute-urgency', '0 2 * * *', 'select recompute_urgency_scores()');
select cron.schedule('recompute-energy',  '0 3 * * *', 'select recompute_energy_patterns()');
```

### Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` and prompted to sign in with Google.

## Google Calendar write access

Go to **Settings → Google Calendar** and click **Connect**. The OAuth flow requests `calendar.events` scope, which allows both reading events (for Upcoming view) and creating focus blocks.

If you previously connected with read-only access, the Settings page will show an **Upgrade access** button.

After connecting, open any task's detail panel → **Schedule** section to block time directly on your calendar.

## Architecture

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for the full architecture, every significant design decision, and the rationale behind them.

## Development

```bash
npm run dev      # dev server (http://localhost:3000)
npx tsc --noEmit # type-check (must pass before committing)
```
