import { describe, it, expect } from 'vitest'
import {
  buildWeekStrip, barHeight, stripFinding,
  STRIP_FLOOR_MINUTES, STRIP_BAR_HEIGHT, STRIP_DAYS,
} from '@/lib/week-strip'
import { addDays } from '@/lib/day'

const TODAY = '2026-09-20'   // a Sunday
const free = (n: number) => ({ before: n, after: 0 })

describe('the strip starts at today', () => {
  it('runs forward, not from the start of the week', () => {
    // The old strip ran Monday to Sunday with today at the far right, so a
    // view called Upcoming showed mostly the past.
    const s = buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay: {} })
    expect(s.columns[0].day).toBe(TODAY)
    expect(s.columns[0].isToday).toBe(true)
    expect(s.columns.at(-1)!.day).toBe(addDays(TODAY, STRIP_DAYS - 1))
    expect(s.columns.filter(c => c.isToday)).toHaveLength(1)
  })

  it('labels each column with its weekday letter and date', () => {
    const s = buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay: {} })
    expect(s.columns.slice(0, 3).map(c => c.letter)).toEqual(['S', 'M', 'T'])
    expect(s.columns.slice(0, 3).map(c => c.date)).toEqual([20, 21, 22])
  })
})

describe('one shared scale, so columns can be compared', () => {
  it('measures against the busiest day', () => {
    const s = buildWeekStrip({
      todayStr: TODAY,
      freeByDay: { [TODAY]: free(300) },
      dueByDay: { [TODAY]: 1200 },
    })
    expect(s.scaleMinutes).toBe(1200)
  })

  it('floors at twelve hours, so a quiet fortnight is not magnified', () => {
    // Without the floor, a single twenty-minute day would draw a full-height
    // wall and read as a crisis.
    const s = buildWeekStrip({
      todayStr: TODAY, freeByDay: { [TODAY]: free(20) }, dueByDay: { [TODAY]: 20 },
    })
    expect(s.scaleMinutes).toBe(STRIP_FLOOR_MINUTES)
    expect(barHeight(20, s.scaleMinutes)).toBeLessThan(5)
  })

  it('draws a stub rather than nothing for a day with no work', () => {
    // A missing bar reads as a missing day.
    expect(barHeight(0, STRIP_FLOOR_MINUTES)).toBe(2)
  })

  it('gives the busiest day the full height', () => {
    expect(barHeight(600, 600)).toBe(STRIP_BAR_HEIGHT)
  })
})

describe('what each column knows', () => {
  it('reports a deficit only when there is one', () => {
    const s = buildWeekStrip({
      todayStr: TODAY,
      freeByDay: { [TODAY]: free(120), [addDays(TODAY, 1)]: free(600) },
      dueByDay:  { [TODAY]: 450,       [addDays(TODAY, 1)]: 120 },
    })
    expect(s.columns[0].deficit).toBe(330)
    expect(s.columns[1].deficit).toBe(0)
  })

  it('marks a day with no working hours, which has no ratio to draw', () => {
    const s = buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay: { [TODAY]: 60 } })
    expect(s.columns[0].dayOff).toBe(true)
    expect(s.columns[0].freeMinutes).toBe(0)
  })

  it('does not call a day off a deficit', () => {
    // Everything due is technically short against no hours at all, but a dash
    // saying "no ratio" beside a shortfall label is the column contradicting
    // itself — and the band already settled that a day off is not a deficit.
    const s = buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay: { [TODAY]: 600 } })
    expect(s.columns[0].deficit).toBe(0)
  })

  it('counts free time either side of the cutoff', () => {
    const s = buildWeekStrip({
      todayStr: TODAY, freeByDay: { [TODAY]: { before: 105, after: 210 } }, dueByDay: {},
    })
    expect(s.columns[0].freeMinutes).toBe(315)
  })
})

describe('the finding above the strip', () => {
  it('names a fortnight whose work is all at the front', () => {
    const s = buildWeekStrip({
      todayStr: TODAY, freeByDay: {},
      dueByDay: { [TODAY]: 300, [addDays(TODAY, 1)]: 200, [addDays(TODAY, 2)]: 100 },
    })
    expect(stripFinding(s)).toBe('Everything you owe is in the next 3 days. The other 11 are empty.')
  })

  it('says nothing when the work is spread', () => {
    // Inventing a finding is worse than having none.
    const dueByDay = Object.fromEntries(
      Array.from({ length: STRIP_DAYS }, (_, i) => [addDays(TODAY, i), 60]),
    )
    expect(stripFinding(buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay }))).toBeNull()
  })

  it('says nothing when nothing is due at all', () => {
    expect(stripFinding(buildWeekStrip({ todayStr: TODAY, freeByDay: {}, dueByDay: {} }))).toBeNull()
  })
})
