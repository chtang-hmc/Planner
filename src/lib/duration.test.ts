import { describe, it, expect } from 'vitest'
import { formatDuration } from '@/lib/duration'
import {
  capacitySegments, capacityVerdict, deficit, slack, freeTotal, NO_CAPACITY,
  type Capacity,
} from '@/lib/capacity'

describe('a duration in a column', () => {
  it('pads the minutes so the place does not move', () => {
    // The whole point: `1h` beside `1h 15m` puts the digits in different
    // columns, and a list of them stops being scannable.
    expect(formatDuration(60)).toBe('1h 00m')
    expect(formatDuration(75)).toBe('1h 15m')
    expect(formatDuration(150)).toBe('2h 30m')
  })

  it('leaves an hourless duration unpadded', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(5)).toBe('5m')
  })

  it('says nothing rather than "0m"', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

const cap = (over: Partial<Capacity>): Capacity => ({ ...NO_CAPACITY, ...over })

describe('capacity arithmetic', () => {
  it('never reports a negative deficit or negative slack', () => {
    expect(deficit(cap({ dueTotal: 60, freeBeforeCutoff: 300 }))).toBe(0)
    expect(slack(cap({ dueTotal: 300, freeBeforeCutoff: 60 }))).toBe(0)
  })

  it('counts late free time toward the total', () => {
    expect(freeTotal(cap({ freeBeforeCutoff: 105, freeAfterCutoff: 210 }))).toBe(315)
  })

  it('is short by what will not fit anywhere', () => {
    // The reference day: 10h 50m due, 1h 45m before ten, 3h 30m after.
    const d = cap({ dueTotal: 650, freeBeforeCutoff: 105, freeAfterCutoff: 210 })
    expect(deficit(d)).toBe(335)
    expect(capacityVerdict(d)).toEqual({ text: '5h 35m over capacity', tone: 'over' })
  })
})

describe('the bar is three segments of what is due, not of the day', () => {
  it('splits what fits from what fits only late from what does not', () => {
    const s = capacitySegments(cap({ dueTotal: 600, freeBeforeCutoff: 120, freeAfterCutoff: 180 }))!
    expect(s.fits).toBeCloseTo(0.2)
    expect(s.fitsLate).toBeCloseTo(0.3)
    expect(s.overflow).toBeCloseTo(0.5)
  })

  it('always sums to one, so the bar is full', () => {
    const s = capacitySegments(cap({ dueTotal: 137, freeBeforeCutoff: 41, freeAfterCutoff: 63 }))!
    expect(s.fits + s.fitsLate + s.overflow).toBeCloseTo(1)
  })

  it('never lets free time beyond what is due inflate a segment', () => {
    const s = capacitySegments(cap({ dueTotal: 60, freeBeforeCutoff: 600, freeAfterCutoff: 300 }))!
    expect(s).toEqual({ fits: 1, fitsLate: 0, overflow: 0 })
  })

  it('has no bar at all when nothing is due', () => {
    // An empty track would read as a finding. There isn't one.
    expect(capacitySegments(cap({ freeBeforeCutoff: 300 }))).toBeNull()
  })
})

describe('the verdict says which kind of "fits" it is', () => {
  it('separates fitting from fitting only after ten', () => {
    // Colouring this like "ok" would hide the thing the page exists to show.
    expect(capacityVerdict(cap({ dueTotal: 240, freeBeforeCutoff: 60, freeAfterCutoff: 210 })))
      .toEqual({ text: 'fits, 3h 00m of it after 10pm', tone: 'tight' })
  })

  it('reports slack when there is room to spare', () => {
    expect(capacityVerdict(cap({ dueTotal: 130, freeBeforeCutoff: 210 })))
      .toEqual({ text: 'fits, 1h 20m to spare', tone: 'ok' })
  })

  it('has a word for landing exactly', () => {
    expect(capacityVerdict(cap({ dueTotal: 120, freeBeforeCutoff: 120 })))
      .toEqual({ text: 'fits exactly', tone: 'ok' })
  })

  it('says nothing is due rather than that nothing fits', () => {
    expect(capacityVerdict(cap({ freeBeforeCutoff: 300 })))
      .toEqual({ text: 'Nothing due', tone: 'empty' })
  })
})
