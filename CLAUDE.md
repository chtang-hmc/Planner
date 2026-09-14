@AGENTS.md

# Planner — Claude Code Guidelines

## Project orientation

Personal productivity planner. Single-user. Next.js 16 App Router + Supabase + Google OAuth + Google Calendar sync. See **[`docs/DECISIONS.md`](docs/DECISIONS.md)** for the full architecture and every significant design decision.

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

## Code conventions

- **Server Components by default.** Add `'use client'` only at interaction leaves.
- **All mutations via Server Actions** in `src/app/actions/`. Call `revalidatePath()` to bust cache. No fetch to internal API routes from server actions.
- **Two Supabase clients:**
  - `createClient()` — session-aware, for auth-sensitive reads (Route Handlers, auth callback)
  - `createServiceClient()` — service-role, for all server action mutations; never import in client components
- **`computeUrgency()`** in `src/types/index.ts` is the single source of truth for urgency logic — used by the frontend, server actions, and must stay in sync with the PL/pgSQL function in migration 0001.
- **All-day calendar event dates:** always append `T00:00:00Z` (UTC midnight), never bare `T00:00:00` (local time).
- **No HTTP self-calls in server actions** — call the shared lib function directly (e.g. `syncCalendarEvents()` not `fetch('/api/calendar/sync')`).
- TypeScript strict mode is on. `npx tsc --noEmit` must pass before committing.

## Next.js 16 specifics

- Edge middleware lives in `src/proxy.ts`, exports `async function proxy(request)` — not `middleware`.
- Read `node_modules/next/dist/docs/` if something about routing, caching, or streaming looks off.
