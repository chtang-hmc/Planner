/**
 * Inside a project.
 *
 * The page it replaces spent a quarter of the viewport on four billboard
 * numbers that said "2 tasks", then left 60% of it empty. It was not too
 * short — it was loud and empty at the same time. One stat line carries every
 * number those billboards did; the space goes to the three things the page
 * never said: what the project is for, what it has on the calendar, and what
 * repeats.
 */

import type { Task, CalendarEvent } from '@/types'
import { isActiveTask, isDoneTask, taskMinutes } from '@/lib/projects'
import { daysBetween } from '@/lib/home'
import { formatMinutes } from '@/lib/task-format'

/** Inside this many hours, "due imminently" is worth saying as a group fact. */
export const IMMINENT_DAYS = 1

export interface ProjectStats {
  activeCount: number
  doneCount:   number
  minutesLeft: number
  /** 0–1, or null when the project has no tasks at all. */
  progress:    number | null
}

export function projectStats(tasks: Pick<Task,
  'status' | 'type' | 'parent_id' | 'estimated_minutes' | 'adjusted_minutes'>[],
): ProjectStats {
  const active = tasks.filter(isActiveTask)
  const done   = tasks.filter(isDoneTask)
  const total  = active.length + done.length

  return {
    activeCount: active.length,
    doneCount:   done.length,
    minutesLeft: active.reduce((n, t) => n + taskMinutes(t), 0),
    progress:    total > 0 ? done.length / total : null,
  }
}

/**
 * The sentence beside the stat line, when there is one worth saying.
 *
 * Null is the common answer and the right one. A line that always renders has
 * to invent something on an ordinary project, and an invented finding is worse
 * than a blank — this is the same rule the week strip's finding follows.
 */
export function projectContext(
  tasks: Pick<Task, 'status' | 'type' | 'parent_id' | 'due_date'>[],
  todayStr: string,
): string | null {
  const active = tasks.filter(isActiveTask)
  if (active.length === 0) return null

  const dated = active.filter(t => t.due_date)
  const late  = dated.filter(t => daysBetween(todayStr, t.due_date!.slice(0, 10)) < 0)

  // Already behind beats due soon: it is the sharper thing to say, and a task
  // that is late is also, trivially, due within the day.
  if (late.length > 0) {
    return late.length === active.length && active.length > 1
      ? `Every remaining task is already past its deadline.`
      : `${late.length === 1 ? 'One task is' : `${late.length} tasks are`} already past ${late.length === 1 ? 'its' : 'their'} deadline.`
  }

  if (dated.length === active.length
      && dated.every(t => daysBetween(todayStr, t.due_date!.slice(0, 10)) <= IMMINENT_DAYS)) {
    return active.length === 2
      ? 'Both remaining tasks are due in the next 24 hours.'
      : `${active.length === 1 ? 'The one remaining task is' : `All ${active.length} remaining tasks are`} due in the next 24 hours.`
  }

  if (dated.length === 0) {
    return active.length === 1
      ? 'The one task here has no deadline.'
      : 'Nothing here has a deadline.'
  }

  return null
}

export interface LinkedEvent {
  id:      string
  title:   string
  startMs: number
  minutes: number
  allDay:  boolean
}

/**
 * What this project has on the calendar.
 *
 * Found through `task_event_links`, not through a `project_id` on the event:
 * a calendar event belongs to Google, and the only thing that ties one to a
 * project is a task the user confirmed it covers. Unconfirmed suggestions are
 * excluded — a guess is not a commitment, and this block is read as a record
 * of what is actually booked.
 */
