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
const row = (over: Partial<Row> = {}): Row => ({
  type: 'task', start_date: null, scheduled_start: null, due_date: null, priority: 2,
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

  it('keeps a deadline inside the window and drops one beyond it', () => {
    expect(rel({ due_date: '2026-09-24T00:00:00Z' })).toBe(true)    // the edge counts
    expect(rel({ due_date: '2026-09-25T00:00:00Z' })).toBe(false)
  })

  it('keeps an overdue deadline', () => {
    expect(rel({ due_date: '2026-01-01T00:00:00Z' })).toBe(true)
  })

  it('falls back to priority when there is no deadline at all', () => {
    expect(rel({ priority: 4 })).toBe(true)
    expect(rel({ priority: 3 })).toBe(true)
    expect(rel({ priority: 2 })).toBe(false)
    expect(rel({ priority: 1 })).toBe(false)
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

  it('lets "not before" override the calendar', () => {
    // A gate that has not opened wins even over a booking: you cannot start it.
    expect(rel({ scheduled_start: '2026-09-18T17:00:00Z', start_date: '2026-10-01T00:00:00Z' })).toBe(false)
  })

  it('lets someday override everything', () => {
    expect(rel({ type: 'someday' as Task['type'], scheduled_start: '2026-09-18T17:00:00Z' })).toBe(false)
  })

  it('prefers a deadline over priority when both exist', () => {
    // A low-priority task due tomorrow is relevant; priority is only the
    // fallback for rows that have no date to judge.
    expect(rel({ due_date: '2026-09-18T00:00:00Z', priority: 1 })).toBe(true)
  })
})

describe('the window is configurable', () => {
  it('honours a tighter horizon', () => {
    // Same task, two-day window: the caller passes the horizon, so this is the
    // component's arithmetic being pinned rather than the rule's.
    expect(isRelevant(row({ due_date: '2026-09-24T00:00:00Z' }), TODAY, '2026-09-19')).toBe(false)
    expect(isRelevant(row({ due_date: '2026-09-18T00:00:00Z' }), TODAY, '2026-09-19')).toBe(true)
  })

  it('honours a lower priority threshold', () => {
    expect(rel({ priority: 2 }, 2)).toBe(true)
    expect(rel({ priority: 1 }, 2)).toBe(false)
    expect(rel({ priority: 1 }, 1)).toBe(true)
  })

  it('honours a stricter one', () => {
    expect(rel({ priority: 3 }, 4)).toBe(false)
    expect(rel({ priority: 4 }, 4)).toBe(true)
  })

  it('defaults to the behaviour that existed before it was a setting', () => {
    expect(RELEVANT_WINDOW_DEFAULT).toBe(7)
    expect(RELEVANT_MIN_PRIORITY_DEFAULT).toBe(3)
    expect(rel({ priority: 3 })).toBe(isRelevant(row({ priority: 3 }), TODAY, HORIZON, 3))
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
  it('describes the settings actually in force', () => {
    expect(relevanceHint({ windowDays: 7, minPriority: 3 })).toContain('next 7 days')
    expect(relevanceHint({ windowDays: 7, minPriority: 3 })).toContain('High+')
    expect(relevanceHint({ windowDays: 30, minPriority: 1 })).toContain('next 30 days')
    expect(relevanceHint({ windowDays: 30, minPriority: 1 })).toContain('Low+')
  })

  it('reads naturally at the small windows', () => {
    expect(relevanceHint({ windowDays: 0, minPriority: 3 })).toContain('due today,')
    expect(relevanceHint({ windowDays: 1, minPriority: 3 })).toContain('due today or tomorrow')
  })
})
