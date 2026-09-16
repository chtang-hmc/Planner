import { describe, it, expect } from 'vitest'
import {
  weekStartOfDay, weekStartOf, daysSinceWeekStart, weekDayOrder,
  isWeekStartDay, WEEK_START_DEFAULT,
} from './week'

/**
 * "This week" decides what a habit's weekly target counts against, so the
 * boundary has to be identical in the completion path, the scheduler and the
 * habits page. It used to be hand-rolled and hardcoded to Monday in all three.
 */

const LA = 'America/Los_Angeles'

describe('weekStartOfDay', () => {
  // 2026-09-16 is a Wednesday.
  it('walks back to Monday for a Monday start', () => {
    expect(weekStartOfDay('2026-09-16', 1)).toBe('2026-09-14')
  })

  it('walks back to Sunday for a Sunday start', () => {
    expect(weekStartOfDay('2026-09-16', 0)).toBe('2026-09-13')
  })

  it('walks back to Saturday for a Saturday start', () => {
    expect(weekStartOfDay('2026-09-16', 6)).toBe('2026-09-12')
  })

  it('returns the day itself when it is already the week start', () => {
    expect(weekStartOfDay('2026-09-14', 1)).toBe('2026-09-14')
  })

  it('crosses a month boundary', () => {
    // 2026-10-01 is a Thursday; its Monday is in September.
    expect(weekStartOfDay('2026-10-01', 1)).toBe('2026-09-28')
  })

  it('is stable — the start of a week start is itself', () => {
    for (const start of [0, 1, 6]) {
      const ws = weekStartOfDay('2026-09-16', start)
      expect(weekStartOfDay(ws, start)).toBe(ws)
    }
  })
})

describe('weekStartOf', () => {
  it('resolves an instant in the user timezone, not UTC', () => {
    // 2026-09-14T02:00Z is Sunday the 13th at 19:00 in Los Angeles, so with a
    // Monday start it belongs to the week beginning the 7th — not the 14th.
    const instant = new Date('2026-09-14T02:00:00Z')
    expect(weekStartOf(instant, 1, LA)).toBe('2026-09-07')
    expect(weekStartOf(instant, 1, 'UTC')).toBe('2026-09-14')
  })
})

describe('daysSinceWeekStart', () => {
  it('is zero on the start day and grows through the week', () => {
    expect(daysSinceWeekStart(1, 1)).toBe(0)   // Monday, Monday start
    expect(daysSinceWeekStart(2, 1)).toBe(1)
    expect(daysSinceWeekStart(0, 1)).toBe(6)   // Sunday is the last day
  })

  it('wraps for a Saturday start', () => {
    expect(daysSinceWeekStart(6, 6)).toBe(0)
    expect(daysSinceWeekStart(0, 6)).toBe(1)
    expect(daysSinceWeekStart(5, 6)).toBe(6)
  })

  it('is always within the week', () => {
    for (let start = 0; start < 7; start++) {
      for (let dow = 0; dow < 7; dow++) {
        const n = daysSinceWeekStart(dow, start)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThan(7)
      }
    }
  })
})

describe('weekDayOrder', () => {
  it('starts on the configured day and covers the week once', () => {
    expect(weekDayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(weekDayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weekDayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5])
  })

  it('never repeats or drops a day', () => {
    for (let start = 0; start < 7; start++) {
      expect(new Set(weekDayOrder(start)).size).toBe(7)
    }
  })
})

describe('isWeekStartDay', () => {
  it('accepts only the three offered options', () => {
    expect(isWeekStartDay(0)).toBe(true)
    expect(isWeekStartDay(1)).toBe(true)
    expect(isWeekStartDay(6)).toBe(true)
    expect(isWeekStartDay(3)).toBe(false)
    expect(isWeekStartDay('1')).toBe(false)
    expect(isWeekStartDay(undefined)).toBe(false)
  })

  it('defaults to Monday', () => {
    expect(WEEK_START_DEFAULT).toBe(1)
  })
})
