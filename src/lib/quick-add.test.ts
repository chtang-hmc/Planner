import { describe, it, expect } from 'vitest'
import { parseQuickAdd, formatDayLabel, formatTimeLabel } from './quick-add'

/**
 * The grammar is the contract, so it is pinned case by case.
 *
 * Reference instant: 2026-09-16T19:00:00Z — Wednesday 16 September, 12:00 in
 * Los Angeles. Deliberately an afternoon in a zone behind UTC, because the bug
 * this parser must not have is reading "tomorrow" off the UTC clock.
 */
const NOW = new Date('2026-09-16T19:00:00Z')
const LA  = 'America/Los_Angeles'

const p = (text: string, over: Partial<Parameters<typeof parseQuickAdd>[1]> = {}) =>
  parseQuickAdd(text, { tz: LA, now: NOW, ...over })

describe('relative days', () => {
  it('reads today, tomorrow and yesterday', () => {
    expect(p('Email Rosner today').dueDay).toBe('2026-09-16')
    expect(p('Email Rosner tomorrow').dueDay).toBe('2026-09-17')
    expect(p('Email Rosner yesterday').dueDay).toBe('2026-09-15')
    expect(p('Email Rosner the day after tomorrow').dueDay).toBe('2026-09-18')
  })

  it('accepts the short spellings', () => {
    for (const s of ['tod', 'today']) expect(p(`x ${s}`).dueDay).toBe('2026-09-16')
    for (const s of ['tom', 'tomo', 'tmr', 'tmrw', 'tomorrow'])
      expect(p(`x ${s}`).dueDay).toBe('2026-09-17')
  })

  it('counts in days, weeks, months and years', () => {
    expect(p('x in 3 days').dueDay).toBe('2026-09-19')
    expect(p('x in 2 weeks').dueDay).toBe('2026-09-30')
    expect(p('x in 1 month').dueDay).toBe('2026-10-16')
    expect(p('x in 1 year').dueDay).toBe('2027-09-16')
  })
})

describe('the timezone the day is read in', () => {
  /**
   * The whole reason this module takes a `tz`. At 19:00Z it is already the 17th
   * in Tokyo and still the 16th in Los Angeles, so "tomorrow" is a different
   * date in each — and reading the UTC clock would give LA the wrong one.
   */
  it('resolves tomorrow against the local day, not the UTC day', () => {
    expect(p('x tomorrow', { tz: LA }).dueDay).toBe('2026-09-17')
    expect(p('x tomorrow', { tz: 'Asia/Tokyo' }).dueDay).toBe('2026-09-18')
  })

  it('is unmoved by an evening instant that UTC would push into the next day', () => {
    // 02:00Z on the 17th is 19:00 on the 16th in LA — still Wednesday there.
    const evening = new Date('2026-09-17T02:00:00Z')
    expect(p('x today', { now: evening }).dueDay).toBe('2026-09-16')
  })
})