export function linkedEvents(opts: {
  /** Confirmed links only; the caller filters by status. */
  links:  { task_id: string; event_id: string }[]
  /** Tasks belonging to this project, at any status. */
  taskIds: Set<string>
  events: Pick<CalendarEvent, 'id' | 'title' | 'start_time' | 'end_time' | 'all_day'>[]
  /** Window, as instants. Typically the coming week. */
  fromMs: number
  toMs:   number
}): LinkedEvent[] {
  const { links, taskIds, events, fromMs, toMs } = opts

  const wanted = new Set(links.filter(l => taskIds.has(l.task_id)).map(l => l.event_id))
  const byId = new Map(events.map(e => [e.id, e]))

  return [...wanted]
    .map(id => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map(e => {
      const startMs = Date.parse(e.start_time)
      return {
        id: e.id,
        title: e.title,
        startMs,
        minutes: Math.round((Date.parse(e.end_time) - startMs) / 60_000),
        allDay: e.all_day,
      }
    })
    .filter(e => e.startMs >= fromMs && e.startMs < toMs)
    .sort((a, b) => a.startMs - b.startMs)
}

/** `2h 15m this week` — the header beside the calendar block. */
export function calendarTotal(events: LinkedEvent[]): string {
  return formatMinutes(events.reduce((n, e) => n + (e.allDay ? 0 : e.minutes), 0))
}

export interface RepeatingTask {
  id:      string
  title:   string
  /** `weekly`, `daily`, `every 2 weeks` — from the RRULE, in words. */
  cadence: string
  minutes: number | null
  /** The next open occurrence's due day, or null if none is scheduled. */
  nextDue: string | null
  /**
   * How this one has behaved. Derived from finished occurrences, so it is a
   * record rather than a promise — and null when there are none to read.
   */
  history: string | null
}

const FREQ_WORD: Record<string, string> = {
  DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly',
}

/** An RRULE as a cadence in words. Unknown rules keep the rule. */
export function cadenceOf(rrule: string): string {
  const parts = Object.fromEntries(
    rrule.split(';').map(p => p.split('=') as [string, string]).filter(p => p.length === 2),
  )
  const freq = FREQ_WORD[parts.FREQ]
  if (!freq) return rrule
  const n = Number(parts.INTERVAL ?? 1)
  if (n <= 1) return freq
  const noun = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[parts.FREQ]!
  return `every ${n} ${noun}s`
}

/**
 * The repeating tasks in a project, collapsed to one entry each.
 *
 * Every occurrence is its own row, so a weekly task that has run for a term is
 * twenty rows with the same title. They are grouped by title — the same key
 * habits use, and for the same reason: an occurrence is an instance of a thing,
 * and the thing is what the panel is about.
 */
export function repeatingTasks(
  tasks: Pick<Task, 'id' | 'title' | 'rrule' | 'status' | 'type' | 'parent_id' |
                    'due_date' | 'completed_at' | 'estimated_minutes' | 'adjusted_minutes'>[],
): RepeatingTask[] {
  const byTitle = new Map<string, typeof tasks>()
  for (const t of tasks) {
    if (!t.rrule) continue
    byTitle.set(t.title, [...(byTitle.get(t.title) ?? []), t])
  }

  return [...byTitle.entries()].map(([title, group]) => {
    const open = group.filter(isActiveTask)
      .filter(t => t.due_date)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    const finished = group.filter(t => t.status === 'done' && t.completed_at && t.due_date)

    const nextDue = open[0]?.due_date?.slice(0, 10) ?? null
    const late = finished.filter(t =>
      t.completed_at!.slice(0, 10) > t.due_date!.slice(0, 10))

    return {
      id: (open[0] ?? group[0]).id,
      title,
      cadence: cadenceOf(group[0].rrule!),
      minutes: taskMinutes(open[0] ?? group[0]) || null,
      nextDue,
      history:
        finished.length === 0 ? null
        : late.length === 0
          ? `${finished.length === 1 ? 'The one that has run was' : `All ${finished.length} so far were`} on time.`
          : `${late.length} of ${finished.length} ${late.length === 1 ? 'was' : 'were'} late.`,
    }
  }).sort((a, b) =>
    (a.nextDue === null ? 1 : 0) - (b.nextDue === null ? 1 : 0)
    || (a.nextDue ?? '').localeCompare(b.nextDue ?? '')
    || a.title.localeCompare(b.title))
}

/** `Next one lands tomorrow.` / `The next one is 3 days overdue.` */
export function nextLanding(nextDue: string | null, todayStr: string): string {
  if (!nextDue) return 'Nothing scheduled.'
  const d = daysBetween(todayStr, nextDue)
  if (d < 0)  return `The next one is ${-d} day${d === -1 ? '' : 's'} overdue.`
  if (d === 0) return 'Next one lands today.'
  if (d === 1) return 'Next one lands tomorrow.'
  return `Next one lands in ${d} days.`
}
