/**
 * Today's habits, and how far through the week they are.
 *
 * **A habit is a family of rows, not a row.** Completing one flips its row to
 * `done` and spawns the next occurrence with a fresh id, so the only stable
 * identifier a habit has across a week is its **title**. Everything here is
 * keyed by title for that reason.
 *
 * That is why there is no streak table any more (#38). `habit_streaks` was
 * keyed by `task_id`, and the id on screen is always a row created *after* the
 * completions you want to count, so it could only ever say 0 or 1 — on
 * 2026-09-28 its 25 rows had a highest streak of 1. Streaks, the weekly count
 * and the last day done are all derived from completion days by title, here
 * and in `lib/habit-stats`, so there is one answer.
 */

import type { Project, Task } from '@/types'
import { addDays, localDayStr, startOfLocalDay } from '@/lib/day'
import { weekStartOfDay } from '@/lib/week'
import { habitSummary, type HabitSummary } from '@/lib/habit-stats'

/** A completed habit row, as the completion queries return it. */
interface CompletionRow {
  title:        string
  completed_at: string | null
}

type HabitRowWithProject = Task & { project: Project }

/**
 * Unique local completion days per habit title.
 *
 * Local days, not UTC: an evening session belongs to the evening you had, not
 * to whatever date it already is in UTC. Deduplicated, so two sessions on one
 * day count once — a "4× a week" target means four days.
 */
export function completionDaysByTitle(
  rows: CompletionRow[],
  tz: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of rows) {
    if (!r.completed_at) continue
    const day = localDayStr(r.completed_at, tz)
    const days = (out[r.title] ??= [])
    if (!days.includes(day)) days.push(day)
  }
  for (const days of Object.values(out)) days.sort()
  return out
}

/**
 * One row per habit, with today's completion winning.
 *
 * A habit is both pending and done today when its open row is left over from
 * before: a chain that fell behind (Piano's next row was due 9-26 after being
 * logged on 2026-09-28), or a day recorded from the heatmap or the log sheet,
 * which write their own row. This used to prefer the pending row, "so it stays
 * tickable", but ticking it again records nothing: one completion counts per
 * day, and the second closes as a duplicate. So Home showed Piano as undone
 * straight after logging it, and the 8pm reminder would have listed it.
 *
 * The leftover row is not lost. It is still open, and it is what tomorrow's
 * tick closes; `completeTask` then skips a habit's next occurrence past the
 * completion day, so the chain catches up in one step.
 */
export function oneRowPerTitle(
  pending:   HabitRowWithProject[],
  doneToday: HabitRowWithProject[],
): { habits: HabitRowWithProject[]; doneTodayIds: string[] } {
  const byTitle = new Map<string, { row: HabitRowWithProject; done: boolean }>()
  for (const h of pending) if (!byTitle.has(h.title)) byTitle.set(h.title, { row: h, done: false })
  for (const h of doneToday) if (!byTitle.get(h.title)?.done) byTitle.set(h.title, { row: h, done: true })

  return {
    habits: [...byTitle.values()].map(v => v.row).sort((a, b) => a.title.localeCompare(b.title)),
    doneTodayIds: [...byTitle.values()].filter(v => v.done).map(v => v.row.id),
  }
}

/**
 * A summary for each row on screen, keyed by its id but computed from its
 * title — the id a completion retires never matters.
 */
export function summariesFor(
  rows:         { id: string; title: string; weekly_target: number | null }[],
  byTitle:      Record<string, string[]>,
  today:        string,
  weekStartDay: number,
): Record<string, HabitSummary> {
  const out: Record<string, HabitSummary> = {}
  for (const r of rows) {
    out[r.id] = habitSummary({
      weeklyTarget: r.weekly_target, days: byTitle[r.title] ?? [], todayStr: today, weekStartDay,
    })
  }
  return out
}