describe('weekdays', () => {
  // 2026-09-16 is a Wednesday.
  it('takes the next one to come round', () => {
    expect(p('x friday').dueDay).toBe('2026-09-18')
    expect(p('x monday').dueDay).toBe('2026-09-21')
  })

  it('treats the current weekday as today', () => {
    expect(p('x wednesday').dueDay).toBe('2026-09-16')
  })

  it('reads "next monday" as the Monday of next week', () => {
    // From a Wednesday the two spellings agree — the next Monday to come round
    // *is* next week's. That is the Todoist reading, and it is why the two are
    // not simply "+7 apart".
    expect(p('x monday').dueDay).toBe('2026-09-21')
    expect(p('x next monday').dueDay).toBe('2026-09-21')
  })

  it('separates them when today is that weekday', () => {
    // Standing on Monday 14 Sep: plain "monday" is today, "next monday" is the
    // 21st. This is the case where taking them as synonyms would be wrong.
    const monday = new Date('2026-09-14T19:00:00Z')
    expect(p('x monday',      { now: monday }).dueDay).toBe('2026-09-14')
    expect(p('x next monday', { now: monday }).dueDay).toBe('2026-09-21')
  })

  it('anchors "next <weekday>" on the configured first day of the week', () => {
    // Sunday 20 Sep. With a Monday-start week that Sunday closes the current
    // week, so next week's Saturday is the 26th; with a Sunday-start week the
    // 20th *opens* a week, pushing next week's Saturday to the 3rd.
    const sunday = new Date('2026-09-20T19:00:00Z')
    expect(p('x next saturday', { now: sunday, weekStart: 1 }).dueDay).toBe('2026-09-26')
    expect(p('x next saturday', { now: sunday, weekStart: 0 }).dueDay).toBe('2026-10-03')
  })

  it('reads "this friday" as the one in hand', () => {
    expect(p('x this friday').dueDay).toBe('2026-09-18')
    expect(p('x coming friday').dueDay).toBe('2026-09-18')
  })

  it('accepts abbreviations without truncating the long forms', () => {
    expect(p('x thu').dueDay).toBe('2026-09-17')
    expect(p('x thurs').dueDay).toBe('2026-09-17')
    expect(p('x thursday').dueDay).toBe('2026-09-17')
    expect(p('x thursday').title).toBe('x')   // not "x rsday"
  })
})

describe('absolute dates', () => {
  it('reads month-and-day in both orders', () => {
    expect(p('x jan 27').dueDay).toBe('2027-01-27')
    expect(p('x 27 jan').dueDay).toBe('2027-01-27')
    expect(p('x january 27').dueDay).toBe('2027-01-27')
    expect(p('x 27th january').dueDay).toBe('2027-01-27')
  })

  it('rolls a past month-day into next year', () => {
    // Today is 16 Sep 2026, so bare "jan 27" is the January still to come.
    expect(p('x jan 27').dueDay).toBe('2027-01-27')
    // …and a date later this year stays in this year.
    expect(p('x dec 25').dueDay).toBe('2026-12-25')
    // Today itself counts as still to come.
    expect(p('x sep 16').dueDay).toBe('2026-09-16')
    expect(p('x sep 15').dueDay).toBe('2027-09-15')
  })

  it('takes an explicit year at face value, including a past one', () => {
    expect(p('x jan 27 2029').dueDay).toBe('2029-01-27')
    expect(p('x jan 27, 2029').dueDay).toBe('2029-01-27')
    expect(p('x jan 27 2020').dueDay).toBe('2020-01-27')
  })

  it('reads numeric dates in the configured order', () => {
    expect(p('x 1/27').dueDay).toBe('2027-01-27')
    expect(p('x 27/1', { dateOrder: 'DMY' }).dueDay).toBe('2027-01-27')
    expect(p('x 3/4').dueDay).toBe('2027-03-04')
    expect(p('x 3/4', { dateOrder: 'DMY' }).dueDay).toBe('2027-04-03')
  })

  it('handles two-digit and four-digit years', () => {
    expect(p('x 1/27/29').dueDay).toBe('2029-01-27')
    expect(p('x 1/27/2029').dueDay).toBe('2029-01-27')
  })

  it('declines an impossible date rather than rounding it', () => {
    expect(p('x 13/45').dueDay).toBeNull()
    expect(p('x feb 30').dueDay).toBeNull()
    expect(p('x 13/45').title).toBe('x 13/45')
  })

  it('finds 29 February in a leap year', () => {
    expect(p('x feb 29').dueDay).toBe('2028-02-29')
  })
})

