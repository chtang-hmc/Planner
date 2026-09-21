/**
 * The Projects overview, as a table rather than a grid of cards.
 *
 * Cards forced a one-task project and a six-task project to the same size,
 * which left ragged holes down the page and made nothing comparable. A table
 * makes every project readable against every other on the same axes, which is
 * the only reason to have an overview at all.
 *
 * Everything here is derived and pure. `buildProjectRows` is the single place
 * that decides what "active" means, what a project's progress is, and which
 * status it gets — the same numbers then feed the sidebar, the table and
 * Insights, so they cannot disagree.
 */

import type { Task, Project } from '@/types'
import { daysBetween } from '@/lib/home'

/**
 * One definition of active, everywhere.
 *
 * Open, not parked in someday, and not a subtask. Subtasks are excluded
 * because they inherit their parent's deadline and would otherwise let one
 * task with six steps outrank six separate projects; the parent already
 * carries the work. If a per-project sum ever disagrees with a global count,
 * the fix is to route the global count through here, not to explain the gap.
 */
export function isActiveTask(t: Pick<Task, 'status' | 'type' | 'parent_id'>): boolean {
  return (t.status === 'inbox' || t.status === 'active')
      && t.type !== 'someday'
      && t.parent_id === null
}

/** Done, at the same grain as `isActiveTask`, so the ratio is of like for like. */
export function isDoneTask(t: Pick<Task, 'status' | 'type' | 'parent_id'>): boolean {
  return t.status === 'done' && t.type !== 'someday' && t.parent_id === null
}

/** Minutes a task is expected to take: the bias-corrected figure when there is one. */
export function taskMinutes(t: Pick<Task, 'estimated_minutes' | 'adjusted_minutes'>): number {
  return t.adjusted_minutes ?? t.estimated_minutes ?? 0
}

/** Share of the table's remaining time at which one project is worth naming. */
export const CONCENTRATION_THRESHOLD = 0.35

/** Days without a completion before an active project counts as stalled. */
export const STALL_DAYS = 14

export type StatusTone = 'danger' | 'attention' | 'quiet' | 'ok'

export interface ProjectStatus {
  text: string
  tone: StatusTone
}

export interface ProjectRow {
  /** Null on the Inbox pseudo-row. */
  id:          string | null
  name:        string
  /** Null on Inbox — it has no colour of its own and should not borrow one. */
  color:       string | null
  isInbox:     boolean
  activeCount: number
  doneCount:   number
  /** `done / (active + done)`, 0–1. Null when the project has no tasks at all. */
  progress:    number | null
  minutesLeft: number
  /** This project's minutes as a fraction of every row's, 0–1. */
  share:       number
  /** Earliest due day among the active tasks, or null. */
  nextDue:     string | null
  /** Days from today to `nextDue`; negative is overdue. Null with no due date. */
  nextDueIn:   number | null
  status:      ProjectStatus
}

/**
 * The status chip: one per row, first match wins.
 *
 * **Three tones, not four.** The spec asks for orange on three of the six
 * conditions, and there is no orange: `--warn` was removed from the palette on
 * purpose, because banding a meter in four colours cost two hues that collided
 * with two project colours. The middle tone is neutral ink on a neutral chip
 * instead — the same call `VERDICT_CLASS` already makes, where `tight` is not
 * `ok`. The chips carry words; the colour's job is to let you scan for red.
 */
