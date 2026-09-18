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
 * The lowest priority that counts as current work, deadline or not. 3 = High.
 *
 * A deadline says *when*, not *whether it matters* — a Low task due tomorrow is
 * still a Low task, and the point of this filter is to get it out of the way
 * until you ask for it.
 */
export const RELEVANT_MIN_PRIORITY_DEFAULT = 3

/** A day either side of sensible. A window of 0 means "due today or already on the calendar". */
export const RELEVANT_WINDOW_MIN = 0
export const RELEVANT_WINDOW_MAX = 90

export interface RelevanceConfig {
  /** Days ahead a deadline still counts. */
  windowDays: number
  /** Lowest priority that counts as current work at all. 1–4. */
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
 *   4. priority is a floor: below it, nothing is current work
 *   5. a deadline inside the window is live; one beyond it isn't yet
 *
 * The order carries meaning.
 *
 * Rule 3 sits above everything that follows deliberately: putting something on
 * the calendar *is* the statement that you are doing it, and having decided
 * that explicitly it should not then be filtered back out for being low
 * priority or far off.
 *
 * Rule 4 applies to dated and undated work alike, which is the part worth
 * saying out loud. A deadline says *when*, not *whether it matters* — a Low
 * task due tomorrow is still a Low task. It was previously a fallback used only
 * when a task had no date, so a P1 errand due tomorrow sat at the top of the
 * list next to genuinely urgent work.
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
  if (t.priority < minPriority) return false
  if (t.due_date) return t.due_date.slice(0, 10) <= horizonStr
  return true
}

/** How the toggle explains itself, in the user's own configured terms. */
export function relevanceHint({ windowDays, minPriority }: RelevanceConfig): string {
  const PRIORITY = ['', 'Low', 'Medium', 'High', 'Critical']
  const window = windowDays === 0
    ? 'due today'
    : windowDays === 1
      ? 'due today or tomorrow'
      : `due within ${windowDays} days`
  return `${PRIORITY[minPriority]}+ priority work that is ${window} or undated, `
       + `plus anything already on the calendar. `
       + `Hides someday and anything gated by "not before".`
}
