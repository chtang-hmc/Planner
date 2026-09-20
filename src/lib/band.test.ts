import { describe, it, expect } from 'vitest'
import { bandKind, bandCopy, gapShape, type BandInput } from '@/lib/band'
import { NO_CAPACITY, type Capacity } from '@/lib/capacity'
import type { Interval } from '@/lib/scheduler'

const cap = (o: Partial<Capacity>): Capacity => ({ ...NO_CAPACITY, ...o })
const mins = (m: number, from = 0): Interval => [from * 60_000, (from + m) * 60_000]

const input = (o: Partial<BandInput>): BandInput => ({
  reason: 'available', capacity: NO_CAPACITY, gaps: [], dueCount: 0, ...o,
})

describe('which of six things the day is', () => {
  it('is unknown before it is anything else', () => {
    // Provenance beats arithmetic: a day nobody has looked at is unknown even
    // when the numbers would otherwise make it look empty.
    expect(bandKind(input({ reason: 'unknown', capacity: cap({ dueTotal: 670 }) }))).toBe('unknown')
  })

  it('is a day off even with eleven hours due on it', () => {
    expect(bandKind(input({ reason: 'dayOff', capacity: cap({ dueTotal: 670 }) }))).toBe('dayOff')
  })

  it('is nothing due when nothing is', () => {
    expect(bandKind(input({ capacity: cap({ freeBeforeCutoff: 445 }) }))).toBe('nothingDue')
  })

  it('is over capacity when the work exceeds the time', () => {
    expect(bandKind(input({ capacity: cap({ dueTotal: 650, freeBeforeCutoff: 105, freeAfterCutoff: 210 }) })))
      .toBe('overCapacity')
  })

  it('is fragmented when everything fits and nothing fits anywhere', () => {
    // 3h 05m free against 2h 30m due — fits by volume. But the largest hole is
    // 45m and the smallest thing left is an hour, so none of it can start.
    expect(bandKind(input({
      capacity: cap({ dueTotal: 150, freeBeforeCutoff: 185 }),
      gaps: [mins(45), mins(40, 60), mins(30, 120)],
      smallestTaskMinutes: 60,
    }))).toBe('fragmented')
  })

  it('is not fragmented when the smallest task does fit somewhere', () => {
    expect(bandKind(input({
      capacity: cap({ dueTotal: 150, freeBeforeCutoff: 185 }),
      gaps: [mins(45), mins(90, 60)],
      smallestTaskMinutes: 60,
    }))).toBe('fitsWithSlack')
  })

  it('cannot tell fragmented without knowing the smallest task', () => {
    // Derivable from the gaps alone it is not: a day of 45m holes is only a
    // failure relative to what is left to place.
    expect(bandKind(input({
      capacity: cap({ dueTotal: 150, freeBeforeCutoff: 185 }),
      gaps: [mins(45)],
    }))).toBe('fitsWithSlack')
  })
})

