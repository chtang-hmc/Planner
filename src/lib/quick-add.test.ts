import { describe, it, expect } from 'vitest'
import { parseQuickAdd, formatDayLabel, formatTimeLabel } from './quick-add'
import { rruleToPreset, getNextOccurrence, type RecurrencePreset } from './rrule-utils'

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

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence
// ─────────────────────────────────────────────────────────────────────────────

describe('recurrence: the rule produced', () => {
  it('reads the plain frequencies', () => {
    expect(p('Standup every day').rrule).toBe('FREQ=DAILY')
    expect(p('Review every week').rrule).toBe('FREQ=WEEKLY')
    expect(p('Rent every month').rrule).toBe('FREQ=MONTHLY')
    expect(p('Renew every year').rrule).toBe('FREQ=YEARLY')
  })

  it('reads the bare adverbs', () => {
    expect(p('Standup daily').rrule).toBe('FREQ=DAILY')
    expect(p('Review weekly').rrule).toBe('FREQ=WEEKLY')
    expect(p('Rent monthly').rrule).toBe('FREQ=MONTHLY')
    expect(p('Renew yearly').rrule).toBe('FREQ=YEARLY')
    expect(p('Renew annually').rrule).toBe('FREQ=YEARLY')
  })

  it('reads intervals', () => {
    expect(p('Water plants every 3 days').rrule).toBe('FREQ=DAILY;INTERVAL=3')
    expect(p('Report every 2 weeks').rrule).toBe('FREQ=WEEKLY;INTERVAL=2')
    expect(p('Deep clean every 6 months').rrule).toBe('FREQ=MONTHLY;INTERVAL=6')
  })

  it('reads "every other" as an interval of two', () => {
    expect(p('Bins every other week').rrule).toBe('FREQ=WEEKLY;INTERVAL=2')
    expect(p('Shave every other day').rrule).toBe('FREQ=DAILY;INTERVAL=2')
  })

  it('drops a redundant INTERVAL=1 so it matches the plain form', () => {
    // Otherwise "every 1 week" and "every week" would be different strings and
    // one of them would miss its preset in the recurrence picker.
    expect(p('x every 1 week').rrule).toBe(p('x every week').rrule)
    expect(p('x every 1 day').rrule).toBe('FREQ=DAILY')
  })

  it('reads single and multiple weekdays', () => {
    expect(p('Gym every monday').rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(p('Gym every mon, wed and fri').rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    expect(p('Gym every tuesday & thursday').rrule).toBe('FREQ=WEEKLY;BYDAY=TU,TH')
  })

  it('puts weekdays in week order however they were typed, without repeats', () => {
    expect(p('x every fri, mon, fri').rrule).toBe('FREQ=WEEKLY;BYDAY=MO,FR')
  })

  it('reads weekday and weekend shorthands', () => {
    expect(p('Standup every weekday').rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(p('Long run every weekend').rrule).toBe('FREQ=WEEKLY;BYDAY=SA,SU')
  })

  it('reads a day of the month, and the last day', () => {
    expect(p('Rent every 1st').rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=1')
    expect(p('Invoice every 27th').rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=27')
    expect(p('Close books every last day of the month').rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=-1')
  })

  it('reads an annual date', () => {
    expect(p("Mum's birthday every jan 27").rrule).toBe('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=27')
    expect(p('Leap thing every feb 29').rrule).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29')
  })

  it('leaves the title clean', () => {
    expect(p('Gym every mon, wed and fri').title).toBe('Gym')
    expect(p('Water plants every 3 days').title).toBe('Water plants')
    expect(p('Standup daily').title).toBe('Standup')
  })

  it('is null when nothing repeats', () => {
    expect(p('Email Rosner tomorrow').rrule).toBeNull()
    expect(p('Every mountain has a name').rrule).toBeNull()
  })
})

describe('recurrence: strings the app already understands', () => {
  /**
   * The grammar is a second way to reach the recurrence picker's settings, not
   * a parallel set of them. Where a phrase names a preset the string has to be
   * byte-identical, or the picker shows "custom" for something it has a label
   * for.
   */
  it('matches the presets exactly', () => {
    const cases: [string, RecurrencePreset][] = [
      ['x every day',      'daily'],
      ['x every weekday',  'weekdays'],
      ['x every monday',   'weekly_mon'],
      ['x every friday',   'weekly_fri'],
      ['x every sunday',   'weekly_sun'],
      ['x every month',    'monthly'],
    ]
    for (const [text, preset] of cases) {
      expect(rruleToPreset(p(text).rrule)).toBe(preset)
    }
  })

  it('produces rules the scheduler can actually advance', () => {
    // Every string this grammar emits has to survive a round trip through the
    // same helper completeTask uses to spawn the next occurrence.
    const texts = [
      'x every day', 'x every 3 days', 'x every other week', 'x every monday',
      'x every mon, wed and fri', 'x every weekday', 'x every weekend',
      'x every 27th', 'x every last day of the month', 'x every jan 27',
      'x every month', 'x every year', 'x weekly',
    ]
    for (const text of texts) {
      const { rrule } = p(text)
      expect(rrule, text).not.toBeNull()
      const next = getNextOccurrence(rrule!, new Date('2026-09-16T00:00:00Z'))
      expect(next, text).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // Day strings sort lexicographically, so a plain comparison is the date
      // comparison. toBeGreaterThan would coerce and compare as numbers.
      expect(next! > '2026-09-16', text).toBe(true)
    }
  })
})

describe('recurrence: the first occurrence', () => {
  it('is set from the rule when no date was given', () => {
    // Today is Wednesday 16 Sep.
    expect(p('Gym every monday').dueDay).toBe('2026-09-21')
    expect(p('Invoice every 27th').dueDay).toBe('2026-09-27')
    expect(p('Renew every jan 27').dueDay).toBe('2027-01-27')
  })

  it('includes today rather than skipping a week', () => {
    // "every wednesday" typed on a Wednesday means today. Asking the rule for
    // the occurrence strictly *after* today — which is what completeTask wants
    // — would push it to the 23rd and quietly lose a session.
    expect(p('Gym every wednesday').dueDay).toBe('2026-09-16')
    expect(p('Standup every day').dueDay).toBe('2026-09-16')
  })

  it('yields to an explicit date', () => {
    const r = p('Standup every day starting friday')
    expect(r.rrule).toBe('FREQ=DAILY')
    expect(r.dueDay).toBe('2026-09-18')
    expect(r.title).toBe('Standup')
  })

  it('takes "starting" and "from" as date prefixes', () => {
    expect(p('x every week starting monday').dueDay).toBe('2026-09-21')
    expect(p('x every week from monday').dueDay).toBe('2026-09-21')
  })
})

describe('recurrence: every! counts from completion', () => {
  it('is off by default', () => {
    expect(p('Water plants every 3 days').recurrenceFromCompletion).toBe(false)
  })

  it('is set by the bang', () => {
    expect(p('Water plants every! 3 days').recurrenceFromCompletion).toBe(true)
    expect(p('Water plants every! 3 days').rrule).toBe('FREQ=DAILY;INTERVAL=3')
  })

  it('works across the forms that take it', () => {
    for (const text of ['x every! day', 'x every! monday', 'x every! other week',
                        'x every! 27th', 'x every! weekday']) {
      expect(p(text).recurrenceFromCompletion, text).toBe(true)
      expect(p(text).rrule, text).not.toBeNull()
    }
  })

  it('leaves no bang in the title', () => {
    expect(p('Water plants every! 3 days').title).toBe('Water plants')
  })
})

describe('recurrence: reading order against dates and times', () => {
  /**
   * The rule that makes the rest work: "every monday" contains a weekday and
   * "every jan 27" contains a date. Scanning dates first would strand a bare
   * "every" in the title and set a one-off deadline where a repeat was asked
   * for.
   */
  it('does not let the date scanner eat the weekday of a repeat', () => {
    const r = p('Gym every monday')
    expect(r.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r.title).toBe('Gym')
    expect(r.tokens.map(t => t.type)).toEqual(['recurrence'])
  })

  it('does not let it eat the date of an annual repeat', () => {
    const r = p('Renew every jan 27')
    expect(r.rrule).toBe('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=27')
    expect(r.title).toBe('Renew')
  })

  it('carries a recurrence, a date and a time together', () => {
    const r = p('Standup every weekday starting monday at 9am')
    expect(r.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(r.dueDay).toBe('2026-09-21')
    expect(r.timeMinutes).toBe(9 * 60)
    expect(r.title).toBe('Standup')
    expect(r.tokens.map(t => t.type)).toEqual(['recurrence', 'date', 'time'])
  })

  it('keeps token offsets pointing at the source', () => {
    const text = 'Standup every weekday starting monday at 9am'
    const r = parseQuickAdd(text, { tz: LA, now: NOW })
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text)
  })
})

describe('recurrence: what it declines', () => {
  it('does not fire on "every" alone', () => {
    expect(p('Every effort counts').rrule).toBeNull()
    expect(p('every').rrule).toBeNull()
  })

  it('needs an ordinal suffix for a day of the month', () => {
    // "every 27" is indistinguishable from a count, so it is not a monthly
    // repeat — and nothing else claims it either.
    expect(p('x every 27').rrule).toBeNull()
  })

  it('declines an impossible annual date', () => {
    expect(p('x every feb 30').rrule).toBeNull()
  })

  it('never throws', () => {
    for (const s of ['every!', 'every! ', 'every 0 days', 'every 999 years',
                     'every mon,', 'every ,', 'every 32nd']) {
      expect(() => p(s), s).not.toThrow()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Project, priority and estimate
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTS = [
  { id: 'pp',    name: 'Public Policy' },
  { id: 'teach', name: 'Teaching' },
  { id: 'clin',  name: 'Clinic' },
  { id: 'course', name: 'Coursework' },
]
const withProjects = (text: string, projects = PROJECTS) =>
  parseQuickAdd(text, { tz: LA, now: NOW, projects })

describe('#project', () => {
  it('matches an exact name, case-insensitively', () => {
    expect(withProjects('Read Dahl #Teaching').projectId).toBe('teach')
    expect(withProjects('Read Dahl #teaching').projectId).toBe('teach')
  })

  it('matches a unique prefix', () => {
    expect(withProjects('Read Dahl #teach').projectId).toBe('teach')
    expect(withProjects('Read Dahl #cli').projectId).toBe('clin')
  })

  it('declines an ambiguous prefix rather than guessing', () => {
    // "c" starts both Clinic and Coursework.
    const r = withProjects('Read Dahl #c')
    expect(r.projectId).toBeNull()
    expect(r.title).toBe('Read Dahl #c')
  })

  it('takes a multi-word name in braces', () => {
    expect(withProjects('Read Dahl #{Public Policy}').projectId).toBe('pp')
    expect(withProjects('Read Dahl #{Public Policy}').title).toBe('Read Dahl')
  })

  it('never invents a project that does not exist', () => {
    const r = withProjects('Read Dahl #Nonsense')
    expect(r.projectId).toBeNull()
    expect(r.title).toBe('Read Dahl #Nonsense')
  })

  it('does nothing when no projects were supplied', () => {
    expect(p('Read Dahl #Teaching').projectId).toBeNull()
    expect(p('Read Dahl #Teaching').title).toBe('Read Dahl #Teaching')
  })

  it('leaves the title clean when it does match', () => {
    expect(withProjects('Read Dahl #Teaching').title).toBe('Read Dahl')
    expect(withProjects('#Teaching Read Dahl').title).toBe('Read Dahl')
  })
})

describe('p1–p4', () => {
  /**
   * The app's own scale: 1 = Low, 4 = Critical. This is the opposite of
   * Todoist, and it is the right way round here — the add-task modal beside
   * this field offers priority as four buttons labelled 1 2 3 4 where 4 is
   * Critical, so `p1` meaning anything other than that button would be a trap.
   */
  it('reads the number as the app numbers priority', () => {
    expect(p('Fix bug p1').priority).toBe(1)
    expect(p('Fix bug p4').priority).toBe(4)
  })

  it('labels it with the app word, not the number', () => {
    expect(p('Fix bug p1').tokens.find(t => t.type === 'priority')?.label).toBe('Low')
    expect(p('Fix bug p4').tokens.find(t => t.type === 'priority')?.label).toBe('Critical')
  })

  it('is case-insensitive and leaves the title clean', () => {
    expect(p('Fix bug P3').priority).toBe(3)
    expect(p('Fix bug P3').title).toBe('Fix bug')
  })

  it('declines anything outside 1–4', () => {
    expect(p('Fix bug p0').priority).toBeNull()
    expect(p('Fix bug p5').priority).toBeNull()
    expect(p('Fix bug p9').title).toBe('Fix bug p9')
  })

  it('does not fire inside a word', () => {
    expect(p('Ship p1x').priority).toBeNull()
    expect(p('Review pp1 draft').priority).toBeNull()
  })
})

describe('for <duration>', () => {
  it('reads minutes and hours', () => {
    expect(p('Draft memo for 45m').estimateMinutes).toBe(45)
    expect(p('Draft memo for 90 minutes').estimateMinutes).toBe(90)
    expect(p('Draft memo for 2h').estimateMinutes).toBe(120)
    expect(p('Draft memo for 2 hours').estimateMinutes).toBe(120)
  })

  it('reads a combined form', () => {
    expect(p('Draft memo for 1h30m').estimateMinutes).toBe(90)
    expect(p('Draft memo for 1h 30').estimateMinutes).toBe(90)
  })

  it('labels it the way a task row would', () => {
    expect(p('x for 45m').tokens.find(t => t.type === 'duration')?.label).toBe('45m')
    expect(p('x for 2h').tokens.find(t => t.type === 'duration')?.label).toBe('2h')
    expect(p('x for 1h30m').tokens.find(t => t.type === 'duration')?.label).toBe('1h 30m')
  })

  it('leaves the title clean', () => {
    expect(p('Draft memo for 45m').title).toBe('Draft memo')
  })

  it('declines a duration longer than a day, or zero', () => {
    expect(p('x for 0m').estimateMinutes).toBeNull()
    expect(p('x for 2000m').estimateMinutes).toBeNull()
  })

  it('does not claim "for" on its own', () => {
    expect(p('Cook for the family').estimateMinutes).toBeNull()
    expect(p('Cook for the family').title).toBe('Cook for the family')
  })
})

describe('metadata alongside the date grammar', () => {
  it('reads everything in one string', () => {
    const r = withProjects('Draft the memo #Teaching p3 for 90m tomorrow at 2pm')
    expect(r.title).toBe('Draft the memo')
    expect(r.projectId).toBe('teach')
    expect(r.priority).toBe(3)
    expect(r.estimateMinutes).toBe(90)
    expect(r.dueDay).toBe('2026-09-17')
    expect(r.timeMinutes).toBe(14 * 60)
  })

  it('keeps token offsets pointing at the source', () => {
    const text = 'Draft the memo #Teaching p3 for 90m tomorrow at 2pm'
    const r = parseQuickAdd(text, { tz: LA, now: NOW, projects: PROJECTS })
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text)
    expect(r.tokens.map(t => t.type)).toEqual(['project', 'priority', 'duration', 'date', 'time'])
  })

  it('does not let the date grammar claim a project name containing an ordinal', () => {
    // "#4th-floor" holds "4th", which the monthly-repeat rule would take.
    const r = withProjects('Check the lights #{4th floor}', [{ id: 'f4', name: '4th floor' }])
    expect(r.projectId).toBe('f4')
    expect(r.rrule).toBeNull()
    expect(r.title).toBe('Check the lights')
  })

  it('does not let an estimate be read as a time of day', () => {
    const r = p('Draft memo for 2h')
    expect(r.estimateMinutes).toBe(120)
    expect(r.timeMinutes).toBeNull()
  })

  it('is null for all three when nothing was typed', () => {
    const r = p('Refactor the scheduler')
    expect(r.projectId).toBeNull()
    expect(r.priority).toBeNull()
    expect(r.estimateMinutes).toBeNull()
  })
})
