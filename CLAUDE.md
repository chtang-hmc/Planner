@AGENTS.md

# Planner — Claude Code Guidelines

## Project orientation

Personal productivity planner, organised around **capacity**: working hours,
breaks and real calendar events are subtracted to leave the free gaps in a day,
and everything due is measured against them. Single-user — one email can sign
in, and the schema has no notion of a second one. Next.js 16 App Router +
Supabase + Google OAuth + two-way Google Calendar sync, deployed on Vercel and
installable to an iPhone home screen with Web Push.

- **[`README.md`](README.md)** — features, setup, environment variables, deployment.
- **[`docs/DECISIONS.md`](docs/DECISIONS.md)** — the architecture and every significant design decision. Read the relevant section before changing how something works.
- **[`docs/HOME.md`](docs/HOME.md)** — the spec and reasoning behind the Home / Today page.
- **[`docs/TODO.md`](docs/TODO.md)** — standing context: accepted costs, thin spots, and work that shipped but has never been run for real. Not a work queue.
- **GitHub Issues** — the work queue. Anything someone could pick up and finish lives there, not in `TODO.md`.

## Commands

```bash
npm run dev        # dev server on :3000 (also .claude/launch.json)
npm test           # vitest run — must pass before committing
npm run test:watch # vitest in watch mode
npx tsc --noEmit   # type-check — must pass before committing
npx eslint         # lint (CI runs it; must be clean)
NEXT_DIST_DIR=.next-build npx next build   # build without clobbering a running dev server
```

Checked 2026-09-29: 27 test files, 633 tests, all passing; `tsc` and `eslint`
clean. Always build into a separate `NEXT_DIST_DIR` if a dev server might be
running — `next dev` and `next build` share `.next` by default and a build
overwrites the dev server's module graph (see `next.config.ts`).

CI (`.github/workflows/ci.yml`) runs types, lint, tests and `next build` on
every PR and push to `main`. The build runs **with no environment variables on
purpose**: a page that touches Supabase at build time (i.e. got prerendered)
fails there, as it would on a Vercel Preview. Don't "fix" CI by adding
placeholder env vars — make the page dynamic instead.

## Codebase map

```
src/
  proxy.ts                 Edge middleware (Next 16 name). Session check via getClaims(),
                           ALLOWED_EMAIL gate, public routes, static-file allow-list.
  app/
    (app)/                 Authenticated pages sharing layout.tsx (sidebar, tab bar, timer)
      page.tsx, HomeView   Home / Today — capacity band, timeline, rail, habits, Plan the day
      tasks/               List + Upcoming views
      projects/, projects/[id]/
      habits/  analytics/ (Insights)  review/ (weekly review)  settings/
    actions/               ALL mutations — Server Actions (tasks, projects, scheduling,
                           calendar, links, energy, push, auth)
    api/
      auth/google/…        Separate OAuth flow for Calendar write access (not Supabase Auth)
      cron/sync-calendar   Calendar pull; Bearer CRON_SECRET
      cron/notify          Scheduled push notifications; Bearer NOTIFY_CRON_SECRET
      parse-task           Claude API quick-add parsing (the one read via an API route)
    auth/callback          Supabase OAuth callback; second ALLOWED_EMAIL check
    auth/design            Design fixtures page
    help/quick-add         Public grammar reference that runs the real parser
    login/  403/  manifest.ts
  components/              Client/shared UI; ds/ = design-system pieces (TaskRow, Timeline,
                           CapacityBand, WeekStrip…); quick-add/ = the highlighting input
                           icons.tsx is the only place lucide-react is imported
  contexts/                TimerContext (focus timer state machine), SearchContext
  lib/                     Pure logic + server helpers. Tests sit beside the code (*.test.ts)
    scheduler.ts           Placement engine for day/week proposals
    capacity.ts band.ts    Free gaps vs demand; the one-sentence verdict
    day.ts week.ts         Timezone-aware day strings; week start
    quick-add.ts parse-task.ts add-task-model.ts   Deterministic grammar, LLM parse, merge
    google-calendar.ts     Sync + writes; task-events.ts = task ↔ event matching
    habits.ts habit-stats.ts  Habit families, streaks, weekly targets
    notify.ts (pure wording) / notify-run.ts (I/O); push.ts (web-push)
    user-config.ts         fetchUserConfig() — settings row, React cache()d per request
    revalidate.ts          revalidateTaskViews() — busts / and /tasks together
    use-stored.ts          useSyncExternalStore for localStorage / browser-only values
    supabase/server.ts     createClient() and createServiceClient()
  types/index.ts           Shared types + computeUrgency() (urgency source of truth)
supabase/migrations/       0001–0024 as of 2026-09-29 (there is no 0003); applied by hand
public/sw.js               Service worker — shows pushes only, no caching
scripts/make-icons.py      Draws public/icons/
.github/workflows/         ci.yml; sync-calendar.yml (hourly calendar pull at :17)
vercel.json                Daily calendar-sync cron (the floor if Actions is disabled)
```

