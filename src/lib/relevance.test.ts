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

/** Priority 3 by default, so a row clears the floor unless a test lowers it. */
const row = (over: Partial<Row> = {}): Row => ({
  type: 'task', start_date: null, scheduled_start: null, due_date: null, priority: 3,
  ...over,
} as Row)

const rel = (over: Partial<Row> = {}, minPriority?: number) =>
  isRelevant(row(over), TODAY, HORIZON, minPriority)

describe('the five rules', () => {
  it('never counts someday, whatever else it has going for it', () => {
    expect(rel({ type: 'someday' as Task['type'], due_date: `${TODAY}T00:00:00Z`, priority: 4 })).toBe(false)
  })

  it('drops work gated by a future "not before"', () => {
    expect(rel({ due_date: `${TODAY}T00:00:00Z`, start_date: '2026-09-20T00:00:00Z' })).toBe(false)
  })

  it('keeps work whose gate has already opened', () => {
    expect(rel({ due_date: `${TODAY}T00:00:00Z`, start_date: '2026-09-10T00:00:00Z' })).toBe(true)
  })

  it('keeps anything already on the calendar', () => {
    expect(rel({ scheduled_start: '2026-11-01T17:00:00Z' })).toBe(true)
  })

  it('applies the priority floor to dated and undated work alike', () => {
    // The point of the rule: a deadline says *when*, not whether it matters.
    expect(rel({ priority: 2, due_date: '2026-09-18T00:00:00Z' })).toBe(false)
    expect(rel({ priority: 2 })).toBe(false)
    expect(rel({ priority: 3, due_date: '2026-09-18T00:00:00Z' })).toBe(true)
    expect(rel({ priority: 3 })).toBe(true)
  })

  it('keeps a deadline inside the window and drops one beyond it', () => {
    expect(rel({ due_date: '2026-09-24T00:00:00Z' })).toBe(true)    // the edge counts
    expect(rel({ due_date: '2026-09-25T00:00:00Z' })).toBe(false)
  })

  it('keeps an overdue deadline', () => {
    expect(rel({ due_date: '2026-01-01T00:00:00Z' })).toBe(true)
  })

  it('keeps undated work that clears the floor', () => {
    expect(rel({ priority: 4 })).toBe(true)
    expect(rel({ priority: 3 })).toBe(true)
  })
})

describe('the order of the rules', () => {
  /**
   * Each of these passes one rule and fails another; the answer says which rule
   * ran first. Reordering them would break these and nothing else, which is the
   * point of having them.
   */
  it('lets the calendar override a far-off deadline', () => {
    // Booking something far-off *is* the statement that you are doing it soon.
    expect(rel({ due_date: '2027-01-01T00:00:00Z', scheduled_start: '2026-09-18T17:00:00Z' })).toBe(true)
  })

  it('lets the calendar override the priority floor', () => {
    // Having decided explicitly to do a small thing at a set time, the filter
    // should not then take it back out for being small.
    expect(rel({ priority: 1, scheduled_start: '2026-09-18T17:00:00Z' })).toBe(true)
  })

  it('lets "not before" override the calendar', () => {
    // A gate that has not opened wins even over a booking: you cannot start it.
    expect(rel({ scheduled_start: '2026-09-18T17:00:00Z', start_date: '2026-10-01T00:00:00Z' })).toBe(false)
  })

  it('lets someday override everything', () => {
    expect(rel({ type: 'someday' as Task['type'], scheduled_start: '2026-09-18T17:00:00Z' })).toBe(false)
  })

  it('applies the floor before the deadline, not after', () => {
    // A Low task due tomorrow is still a Low task. This is the case that
    // changed: the deadline used to win outright.
    expect(rel({ priority: 1, due_date: '2026-09-18T00:00:00Z' })).toBe(false)
  })
})

describe('the window is configurable', () => {
  it('honours a tighter horizon', () => {
    // The caller passes the horizon, so this pins the component's arithmetic
    // rather than the rule's.
    expect(isRelevant(row({ due_date: '2026-09-24T00:00:00Z' }), TODAY, '2026-09-19')).toBe(false)
    expect(isRelevant(row({ due_date: '2026-09-18T00:00:00Z' }), TODAY, '2026-09-19')).toBe(true)
  })

  it('honours a lower priority threshold', () => {
    expect(rel({ priority: 2 }, 2)).toBe(true)
    expect(rel({ priority: 1 }, 2)).toBe(false)
    expect(rel({ priority: 1 }, 1)).toBe(true)
  })

  it('honours a stricter one, deadline or not', () => {
    expect(rel({ priority: 3 }, 4)).toBe(false)
    expect(rel({ priority: 3, due_date: '2026-09-18T00:00:00Z' }, 4)).toBe(false)
    expect(rel({ priority: 4, due_date: '2026-09-18T00:00:00Z' }, 4)).toBe(true)
  })

  it('lets a floor of 1 admit everything that is dated or undated', () => {
    // With no floor to clear, only someday, the gate and the window filter.
    expect(rel({ priority: 1 }, 1)).toBe(true)
    expect(rel({ priority: 1, due_date: '2026-09-18T00:00:00Z' }, 1)).toBe(true)
    expect(rel({ priority: 1, due_date: '2027-01-01T00:00:00Z' }, 1)).toBe(false)  // still the window
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
  it('leads with the priority floor, since it now applies to everything', () => {
    expect(relevanceHint({ windowDays: 7, minPriority: 3 })).toMatch(/^High\+ priority/)
    expect(relevanceHint({ windowDays: 30, minPriority: 1 })).toMatch(/^Low\+ priority/)
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