/**
 * When tomorrow's spawned occurrence stops being hidden.
 *
 * A pending habit is available once its day has begun locally. Requiring the
 * *UTC* day to have begun as well hid working habits for most of the day: a row
 * due `2026-09-17T00:00:00Z` is 17:00 on the 16th in Los Angeles, so Gym and
 * Piano disappeared every morning and only came back at 5pm.
 */
export function availableBefore(today: string, tz: string): string {
  return startOfLocalDay(addDays(today, 1), tz).toISOString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same loose shape lib/day and lib/week use
type Db = { from: (t: string) => any }

export interface TodaysHabits {
  /** One row per habit: today's occurrence, or today's completed one. */
  habits:       HabitRowWithProject[]
  /** Ids among `habits` that are already done today. */
  doneTodayIds: string[]
  /** Keyed by the ids in `habits`. */
  summaries:    Record<string, HabitSummary>
  /** Title → sorted unique local completion days, all time. */
  completionMap: Record<string, string[]>
  weekStartStr: string
}

/**
 * Everything a page needs to draw today's habits.
 *
 * Every completion is read, not a recent window: the best streak needs the
 * whole history, and a current streak longer than the window would otherwise
 * be cut short — `/habits` read sixteen weeks, so a 120-day run read 112. It is
 * two narrow columns for one person (41 rows on 2026-09-28).
 */
export async function fetchTodaysHabits(db: Db, opts: {
  tz:           string
  today:        string
  weekStartDay: number
}): Promise<TodaysHabits> {
  const { tz, today, weekStartDay } = opts
  const available    = availableBefore(today, tz)
  const weekStartStr = weekStartOfDay(today, weekStartDay)
  const startOfDay   = startOfLocalDay(today, tz).toISOString()

  const [{ data: pending }, { data: doneToday }, { data: completions }] =
    await Promise.all([
      // Pending: due today or earlier. Tomorrow's spawned occurrence stays
      // hidden, or logging a habit makes it reappear as unticked immediately.
      db.from('tasks')
        .select('*, project:projects(id,name,color,archived,created_at)')
        .eq('type', 'habit')
        .in('status', ['inbox', 'active'])
        .is('parent_id', null)
        .or(`due_date.is.null,due_date.lt.${available}`)
        .order('title'),

      // Completing a habit flips its row to 'done' and spawns tomorrow's, so
      // without this the habit vanishes from the page instead of showing done.
      db.from('tasks')
        .select('*, project:projects(id,name,color,archived,created_at)')
        .eq('type', 'habit')
        .eq('status', 'done')
        .is('parent_id', null)
        .gte('completed_at', startOfDay)
        .lt('completed_at', available)
        .order('title'),

      db.from('tasks')
        .select('title, completed_at')
        .eq('type', 'habit')
        .eq('status', 'done')
        .not('completed_at', 'is', null),
    ])

  const { habits, doneTodayIds } = oneRowPerTitle(
    (pending ?? []) as HabitRowWithProject[],
    (doneToday ?? []) as HabitRowWithProject[],
  )

  const completionMap = completionDaysByTitle((completions ?? []) as CompletionRow[], tz)

  return {
    habits,
    doneTodayIds,
    summaries: summariesFor(habits, completionMap, today, weekStartDay),
    completionMap,
    weekStartStr,
  }
}

/**
 * Completion days by title for every habit and repeating task, all time.
 *
 * Needs nothing but the zone, so a page can put it in the same `Promise.all`
 * as the tasks it will be matched against rather than waiting for those
 * titles first — one round trip instead of two (#96). Unfiltered by title for
 * the same reason; it is two narrow columns, 41 rows on 2026-09-28. Pair with
 * `summariesFor`.
 */
export async function fetchCompletionDays(db: Db, tz: string): Promise<Record<string, string[]>> {
  const { data } = await db.from('tasks')
    .select('title, completed_at')
    .in('type', ['habit', 'recurring'])
    .eq('status', 'done')
    .not('completed_at', 'is', null)
  return completionDaysByTitle((data ?? []) as CompletionRow[], tz)
}
