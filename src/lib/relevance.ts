/**
 * "Relevant" — what you could pick up in the next stretch of time.
 *
 * The full list answers "what do I owe anyone, ever". This answers "what am I
 * doing now", and it is on by default, so it decides what the task list looks
 * like on arrival. It is a display filter only: nothing is hidden from the
 * database, and turning it off brings everything back.
 *
 * Lives here rather than inside TaskList because the rule is the interesting
 * part and the component is not — pulling it out is what makes it testable, and
 * both of its numbers are now settings rather than constants someone has to go
 * and find.
 */
import type { Task } from '@/types'

/** How far ahead a deadline still counts as something to think about today. */
export const RELEVANT_WINDOW_DEFAULT = 7

/**
 * The priority that makes something current on its own, whatever its date says.
 * 3 = High.
 */
export const RELEVANT_MIN_PRIORITY_DEFAULT = 3

/** A day either side of sensible. A window of 0 means "due today or already on the calendar". */
export const RELEVANT_WINDOW_MIN = 0
export const RELEVANT_WINDOW_MAX = 90

export interface RelevanceConfig {
  /** Days ahead a deadline still counts. */
  windowDays: number
  /** Priority that qualifies a task on its own, regardless of its date. 1–4. */
  minPriority: number
}

export const RELEVANCE_DEFAULT: RelevanceConfig = {
  windowDays:  RELEVANT_WINDOW_DEFAULT,
  minPriority: RELEVANT_MIN_PRIORITY_DEFAULT,
}

/** Clamp whatever the database returned into something usable. */
export function normalizeRelevance(raw: {
  relevant_window_days?: unknown
  relevant_min_priority?: unknown
} | null | undefined): RelevanceConfig {
  const w = Number(raw?.relevant_window_days)
  const p = Number(raw?.relevant_min_priority)
  return {
    windowDays: Number.isInteger(w) && w >= RELEVANT_WINDOW_MIN && w <= RELEVANT_WINDOW_MAX
      ? w : RELEVANT_WINDOW_DEFAULT,
    minPriority: Number.isInteger(p) && p >= 1 && p <= 4
      ? p : RELEVANT_MIN_PRIORITY_DEFAULT,
  }
}

/**
 * Two disqualifiers, then three ways in.
 *
 * Out, whatever else is true:
 *   1. someday is a parking lot, never current
 *   2. a task gated by "not before" can't be started yet, however urgent
 *
 * In, if *any* of these holds:
 *   3. it is already blocked out on the calendar — that is the plan
 *   4. its deadline falls inside the window
 *   5. its priority is high enough to matter on its own
 *
 * 4 and 5 are an **or**, and each rescues what the other would drop. A Low
 * errand due tomorrow is current because it is due tomorrow, not because it is
 * important; a Critical piece of work due in three months is current because it
 * is Critical, even though the date is a long way off. Requiring both would
 * hide each of those, and they are the two most common things a person actually
 * wants to see.
 *
 * What falls out is the genuine backlog: unimportant work with no deadline, or
 * with one far enough away that it is not yet a question.
 *
 * `todayStr` and `horizonStr` are local day strings; comparing them as strings
 * is the comparison, since YYYY-MM-DD sorts lexicographically.
 */
export function isRelevant(
  t: Pick<Task, 'type' | 'start_date' | 'scheduled_start' | 'due_date' | 'priority'>,
  todayStr: string,
  horizonStr: string,
  minPriority: number = RELEVANT_MIN_PRIORITY_DEFAULT,
): boolean {
  if (t.type === 'someday') return false
  if (t.start_date && t.start_date.slice(0, 10) > todayStr) return false

  if (t.scheduled_start) return true
  if (t.due_date && t.due_date.slice(0, 10) <= horizonStr) return true
  return t.priority >= minPriority
}

/** How the toggle explains itself, in the user's own configured terms. */
export function relevanceHint({ windowDays, minPriority }: RelevanceConfig): string {
  const PRIORITY = ['', 'Low', 'Medium', 'High', 'Critical']
  const window = windowDays === 0
    ? 'due today'
    : windowDays === 1
      ? 'due today or tomorrow'
      : `due within ${windowDays} days`
  return `Anything ${window}, or ${PRIORITY[minPriority]}+ priority whenever it is due, `
       + `plus anything already on the calendar. `
       + `Hides someday and anything gated by "not before".`
}
