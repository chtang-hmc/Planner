/**
 * Today's habits, and how far through the week they are.
 *
 * **A habit is a family of rows, not a row.** Completing one flips its row to
 * `done` and spawns the next occurrence with a fresh id, so the only stable
 * identifier a habit has across a week is its **title**. Everything here is
 * keyed by title for that reason.
 *
 * That is also why `habit_streaks.completions_this_week` cannot answer "how
 * many times this week": the table is keyed by `task_id`, and the id on screen
 * is usually a row created *after* the completions you want to count. On
 * 2026-09-20 there was no `habit_streaks` row at all for any of the five open
 * habit rows, so a page trusting that column showed Piano at 0/7 in a week it
 * had been played six times.
 *
 * `/habits` worked this out and said so in a comment. Home then read the column
 * anyway. The logic lives here now so there is one answer rather than a comment
 * asking the next reader to remember.
 */

import type { HabitStreak, Project, Task } from '@/types'
import { addDays, localDayStr, startOfLocalDay } from '@/lib/day'
import { weekStartOfDay } from '@/lib/week'

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

/** Distinct days completed on or after `weekStartStr`, per title. */
export function weeklyDayCounts(
  byTitle: Record<string, string[]>,
  weekStartStr: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [title, days] of Object.entries(byTitle)) {
    out[title] = days.filter(d => d >= weekStartStr).length
  }
  return out
}

/**
 * One row per habit, with the pending occurrence winning.
 *
 * A habit that is somehow both pending and completed today stays actionable —
 * the alternative is a row you cannot tick.
 */
export function oneRowPerTitle(
  pending:   HabitRowWithProject[],
  doneToday: HabitRowWithProject[],
): { habits: HabitRowWithProject[]; doneTodayIds: string[] } {
  const byTitle = new Map<string, { row: HabitRowWithProject; done: boolean }>()
  for (const h of doneToday) if (!byTitle.has(h.title)) byTitle.set(h.title, { row: h, done: true })
  for (const h of pending) byTitle.set(h.title, { row: h, done: false })

  return {
    habits: [...byTitle.values()].map(v => v.row).sort((a, b) => a.title.localeCompare(b.title)),
    doneTodayIds: [...byTitle.values()].filter(v => v.done).map(v => v.row.id),
  }
}

/**
 * Streaks keyed by the id actually on screen, with a weekly count that is true.
 *
 * The streak numbers are kept from whatever `habit_streaks` had for that id —
 * they are the only source for those — but the weekly count is recomputed, and
 * a habit with no streak row gets zeroes rather than nothing, so a component
 * never has to distinguish "no data" from "not started".
 */
export function patchWeeklyProgress(
  existing:     Record<string, HabitStreak>,
  habits:       { id: string; title: string }[],
  weeklyDays:   Record<string, number>,
  weekStartStr: string,
): Record<string, HabitStreak> {
  const out: Record<string, HabitStreak> = { ...existing }
  for (const h of habits) {
    const prev = existing[h.id]
    out[h.id] = {
      task_id:               h.id,
      current_streak:        prev?.current_streak ?? 0,
      longest_streak:        prev?.longest_streak ?? 0,
      last_completed:        prev?.last_completed ?? '',
      week_start:            weekStartStr,
      completions_this_week: weeklyDays[h.title] ?? 0,
    }
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
  /** Keyed by the ids in `habits`, with a real `completions_this_week`. */
  streaks:      Record<string, HabitStreak>
  /** Title → sorted unique local completion days, over the window fetched. */
  completionMap: Record<string, string[]>
  weekStartStr: string
}

/**
 * Everything a page needs to draw today's habits.
 *
 * `completionsSinceISO` sets how far back completions are read. Home wants the
 * current week; `/habits` wants sixteen, because it also draws a calendar from
 * the same rows. The weekly count is the same either way — it only ever looks
 * at days on or after the week start.
 */
export async function fetchTodaysHabits(db: Db, opts: {
  tz:                  string
  today:               string
  weekStartDay:        number
  completionsSinceISO: string
}): Promise<TodaysHabits> {
  const { tz, today, weekStartDay, completionsSinceISO } = opts
  const available    = availableBefore(today, tz)
  const weekStartStr = weekStartOfDay(today, weekStartDay)
  const startOfDay   = startOfLocalDay(today, tz).toISOString()

  const [{ data: pending }, { data: doneToday }, { data: completions }, { data: streakRows }] =
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
        .gte('completed_at', completionsSinceISO)
        .not('completed_at', 'is', null),

      db.from('habit_streaks').select('*'),
    ])

  const { habits, doneTodayIds } = oneRowPerTitle(
    (pending ?? []) as HabitRowWithProject[],
    (doneToday ?? []) as HabitRowWithProject[],
  )

  const completionMap = completionDaysByTitle((completions ?? []) as CompletionRow[], tz)
  const weeklyDays    = weeklyDayCounts(completionMap, weekStartStr)

  const fromTable: Record<string, HabitStreak> = {}
  for (const s of (streakRows ?? []) as HabitStreak[]) fromTable[s.task_id] = s

  return {
    habits,
    doneTodayIds,
    streaks: patchWeeklyProgress(fromTable, habits, weeklyDays, weekStartStr),
    completionMap,
    weekStartStr,
  }
}