export function projectStatus(opts: {
  isInbox:      boolean
  activeCount:  number
  doneCount:    number
  /** Days since the most recent completion; null if there has never been one. */
  daysSinceDone: number | null
  nextDueIn:    number | null
  share:        number
  /** True on the single largest row. Only it can claim concentration. */
  isLargest:    boolean
}): ProjectStatus {
  const { isInbox, activeCount, doneCount, daysSinceDone, nextDueIn, share, isLargest } = opts

  if (doneCount === 0 && nextDueIn !== null && nextDueIn < 0) {
    return { text: 'Overdue, never started', tone: 'danger' }
  }
  if (doneCount === 0) return { text: 'Never started', tone: 'attention' }

  if (isInbox) return { text: 'Needs assigning', tone: 'quiet' }

  /**
   * Nothing active is not "on track".
   *
   * Not in the spec's table, which assumes every row has work on it. A project
   * with a completed history and nothing open is finished or forgotten, and
   * calling that on track claims progress on work that does not exist. It is
   * the row you archive.
   */
  if (activeCount === 0) return { text: 'Nothing active', tone: 'quiet' }

  /**
   * At most one concentration chip in the table.
   *
   * A rule that fires on two rows of seven is a description, not a flag, so
   * only the largest row can claim it, and only above the threshold.
   */
  if (isLargest && share >= CONCENTRATION_THRESHOLD) {
    return { text: `${Math.round(share * 100)}% of all time left`, tone: 'attention' }
  }

  if (daysSinceDone !== null && daysSinceDone >= STALL_DAYS) {
    return { text: `Stalled ${daysSinceDone} days`, tone: 'attention' }
  }

  return { text: 'On track', tone: 'ok' }
}

export interface BuildInput {
  projects: Project[]
  /** Every task, at any status — the ratio needs the completed ones too. */
  tasks:    Pick<Task,
    'project_id' | 'parent_id' | 'status' | 'type' |
    'estimated_minutes' | 'adjusted_minutes' | 'due_date' | 'completed_at'>[]
  todayStr: string
}

/**
 * One row per unarchived project, plus Inbox when it has anything in it.
 *
 * Inbox renders only when non-empty: an empty inbox is a small quiet win and
 * the table should not manufacture a row to announce it. The affordance still
 * has to exist, because tasks will land there again.
 *
 * Sorted by time left, descending — the default the page ships with, and the
 * order the sidebar uses.
 */
