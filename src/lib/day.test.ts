import { describe, it, expect } from 'vitest'
import {
  localDayStr, startOfLocalDay, localDayRange, addDays, dayOfWeek,
  todayStr, isValidTimezone, DEFAULT_TZ,
} from './day'

/**
 * Habit days are the user's calendar days. Getting this wrong filed evening
 * sessions under the wrong date three separate times, so the cases that
 * actually bit are pinned here: a zone behind UTC, a zone ahead of it, both
 * DST transitions, and a half-hour offset.
 */

const LA    = 'America/Los_Angeles'   // UTC-8 / UTC-7, DST
const TOKYO = 'Asia/Tokyo'            // UTC+9, no DST
const IST   = 'Asia/Kolkata'          // UTC+5:30, no DST

describe('localDayStr', () => {
  it('files a 7pm session in Los Angeles under that evening, not the next UTC day', () => {
    // 2026-09-16T02:00Z is 19:00 on the 15th in LA. Reading the UTC date here
    // is what lit tomorrow's heatmap square and moved the streak a day.
    expect(localDayStr(new Date('2026-09-16T02:00:00Z'), LA)).toBe('2026-09-15')
  })

  it('files an early-morning session in Tokyo under that morning, not the previous UTC day', () => {
    expect(localDayStr(new Date('2026-09-14T23:00:00Z'), TOKYO)).toBe('2026-09-15')
  })

  it('handles a half-hour offset', () => {
    expect(localDayStr(new Date('2026-09-14T18:45:00Z'), IST)).toBe('2026-09-15')
  })

  it('passes UTC through unchanged', () => {
    expect(localDayStr(new Date('2026-09-16T02:00:00Z'), 'UTC')).toBe('2026-09-16')
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(localDayStr('2026-09-16T02:00:00Z', LA)).toBe('2026-09-15')
  })
})

describe('startOfLocalDay', () => {
  it('finds midnight during PDT', () => {
    expect(startOfLocalDay('2026-09-15', LA).toISOString()).toBe('2026-09-15T07:00:00.000Z')
  })

  it('finds midnight ahead of UTC', () => {
    expect(startOfLocalDay('2026-09-15', TOKYO).toISOString()).toBe('2026-09-14T15:00:00.000Z')
  })

  it('finds midnight on a half-hour offset', () => {
    expect(startOfLocalDay('2026-09-15', IST).toISOString()).toBe('2026-09-14T18:30:00.000Z')
  })

  // The two-pass offset lookup exists for these: a single pass reads the offset
  // at UTC midnight, which is on the wrong side of the changeover.
  it('is still PDT on the day the clocks go back', () => {
    expect(startOfLocalDay('2026-11-01', LA).toISOString()).toBe('2026-11-01T07:00:00.000Z')
  })

  it('is PST the day after', () => {
    expect(startOfLocalDay('2026-11-02', LA).toISOString()).toBe('2026-11-02T08:00:00.000Z')
  })

  it('makes the fall-back day 25 hours long', () => {
    const hours = (startOfLocalDay('2026-11-02', LA).getTime()
                 - startOfLocalDay('2026-11-01', LA).getTime()) / 3_600_000
    expect(hours).toBe(25)
  })

  it('makes the spring-forward day 23 hours long', () => {
    const hours = (startOfLocalDay('2026-03-09', LA).getTime()
                 - startOfLocalDay('2026-03-08', LA).getTime()) / 3_600_000
    expect(hours).toBe(23)
  })

  it('puts an instant inside the repeated hour on the fall-back day', () => {
    // 01:30 happens twice on 2026-11-01 in LA; both are still that day.
    expect(localDayStr(new Date('2026-11-01T08:30:00Z'), LA)).toBe('2026-11-01')
    expect(localDayStr(new Date('2026-11-01T09:30:00Z'), LA)).toBe('2026-11-01')
  })
})

describe('localDayRange', () => {
  it('is half-open, so consecutive days touch without overlapping', () => {
    const a = localDayRange('2026-09-15', LA)
    const b = localDayRange('2026-09-16', LA)
    expect(a.endISO).toBe(b.startISO)
  })

  it('spans 25 hours across the fall-back day', () => {
    const { startISO, endISO } = localDayRange('2026-11-01', LA)
    expect((Date.parse(endISO) - Date.parse(startISO)) / 3_600_000).toBe(25)
  })

  it('contains an evening instant that UTC would push into the next day', () => {
    const { startISO, endISO } = localDayRange('2026-09-15', LA)
    const evening = '2026-09-16T02:00:00.000Z'
    expect(evening >= startISO && evening < endISO).toBe(true)
  })
})

describe('addDays', () => {
  // Pure calendar arithmetic: stepped in UTC, where every day is 24 hours, so a
  // DST day cannot turn into 23 or 25 and shift the result.
  it('steps across the fall-back day', () => {
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('steps back across the spring-forward day', () => {
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07')
  })

  it('crosses a month end', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('is its own inverse', () => {
    expect(addDays(addDays('2026-09-15', 7), -7)).toBe('2026-09-15')
  })
})

describe('dayOfWeek', () => {
  it('reads Sunday as 0 and Tuesday as 2', () => {
    expect(dayOfWeek('2026-09-13')).toBe(0)
    expect(dayOfWeek('2026-09-15')).toBe(2)
  })
})

describe('fallbacks', () => {
  it('rejects an unknown zone rather than throwing', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
    expect(isValidTimezone(LA)).toBe(true)
  })

  it('has a UTC default, which is the behaviour before the timezone column', () => {
    expect(DEFAULT_TZ).toBe('UTC')
  })

  it('returns a well-formed day for today', () => {
    expect(todayStr(LA)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