describe('week and month boundaries', () => {
  it('reads end of month as the last day, not the first of the next', () => {
    expect(p('x end of month').dueDay).toBe('2026-09-30')
    expect(p('x eom').dueDay).toBe('2026-09-30')
  })

  it('reads end of week against the configured first day', () => {
    expect(p('x end of week').dueDay).toBe('2026-09-20')               // Mon start → Sunday
    expect(p('x eow', { weekStart: 0 }).dueDay).toBe('2026-09-19')     // Sun start → Saturday
  })

  it('reads next week as the start of it', () => {
    expect(p('x next week').dueDay).toBe('2026-09-21')
    expect(p('x next week', { weekStart: 0 }).dueDay).toBe('2026-09-20')
  })

  it('keeps the day of month when moving a month, clamping a short one', () => {
    expect(p('x next month').dueDay).toBe('2026-10-16')
    // 31 Jan + 1 month has no 31st to land on.
    const jan31 = new Date('2027-01-31T19:00:00Z')
    expect(p('x next month', { now: jan31 }).dueDay).toBe('2027-02-28')
  })
})

describe('times', () => {
  it('reads 12-hour and 24-hour clocks', () => {
    expect(p('x at 5pm').timeMinutes).toBe(17 * 60)
    expect(p('x 5pm').timeMinutes).toBe(17 * 60)
    expect(p('x at 5:30pm').timeMinutes).toBe(17 * 60 + 30)
    expect(p('x at 17:00').timeMinutes).toBe(17 * 60)
    expect(p('x at 9:05').timeMinutes).toBe(9 * 60 + 5)
  })

  it('reads noon and midnight', () => {
    expect(p('x at noon').timeMinutes).toBe(12 * 60)
    expect(p('x at midnight').timeMinutes).toBe(0)
  })

  it('gets the 12s right', () => {
    expect(p('x 12am').timeMinutes).toBe(0)
    expect(p('x 12pm').timeMinutes).toBe(12 * 60)
  })

  it('does not read a bare number as a clock time', () => {
    // "at 5" is more often a quantity than an hour, and guessing silently
    // schedules the wrong time. It stays in the title.
    expect(p('Read at 5 pages').timeMinutes).toBeNull()
    expect(p('Read at 5 pages').title).toBe('Read at 5 pages')
  })

  it('combines with a date', () => {
    const r = p('Email Rosner tomorrow at 5pm')
    expect(r.dueDay).toBe('2026-09-17')
    expect(r.timeMinutes).toBe(17 * 60)
    expect(r.title).toBe('Email Rosner')
  })

  it('accepts the time before the date', () => {
    const r = p('Standup 9am tomorrow')
    expect(r.dueDay).toBe('2026-09-17')
    expect(r.timeMinutes).toBe(9 * 60)
    expect(r.title).toBe('Standup')
  })

  it('does not read the day number of a date as a time', () => {
    expect(p('x jan 27').timeMinutes).toBeNull()
    expect(p('x 3/4').timeMinutes).toBeNull()
  })
})

describe('the title', () => {
  it('has the recognised span removed', () => {
    expect(p('Email Rosner tomorrow').title).toBe('Email Rosner')
    expect(p('tomorrow Email Rosner').title).toBe('Email Rosner')
    expect(p('Email tomorrow Rosner').title).toBe('Email Rosner')
  })

  it('takes the preposition with the date', () => {
    expect(p('Pay rent by friday').title).toBe('Pay rent')
    expect(p('Pay rent due friday').title).toBe('Pay rent')
    expect(p('Pay rent on friday').title).toBe('Pay rent')
    expect(p('Pay rent due by friday').title).toBe('Pay rent')
  })

  it('is left alone when nothing is recognised', () => {
    const r = p('Refactor the scheduler')
    expect(r.title).toBe('Refactor the scheduler')
    expect(r.dueDay).toBeNull()
    expect(r.tokens).toHaveLength(0)
  })

  it('can be empty when the whole string was a date', () => {
    expect(p('tomorrow').title).toBe('')
  })

  it('does not match a date word inside a longer word', () => {
    // The classic false positive: "Tomorrowland" is not tomorrow.
    expect(p('Buy Tomorrowland tickets').dueDay).toBeNull()
    expect(p('Buy Tomorrowland tickets').title).toBe('Buy Tomorrowland tickets')
    expect(p('Book a satsang').dueDay).toBeNull()
    expect(p('Review the montage').dueDay).toBeNull()
  })

  it('takes the first date when several are present', () => {
    const r = p('Call mom monday about friday plans')
    expect(r.dueDay).toBe('2026-09-21')
    expect(r.title).toBe('Call mom about friday plans')
  })
})