## Keeping decisions documented

**After any session that adds a feature, changes a library, or makes a non-obvious technical call:**

1. Open `docs/DECISIONS.md`.
2. Find the relevant section (or add one).
3. Add a concise entry: what changed, what alternatives were considered, why this choice.

Do this before the session ends. Small updates in the moment beat large catch-up sessions later. If a decision is reversed, update or remove the old entry — stale docs are worse than no docs.

Examples of things that warrant an entry:
- Choosing a new dependency (or removing one)
- Changing how auth, caching, or data-fetching works
- Adding a new table or column with non-obvious semantics
- Changing the urgency formula or timer state machine
- Any "we tried X but switched to Y because Z"

## Written-down facts decay

`docs/TODO.md`, `docs/DECISIONS.md`, `README.md`, this file and issue
descriptions all state things about the code and the database that were true
when someone typed them. Some of them stop being true without anyone noticing,
because nothing fails when a document goes stale.

**Treat a written claim as a lead, not a finding.** Before acting on one,
re-establish it — read the code, query the database, run the command. Then say
in the commit or PR how you checked. This is not ceremony: on 2026-09-17 a stale
`TODO.md` produced a duplicate count that was wrong, and a "fix the client" entry
that would have broken the matching server-side bug it never mentioned.

Three specific habits:

- **Date every factual claim you write down.** A row count, a file count, a
  "this has never fired" — all of them need "checked YYYY-MM-DD" beside them, or
  the next reader cannot tell a fresh measurement from a year-old one.
- **When you finish something, delete the entry and check its neighbours.** Most
  staleness is collateral — an entry nobody touched, describing code somebody
  did.
- **Prefer documents that compute themselves.** `/help/quick-add` resolves every
  example by calling the real parser, so it cannot go stale; a table of hand-written
  answers would have started lying the first time the grammar moved. Where a doc
  can be derived rather than asserted, derive it.

## Keeping the work queue and the context apart

Two trackers that overlap is how one of them stops being updated.

- **An issue** is discrete work someone could pick up and finish. Include the
  decisions that need settling before starting — the ones that would otherwise
  be made silently and wrongly.
- **`docs/TODO.md`** is what is true about the project and not a unit of work:
  costs accepted on purpose, data that is thin rather than broken, code that
  shipped but has never been exercised for real.
- **`docs/DECISIONS.md`** is why the code is the way it is. Settled decisions
  live there, never in `TODO.md`.

When a `TODO.md` entry becomes actionable, open an issue and **delete** the
entry. Do not leave a pointer behind — "see #24" is one more thing to keep in
sync.

## Code conventions

- **Server Components by default.** Add `'use client'` only at interaction leaves.
- **All mutations via Server Actions** in `src/app/actions/`. No fetch to internal API routes from server actions or components (the read-only `/api/parse-task` is the one exception, so the Anthropic key stays server-side).
- **Cache busting:** after a task mutation call `revalidateTaskViews()` from `src/lib/revalidate.ts`, not `revalidatePath('/tasks')` — Home and `/tasks` read the same rows. Use `revalidatePath()` directly for other surfaces.
- **Two Supabase clients** (`src/lib/supabase/server.ts`):
  - `createClient()` — session-aware anon client, for auth-sensitive reads (Route Handlers, auth callback)
  - `createServiceClient()` — service-role, bypasses RLS, for all server action mutations and page loaders; never import in client components
