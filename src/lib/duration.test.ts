import { describe, it, expect } from 'vitest'
import { formatDuration } from '@/lib/duration'
import {
  capacitySegments, capacityVerdict, capacityFromGaps, dueMinutesFor, slackWidth,
  deficit, slack, freeTotal, NO_CAPACITY, type Capacity,
} from '@/lib/capacity'
import { freeGaps, localMidnight, type WorkingHours } from '@/lib/scheduler'

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

describe('the bar scales to whichever is larger, due or free', () => {
  it('fills completely when the work is larger, so the track never shows', () => {
    const s = capacitySegments(cap({ dueTotal: 600, freeBeforeCutoff: 120, freeAfterCutoff: 180 }))!
    expect(s.fits).toBeCloseTo(0.2)
    expect(s.fitsLate).toBeCloseTo(0.3)
    expect(s.overflow).toBeCloseTo(0.5)
    expect(slackWidth(s)).toBeCloseTo(0)
  })

  it('sums to one whenever there is a deficit', () => {
    const s = capacitySegments(cap({ dueTotal: 137, freeBeforeCutoff: 41, freeAfterCutoff: 63 }))!
    expect(s.fits + s.fitsLate + s.overflow).toBeCloseTo(1)
  })

  it('leaves the slack as bare track when the time is larger', () => {
    // Scaling to `due` alone rendered a day with hours spare as a completely
    // full bar — so the one number worth seeing was the one it could not show.
    const s = capacitySegments(cap({ dueTotal: 60, freeBeforeCutoff: 180 }))!
    expect(s.fits).toBeCloseTo(1 / 3)
    expect(slackWidth(s)).toBeCloseTo(2 / 3)
  })

  it('keeps the late segment hatched on a day with slack', () => {
    const s = capacitySegments(cap({ dueTotal: 240, freeBeforeCutoff: 60, freeAfterCutoff: 210 }))!
    expect(s.fits).toBeCloseTo(60 / 270)
    expect(s.fitsLate).toBeCloseTo(180 / 270)
    expect(slackWidth(s)).toBeCloseTo(30 / 270)
  })

  it('draws an empty track when nothing is due', () => {
    // Beside a headline saying nothing is due, an empty track reads as "all of
    // this is yours" — which is the state, not a missing finding.
    const s = capacitySegments(cap({ freeBeforeCutoff: 300 }))!
    expect(s).toEqual({ fits: 0, fitsLate: 0, overflow: 0 })
    expect(slackWidth(s)).toBe(1)
  })

  it('draws nothing at all when there is no ratio', () => {
    // A day off with nothing due: no work, no time, no bar.
    expect(capacitySegments(NO_CAPACITY)).toBeNull()
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

// ─────────────────────────────────────────────────────────────────────────────

const TZ  = 'America/Los_Angeles'
const DAY = '2026-09-16'
const at  = (hhmm: string, d = DAY) => {
  const [h, m] = hhmm.split(':').map(Number)
  return localMidnight(d, TZ) + (h * 60 + m) * 60_000
}

describe('splitting free time around the cutoff', () => {
  const from = (gaps: [number, number][], dueMinutes = 0) =>
    capacityFromGaps({ gaps, dayStr: DAY, tz: TZ, dueMinutes })

  it('counts a gap wholly before the cutoff as early', () => {
    expect(from([[at('13:00'), at('15:00')]])).toMatchObject({
      freeBeforeCutoff: 120, freeAfterCutoff: 0,
    })
  })

  it('divides a gap that straddles it', () => {
    expect(from([[at('21:00'), at('23:30')]])).toMatchObject({
      freeBeforeCutoff: 60, freeAfterCutoff: 90,
    })
  })

  it('counts the whole past-midnight tail as late', () => {
    // The normal case here: working hours run to 01:30, so the largest free
    // stretch most days is 22:00 to 01:30 and none of it is prime time.
    expect(from([[at('22:00'), at('1:30', '2026-09-17')]])).toMatchObject({
      freeBeforeCutoff: 0, freeAfterCutoff: 210,
    })
  })

  it('sums across several gaps', () => {
    const c = from([
      [at('13:15'), at('14:45')],
      [at('17:00'), at('18:00')],
      [at('22:00'), at('1:30', '2026-09-17')],
    ])
    expect(c.freeBeforeCutoff).toBe(150)
    expect(c.freeAfterCutoff).toBe(210)
    expect(freeTotal(c)).toBe(360)
  })

  it('reports no free time on a day with no gaps rather than failing', () => {
    // A day switched off in working hours. Zero capacity is a real answer;
    // whether it should be *shown* as a deficit is the band's problem.
    expect(from([], 600)).toEqual({ dueTotal: 600, freeBeforeCutoff: 0, freeAfterCutoff: 0 })
  })

  it('takes its gaps from freeGaps, so overlaps are already handled', () => {
    const hours: WorkingHours[] = Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d, start_hour: 10, start_minute: 0,
      end_hour: 1, end_minute: 30, enabled: true,
    }))
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours,
      // Fall Fest with ENTR nested inside it: free resumes at 13:15, not 12:15.
      busy: [[at('11:00'), at('13:15')], [at('11:00'), at('12:15')]],
      minMinutes: 15,
    }).gaps
    const c = capacityFromGaps({ gaps, dayStr: DAY, tz: TZ, dueMinutes: 0 })
    expect(c.freeBeforeCutoff).toBe(60 + 525)   // 10:00-11:00, then 13:15-22:00
    expect(c.freeAfterCutoff).toBe(210)         // 22:00-01:30
  })
})

describe('what counts as due', () => {
  const tasks = [
    { dueDay: '2026-09-14', minutes: 60 },   // overdue
    { dueDay: DAY,          minutes: 150 },
    { dueDay: DAY,          minutes: null }, // unestimated
    { dueDay: '2026-09-20', minutes: 999 },  // later
    { dueDay: null,         minutes: 30 },   // undated
  ]

  it('includes overdue work, because the day still has to absorb it', () => {
    expect(dueMinutesFor(tasks, DAY)).toBe(210)
  })

  it('leaves later and undated work out', () => {
    expect(dueMinutesFor(tasks, '2026-09-13')).toBe(0)
  })

  it('contributes nothing for an unestimated task', () => {
    // Understates rather than guesses. A task with no estimate is a gap in the
    // input, not a task that takes no time.
    expect(dueMinutesFor([{ dueDay: DAY, minutes: null }], DAY)).toBe(0)
  })
})