describe('the copy', () => {
  it('will not claim a number it cannot see', () => {
    const c = bandCopy(input({ reason: 'unknown', capacity: cap({ dueTotal: 670 }), dueCount: 11 }))
    expect(c.headline).toBe('Planner can’t see your day yet.')
    expect(c.supporting).toContain('unknown until something says when you are free')
    expect(c.legend).toEqual([])
    expect(c.primary).toBe('Connect calendar')
  })

  it('names the real day off it is moving work to', () => {
    const c = bandCopy(input({
      reason: 'dayOff', capacity: cap({ dueTotal: 670 }),
      nextWorkingDay: 'Monday', nextWorkingDayFree: 290,
    }))
    expect(c.headline).toBe('Today is a day off.')
    expect(c.supporting).toBe('11h 10m is still due today. Monday has 4h 50m free.')
    expect(c.primary).toBe('Move it all to Monday')
  })

  it('does not invent a day when none is enabled', () => {
    const c = bandCopy(input({ reason: 'dayOff', capacity: cap({ dueTotal: 670 }), nextWorkingDay: null }))
    expect(c.primary).toBe('Find a day')
  })

  it('stays quiet on a day off with nothing due', () => {
    // The one screen in this app that should be quiet.
    expect(bandCopy(input({ reason: 'dayOff' })).supporting).toBeNull()
  })

  it('says the deficit, and where the free time actually is', () => {
    const c = bandCopy(input({
      capacity: cap({ dueTotal: 650, freeBeforeCutoff: 105, freeAfterCutoff: 210 }), dueCount: 10,
    }))
    expect(c.headline).toBe('5h 35m of today’s work will not fit.')
    expect(c.supporting).toBe('10h 50m due across 10 tasks · 5h 15m free · and 3h 30m of that free time starts at 10pm.')
    expect(c.legend).toEqual([
      '1h 45m fits before 10pm',
      '3h 30m fits only after 10pm',
      '5h 35m has nowhere to go',
    ])
    expect(c.primary).toBe('Triage 5h 35m')
  })

  it('names what to start and where', () => {
    const c = bandCopy(input({
      capacity: cap({ dueTotal: 315, freeBeforeCutoff: 240, freeAfterCutoff: 205 }),
      start: { title: 'Clinic SOW', gapMinutes: 75, beforeTitle: 'Piano' },
    }))
    expect(c.headline).toBe('Everything due today fits, with 2h 10m spare.')
    expect(c.supporting).toBe('Start with Clinic SOW in the 1h 15m before Piano. It is the most urgent thing that fits there.')
    expect(c.primary).toBe('Start Clinic SOW')
    expect(c.secondary).toBe('Pull forward 2h 10m')
  })

  it('has no Start button when nothing can be started', () => {
    // 4b. There is nothing to start, so there is no primary; Triage demotes.
    const c = bandCopy(input({
      capacity: cap({ dueTotal: 150, freeBeforeCutoff: 185 }),
      gaps: [mins(45), mins(40, 60), mins(30, 120), mins(30, 180), mins(25, 240), mins(15, 300)],
      smallestTaskMinutes: 60,
    }))
    expect(c.kind).toBe('fragmented')
    expect(c.headline).toBe('Everything fits, but not in any one sitting.')
    expect(c.supporting).toContain('your longest gap is 45m and the smallest task left is 1h')
    expect(c.primary).toBeNull()
    expect(c.secondary).toBe('Triage')
    expect(c.legend[0]).toBe('3h 05m free, in six pieces — 45m, 40m, 30m, 30m, 25m, 15m')
  })

  it('offers nothing to do when nothing is due', () => {
    const c = bandCopy(input({
      capacity: cap({ freeBeforeCutoff: 445 }),
      nextDue: { title: 'OS HW 2', when: 'tomorrow', minutes: 180 },
    }))
    expect(c.headline).toBe('Nothing is due today.')
    expect(c.supporting).toBe('7h 25m free. The next thing due is OS HW 2 tomorrow at 3h.')
    expect(c.primary).toBeNull()
    expect(c.secondary).toBe('Pull work forward')
  })
})

describe('the fragmented bar draws the gaps themselves', () => {
  it('orders them longest first and drops empties', () => {
    expect(gapShape([mins(30), mins(45, 60), [0, 0], mins(15, 200)])).toEqual([45, 30, 15])
  })
})

describe('prose, not columns', () => {
  it('says "1h", not "1h 00m"', () => {
    // The band is sentences. Padding exists so a column of durations keeps its
    // minutes place; in a sentence it just reads wrong.
    const c = bandCopy(input({
      capacity: cap({ dueTotal: 60, freeBeforeCutoff: 180 }), dueCount: 1,
      start: { title: 'Clinic SOW', gapMinutes: 60 },
    }))
    expect(c.supporting).toBe('Start with Clinic SOW in the 1h. It is the most urgent thing that fits there.')
  })

  it('has a sentence for landing exactly, rather than "with — spare"', () => {
    const c = bandCopy(input({ capacity: cap({ dueTotal: 120, freeBeforeCutoff: 120 }), dueCount: 2 }))
    expect(c.headline).toBe('Everything due today fits, exactly.')
  })
})
