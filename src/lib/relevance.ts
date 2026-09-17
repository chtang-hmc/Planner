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
 * Without a deadline, priority is the only signal separating "matters" from
 * "eventually", so this is the line below which an undated task stays out of
 * the way. 3 = High.
 */
export const RELEVANT_MIN_PRIORITY_DEFAULT = 3

/** A day either side of sensible. A window of 0 means "due today or already on the calendar". */
export const RELEVANT_WINDOW_MIN = 0
export const RELEVANT_WINDOW_MAX = 90

export interface RelevanceConfig {
  /** Days ahead a deadline still counts. */
  windowDays: number
  /** Lowest priority an *undated* task can have and still show. 1–4. */
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
 * Five rules, checked in order, each dropping a different kind of noise.
 *
 *   1. someday is a parking lot, never current
 *   2. a task gated by "not before" can't be started yet, however urgent
 *   3. anything already blocked on the calendar is by definition the plan
 *   4. a deadline inside the window is live; one beyond it isn't yet
 *   5. no deadline at all falls back to priority
 *
 * The order carries meaning. Rule 3 sits above the deadline check deliberately:
 * putting something far-off on the calendar *is* the statement that you are
 * doing it soon, and it should not then be hidden for being far-off.
 *
 * Rule 5 is the one that surprises people. An undated task below the threshold
 * is invisible by default — which is the intent, but it is why a low-priority
 * errand with no date does not appear until the toggle is off.
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
  if (t.due_date) return t.due_date.slice(0, 10) <= horizonStr
  return t.priority >= minPriority
}

/** How the toggle explains itself, in the user's own configured terms. */
export function relevanceHint({ windowDays, minPriority }: RelevanceConfig): string {
  const PRIORITY = ['', 'Low', 'Medium', 'High', 'Critical']
  const window = windowDays === 0
    ? 'due today'
    : windowDays === 1
      ? 'due today or tomorrow'
      : `due in the next ${windowDays} days`
  return `Only what you can act on now — ${window}, already on the calendar, `
       + `or ${PRIORITY[minPriority]}+ priority with no deadline. `
       + `Hides someday and anything gated by "not before".`
}
