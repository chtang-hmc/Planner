import { describe, it, expect } from 'vitest'
import {
  isRelevant, normalizeRelevance, relevanceHint,
  RELEVANCE_DEFAULT, RELEVANT_WINDOW_DEFAULT, RELEVANT_MIN_PRIORITY_DEFAULT,
} from './relevance'
import type { Task } from '@/types'

/**
 * This filter is on by default, so it decides what the task list looks like on
 * arrival — a rule that hides the wrong thing is indistinguishable from a task
 * that was never created. Each rule is pinned separately, and so is the order
 * they run in, because the order is where the meaning lives.
 */

const TODAY   = '2026-09-17'
const HORIZON = '2026-09-24'   // seven days on

type Row = Parameters<typeof isRelevant>[0]

/** Priority 1 by default, so a row qualifies only on the grounds a test gives it. */
const row = (over: Partial<Row> = {}): Row => ({
  type: 'task', start_date: null, scheduled_start: null, due_date: null, priority: 1,
  ...over,
} as Row)

const rel = (over: Partial<Row> = {}, minPriority?: number) =>
  isRelevant(row(over), TODAY, HORIZON, minPriority)

describe('the two disqualifiers', () => {
  it('never counts someday, whatever else it has going for it', () => {
    expect(rel({ type: 'someday' as Task['type'], due_date: `${TODAY}T00:00:00Z`, priority: 4 })).toBe(false)
  })

  it('drops work gated by a future "not before"', () => {
    expect(rel({ due_date: `${TODAY}T00:00:00Z`, priority: 4, start_date: '2026-09-20T00:00:00Z' })).toBe(false)
  })

  it('keeps work whose gate has already opened', () => {
    expect(rel({ due_date: `${TODAY}T00:00:00Z`, start_date: '2026-09-10T00:00:00Z' })).toBe(true)
  })

  it('lets the gate override even a calendar booking', () => {
    // You cannot start it, however firmly it is booked.
    expect(rel({ scheduled_start: '2026-09-18T17:00:00Z', start_date: '2026-10-01T00:00:00Z' })).toBe(false)
  })
})

describe('the three ways in — any one is enough', () => {
  /**
   * The deadline and the priority are an **or**. Each rescues what the other
   * would drop, and these two cases are the whole reason for it.
   */
  it('admits an unimportant task because it is due soon', () => {
    expect(rel({ priority: 1, due_date: '2026-09-18T00:00:00Z' })).toBe(true)
  })

  it('admits an important task whose deadline is a long way off', () => {
    expect(rel({ priority: 4, due_date: '2027-06-01T00:00:00Z' })).toBe(true)
  })

  it('admits an important task with no deadline at all', () => {
    expect(rel({ priority: 4 })).toBe(true)
    expect(rel({ priority: 3 })).toBe(true)
  })

  it('admits anything already on the calendar, however small or far off', () => {
    expect(rel({ priority: 1, scheduled_start: '2026-11-01T17:00:00Z' })).toBe(true)
    expect(rel({ priority: 1, due_date: '2027-01-01T00:00:00Z', scheduled_start: '2026-09-18T17:00:00Z' })).toBe(true)
  })

  it('keeps an overdue deadline', () => {
    expect(rel({ priority: 1, due_date: '2026-01-01T00:00:00Z' })).toBe(true)
  })

  it('counts the last day of the window', () => {
    expect(rel({ priority: 1, due_date: '2026-09-24T00:00:00Z' })).toBe(true)
    expect(rel({ priority: 1, due_date: '2026-09-25T00:00:00Z' })).toBe(false)
  })
})

describe('what actually falls out', () => {
  /**
   * The backlog: work that is neither soon nor important. If this set were
   * empty the filter would be doing nothing.
   */
  it('drops unimportant work with a far-off deadline', () => {
    expect(rel({ priority: 2, due_date: '2027-01-01T00:00:00Z' })).toBe(false)
    expect(rel({ priority: 1, due_date: '2027-01-01T00:00:00Z' })).toBe(false)
  })

  it('drops unimportant work with no deadline', () => {
    expect(rel({ priority: 2 })).toBe(false)
    expect(rel({ priority: 1 })).toBe(false)
  })
})

describe('both numbers are configurable', () => {
  it('honours a tighter horizon', () => {
    // The caller passes the horizon, so this pins the component's arithmetic
    // rather than the rule's. Priority 1 so only the window can admit it.
    expect(isRelevant(row({ priority: 1, due_date: '2026-09-24T00:00:00Z' }), TODAY, '2026-09-19')).toBe(false)
    expect(isRelevant(row({ priority: 1, due_date: '2026-09-18T00:00:00Z' }), TODAY, '2026-09-19')).toBe(true)
  })

  it('honours a lower priority bar', () => {
    expect(rel({ priority: 2 }, 2)).toBe(true)
    expect(rel({ priority: 1 }, 2)).toBe(false)
    expect(rel({ priority: 1 }, 1)).toBe(true)
  })

  it('honours a stricter one', () => {
    expect(rel({ priority: 3 }, 4)).toBe(false)
    expect(rel({ priority: 4 }, 4)).toBe(true)
  })

  it('lets a stricter bar still admit something due soon', () => {
    // Raising the bar narrows what qualifies *on priority*; it does not start
    // hiding imminent work.
    expect(rel({ priority: 1, due_date: '2026-09-18T00:00:00Z' }, 4)).toBe(true)
  })

  it('defaults to High+ and a week', () => {
    expect(RELEVANT_WINDOW_DEFAULT).toBe(7)
    expect(RELEVANT_MIN_PRIORITY_DEFAULT).toBe(3)
  })
})

describe('normalizeRelevance', () => {
  it('passes through valid values', () => {
    expect(normalizeRelevance({ relevant_window_days: 14, relevant_min_priority: 2 }))
      .toEqual({ windowDays: 14, minPriority: 2 })
  })

  it('accepts a zero-day window — "due today or already booked"', () => {
    expect(normalizeRelevance({ relevant_window_days: 0 }).windowDays).toBe(0)
  })

  it('falls back on anything it cannot use', () => {
    // A pre-0017 database returns neither column; every other case here is a
    // value that would quietly distort the list if it were trusted.
    for (const raw of [
      null, undefined, {},
      { relevant_window_days: -1 }, { relevant_window_days: 999 },
      { relevant_window_days: 'soon' }, { relevant_window_days: 7.5 },
      { relevant_min_priority: 0 }, { relevant_min_priority: 5 },
    ]) {
      expect(normalizeRelevance(raw), JSON.stringify(raw)).toEqual(RELEVANCE_DEFAULT)
    }
  })
})

describe('relevanceHint', () => {
  it('names both ways in', () => {
    const hint = relevanceHint({ windowDays: 7, minPriority: 3 })
    expect(hint).toContain('within 7 days')
    expect(hint).toContain('High+ priority')
    expect(hint).toContain('or')
  })

  it('describes the window actually in force', () => {
    expect(relevanceHint({ windowDays: 7, minPriority: 3 })).toContain('within 7 days')
    expect(relevanceHint({ windowDays: 30, minPriority: 1 })).toContain('within 30 days')
  })

  it('reads naturally at the small windows', () => {
    expect(relevanceHint({ windowDays: 0, minPriority: 3 })).toContain('due today')
    expect(relevanceHint({ windowDays: 1, minPriority: 3 })).toContain('due today or tomorrow')
  })

  it('still mentions the calendar exception', () => {
    expect(relevanceHint(RELEVANCE_DEFAULT)).toContain('calendar')
  })
})