- **RLS is permissive (`using (true)`)**; isolation is the `ALLOWED_EMAIL` gate, enforced twice — in `src/proxy.ts` and in `src/app/auth/callback/route.ts`. Keep both.
- **Read the settings row with `fetchUserConfig()`** (`src/lib/user-config.ts`) in pages and layouts — it is `cache()`d per request. Load it first, then put every other query in one `Promise.all`. `fetchTimezone(db)` / `fetchWeekStartDay(db)` are for actions and route handlers.
- **`computeUrgency()`** in `src/types/index.ts` is the single source of truth for urgency logic — used by the frontend and server actions, and must stay in sync with `recompute_urgency_scores()` (last rewritten in migration 0011).
- **Days are the user's local days.** A due date is a day string (`YYYY-MM-DD`), never an instant; a due time lives beside it in `due_time_minutes`. Convert instants to days only through `src/lib/day.ts` (`localDayStr`, `todayStr`, `localDayRange`…) with the timezone from `user_scheduling_config.timezone`. Never `toISOString().slice(0, 10)` — UTC slicing has shipped as a bug more than once.
- **All-day calendar event dates:** always append `T00:00:00Z` (UTC midnight), never bare `T00:00:00` (local time).
- **No HTTP self-calls in server actions** — call the shared lib function directly (e.g. `syncCalendarEvents()` not `fetch('/api/cron/sync-calendar')`).
- **Keep logic pure and testable.** Put decisions in `src/lib/*.ts` as functions of data, with I/O at the edge (the `notify.ts` / `notify-run.ts` split is the model). Tests are behaviour tests: assert the rule a user would describe, not the exact minute a block lands.
- **Browser-only values** (`localStorage`, resolved timezone, hydration) go through `src/lib/use-stored.ts`, not a state-plus-effect pair. Snapshots must be primitives.
- **Icons** come from `src/components/icons.tsx` only; don't import `lucide-react` directly.
- **Cron routes** under `/api/cron/` are exempt from the proxy gate, so each must check its own bearer secret and refuse when the secret is unset.
- **Public paths** (`/login`, `/auth/*`, `/help/*`, `/403`, static files by extension) are listed in `src/proxy.ts`. A new public asset needs its extension on the allow-list or signed-out requests redirect to `/login`.
- TypeScript strict mode is on. `npx tsc --noEmit` must pass before committing.
- **Lint must be clean.** `react-hooks/set-state-in-effect` and `react-hooks/purity` are errors; a genuine exception is disabled inline with the reason at the site. Unused bindings are allowed only with a `_` prefix (the strip-fields-by-destructuring idiom).
- **`npm test` must pass before committing.** Vitest over the pure logic only — the scheduler, urgency, capacity, the date helpers, quick-add parsing, habits, notifications and more. Nothing there touches the database, the network or the DOM; server actions and Google calls are not covered, so exercise those by hand.
- **Changing the urgency formula means changing two things.** `computeUrgency()` in `src/types/index.ts` and `recompute_urgency_scores()` in a new migration have to agree, or the nightly job overwrites every correct score. `src/types/urgency.test.ts` pins the shared behaviour.

## Database and migrations

- One migration file per logical change, numbered next in sequence; **never edit an applied migration** — add a new one. Start each with a header comment explaining why, as the existing ones do.
- Migrations are applied **by hand** to Supabase; CI only warns when a PR adds one. Say in the PR that it needs applying, and write code that tolerates a database missing the newest columns where practical (`fetchUserConfig` uses `select('*')` for this reason).
- Scheduled jobs: `pg_cron` runs `recompute_urgency_scores()` (02:00 UTC) and `recompute_energy_patterns()` (03:00 UTC), set up manually; `pg_cron` + `pg_net` call `/api/cron/notify` every five minutes (0024). The calendar sync runs hourly from GitHub Actions and daily from Vercel cron.

## Environment

Required env vars (see README for details): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ANTHROPIC_API_KEY`,
`ALLOWED_EMAIL`. Production also uses `CRON_SECRET`, `NOTIFY_CRON_SECRET`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and
optionally `NEXT_PUBLIC_SITE_URL`. The VAPID key pair is permanent — rotating
it invalidates every device's push subscription.

## Next.js 16 specifics

- Edge middleware lives in `src/proxy.ts`, exports `async function proxy(request)` — not `middleware`.
- Read `node_modules/next/dist/docs/` if something about routing, caching, or streaming looks off.