export function buildProjectRows({ projects, tasks, todayStr }: BuildInput): ProjectRow[] {
  const active = tasks.filter(isActiveTask)
  const done   = tasks.filter(isDoneTask)

  const totalLeft = active.reduce((n, t) => n + taskMinutes(t), 0)

  const partial = [...projects, null].map(p => {
    const id  = p?.id ?? null
    const own = active.filter(t => t.project_id === id)
    const ownDone = done.filter(t => t.project_id === id)

    const minutesLeft = own.reduce((n, t) => n + taskMinutes(t), 0)

    const dueDays = own.map(t => t.due_date).filter((d): d is string => !!d)
      .map(d => d.slice(0, 10)).sort()
    const nextDue = dueDays[0] ?? null

    const lastDone = ownDone.map(t => t.completed_at).filter((d): d is string => !!d)
      .map(d => d.slice(0, 10)).sort().at(-1) ?? null

    return {
      id,
      name:    p?.name ?? 'Inbox — no project',
      color:   p?.color ?? null,
      isInbox: p === null,
      activeCount: own.length,
      doneCount:   ownDone.length,
      progress: own.length + ownDone.length > 0
        ? ownDone.length / (own.length + ownDone.length)
        : null,
      minutesLeft,
      share: totalLeft > 0 ? minutesLeft / totalLeft : 0,
      nextDue,
      nextDueIn: nextDue ? daysBetween(todayStr, nextDue) : null,
      daysSinceDone: lastDone ? daysBetween(lastDone, todayStr) : null,
    }
  }).filter(r => !r.isInbox || r.activeCount > 0 || r.doneCount > 0)

  /**
   * Inbox is not eligible.
   *
   * Concentration is a claim about a project — that one of them has taken over
   * the workload. Inbox already says what is wrong with it ("Needs assigning"),
   * and letting it hold the title would silently suppress the chip on the
   * project that has actually run away with the time.
   */
  const largest = partial.reduce<typeof partial[number] | null>(
    (best, r) => !r.isInbox && (!best || r.minutesLeft > best.minutesLeft) ? r : best,
    null,
  )

  return partial
    .map(row => {
      // Destructured inside, not in the parameter list: the rest object is a
      // new one, so `r === largest` out here would never be true.
      const { daysSinceDone, ...r } = row
      return { ...r, status: projectStatus({ ...r, daysSinceDone, isLargest: row === largest }) }
    })
    .sort((a, b) => b.minutesLeft - a.minutesLeft || a.name.localeCompare(b.name))
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The narrow row's deadline: `today`, `Tue 22`, `no date`.
 *
 * Absolute where the wide column is relative, because it is read as part of a
 * sentence — "9h 45m · due Tue 22" — and "· due 3d" is not one. Overdue keeps
 * the date rather than becoming "3d overdue" for the same reason; the line is
 * red, which is where "overdue" is said.
 */
export function dueShort(dayStr: string | null, todayStr: string): string {
  if (!dayStr) return 'no date'
  if (dayStr === todayStr) return 'today'
  return `${WEEKDAY[new Date(dayStr + 'T00:00:00Z').getUTCDay()]} ${Number(dayStr.slice(8, 10))}`
}

export type ProjectSort = 'left' | 'due' | 'progress' | 'name'

export const PROJECT_SORTS: { key: ProjectSort; label: string }[] = [
  { key: 'left',     label: 'Time left' },
  { key: 'due',      label: 'Next due' },
  { key: 'progress', label: 'Progress' },
  { key: 'name',     label: 'Name' },
]

/**
 * Sort the rows.
 *
 * Every comparison falls back to name, so the order is total and a re-render
 * cannot shuffle two equal rows. A row with no due date sorts last under
 * `due` — "never" is not "soonest", which is what a null would do if it were
 * compared as a number.
 */
export function sortProjectRows(rows: ProjectRow[], by: ProjectSort): ProjectRow[] {
  const byName = (a: ProjectRow, b: ProjectRow) => a.name.localeCompare(b.name)

  /**
   * Comparators, not a switch with four returns.
   *
   * The switch had no default. TypeScript was happy — `by` is a union of
   * exactly these four — but a value from outside the union at runtime fell
   * through and returned `undefined`, and the caller's next line is
   * `projectsSummary(rows)`. A lookup cannot fall through, and an unknown key
   * lands on name order rather than on nothing.
   */
  const compare: Record<ProjectSort, (a: ProjectRow, b: ProjectRow) => number> = {
    left:     (a, b) => b.minutesLeft - a.minutesLeft || byName(a, b),
    progress: (a, b) => (b.progress ?? -1) - (a.progress ?? -1) || byName(a, b),
    name:     byName,
    due:      (a, b) =>
      (a.nextDue === null ? 1 : 0) - (b.nextDue === null ? 1 : 0)
      || (a.nextDue ?? '').localeCompare(b.nextDue ?? '')
      || byName(a, b),
  }

  return [...rows].sort(compare[by] ?? byName)
}

/** The line under the heading: what the table adds up to. */
export function projectsSummary(rows: ProjectRow[]): {
  projectCount: number; activeCount: number; minutesLeft: number
} {
  return {
    projectCount: rows.filter(r => !r.isInbox).length,
    activeCount:  rows.reduce((n, r) => n + r.activeCount, 0),
    minutesLeft:  rows.reduce((n, r) => n + r.minutesLeft, 0),
  }
}

/**
 * The finding beside the sort control, when the table has one.
 *
 * Only said when it is true. Never-started projects are the one condition
 * worth naming above the rows, because it is the one a reader cannot get by
 * scanning a column — it is a fact about the absence of history.
 */
export function projectsFinding(rows: ProjectRow[]): string | null {
  const never = rows.filter(r => !r.isInbox && r.doneCount === 0)
  if (never.length === 0) return null
  return never.length === 1
    ? `${never[0].name} has never had a task completed.`
    : `${never.length} projects have never had a task completed.`
}