describe('token offsets', () => {
  it('point at the source text, so the input can highlight in place', () => {
    const text = 'Email Rosner tomorrow at 5pm'
    const r = parseQuickAdd(text, { tz: LA, now: NOW })
    expect(r.tokens).toHaveLength(2)
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text)
    expect(r.tokens[0].type).toBe('date')
    expect(r.tokens[1].type).toBe('time')
    expect(r.tokens.map(t => t.label)).toEqual(['Tomorrow', '5 PM'])
  })

  it('come back in source order', () => {
    const r = p('Standup 9am tomorrow')
    expect(r.tokens.map(t => t.type)).toEqual(['time', 'date'])
    expect(r.tokens[0].start).toBeLessThan(r.tokens[1].start)
  })

  it('never overlap', () => {
    const r = p('Email Rosner tomorrow at 5pm')
    expect(r.tokens[0].end).toBeLessThanOrEqual(r.tokens[1].start)
  })
})

describe('dueISO', () => {
  /**
   * `due_date` is UTC midnight of the *local* day throughout the app — every
   * comparison does `.slice(0, 10)`. Storing the real instant of "5pm in LA"
   * would make that read as the following day.
   */
  it('is UTC midnight of the local day', () => {
    expect(p('x tomorrow').dueISO).toBe('2026-09-17T00:00:00.000Z')
  })

  it('is unaffected by a parsed time', () => {
    expect(p('x tomorrow at 11pm').dueISO).toBe('2026-09-17T00:00:00.000Z')
    expect(p('x tomorrow at 11pm').dueISO!.slice(0, 10)).toBe('2026-09-17')
  })

  it('is null when no date was found', () => {
    expect(p('Refactor the scheduler').dueISO).toBeNull()
  })
})

describe('labels', () => {
  it('names the near days and falls back to a date', () => {
    const today = '2026-09-16'
    expect(formatDayLabel('2026-09-16', today)).toBe('Today')
    expect(formatDayLabel('2026-09-17', today)).toBe('Tomorrow')
    expect(formatDayLabel('2026-09-15', today)).toBe('Yesterday')
    expect(formatDayLabel('2026-09-18', today)).toBe('Friday')
    expect(formatDayLabel('2026-10-30', today)).toBe('30 Oct')
    expect(formatDayLabel('2027-01-27', today)).toBe('27 Jan 2027')
  })

  it('writes times on a 12-hour clock', () => {
    expect(formatTimeLabel(0)).toBe('12 AM')
    expect(formatTimeLabel(9 * 60)).toBe('9 AM')
    expect(formatTimeLabel(12 * 60)).toBe('12 PM')
    expect(formatTimeLabel(17 * 60)).toBe('5 PM')
    expect(formatTimeLabel(17 * 60 + 30)).toBe('5:30 PM')
  })
})

describe('robustness', () => {
  it('handles empty and whitespace input', () => {
    expect(p('').title).toBe('')
    expect(p('   ').title).toBe('')
    expect(p('').dueDay).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(p('x TOMORROW').dueDay).toBe('2026-09-17')
    expect(p('x Next Monday').dueDay).toBe('2026-09-21')
    expect(p('x JAN 27').dueDay).toBe('2027-01-27')
  })

  it('never throws on arbitrary input', () => {
    const junk = ['///', '99/99/99', 'in  days', 'at :', '1/2/3/4/5', 'next', 'every', '5:99pm']
    for (const s of junk) expect(() => p(s)).not.toThrow()
  })
})
