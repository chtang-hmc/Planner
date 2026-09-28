import { describe, it, expect } from 'vitest'
import {
  cadence, weekProgress, habitStreak, dotStrip, weekGrid, longestStreak, habitSummary, streakWords,
  weekRangeLabel, habitsHeadline, STRIP_DAYS,
} from '@/lib/habit-stats'

const TODAY = '2026-09-21'        // a Monday
const MONDAY = 1

/** Local days, descending from `from`, at the given offsets. */
const daysBack = (from: string, offsets: number[]) =>
  offsets.map(o => {
    const d = new Date(Date.parse(from + 'T00:00:00Z') - o * 86_400_000)
    return d.toISOString().slice(0, 10)
  }).sort()

describe('cadence', () => {
  it('calls seven a week daily, not a quota', () => {
    expect(cadence(7)).toEqual({ kind: 'daily', label: 'Daily', target: 7 })
  })

  it('names a real target', () => {
    expect(cadence(2)).toEqual({ kind: 'weekly', label: '2× a week', target: 2 })
  })

  it('has no target for a habit that never promised one', () => {
    expect(cadence(null)).toEqual({ kind: 'anytime', label: 'Anytime', target: null })
    expect(cadence(0).kind).toBe('anytime')
  })
})

describe('weekProgress', () => {
  const week = '2026-09-21'

  it('counts days in the week, not sessions before it', () => {
    expect(weekProgress({ weeklyTarget: 7, days: ['2026-09-20', '2026-09-21'], weekStartStr: week }))
      .toEqual({ count: 1, target: 7, met: false })
  })

  it('does not cap an over-target week — the third session is a fact', () => {
    expect(weekProgress({
      weeklyTarget: 2, days: ['2026-09-21', '2026-09-22', '2026-09-23'], weekStartStr: week,
    })).toEqual({ count: 3, target: 2, met: true })
  })

  it('gives an anytime habit a plain count, never a fraction over nothing', () => {
    const p = weekProgress({ weeklyTarget: null, days: ['2026-09-21'], weekStartStr: week })
    expect(p.target).toBeNull()
    expect(p.count).toBe(1)
    expect(p.met).toBe(true)
  })
})

describe('habitStreak', () => {
  const streak = (weeklyTarget: number | null, days: string[]) =>
    habitStreak({ weeklyTarget, days, todayStr: TODAY, weekStartDay: MONDAY })

  it('counts a daily habit in days', () => {
    expect(streak(7, daysBack(TODAY, [0, 1, 2, 3, 4]))).toEqual({ value: 5, unit: 'd' })
  })

  it('does not break a daily streak just because today is not done yet', () => {
    // Nine in the morning, yesterday and before are logged. Still a streak.
    expect(streak(7, daysBack(TODAY, [1, 2, 3]))).toEqual({ value: 3, unit: 'd' })
  })

  it('breaks on a missed day', () => {
    expect(streak(7, daysBack(TODAY, [0, 1, 3, 4]))).toEqual({ value: 2, unit: 'd' })
  })

  it('has no streak when nothing has been done', () => {
    expect(streak(7, [])).toEqual({ value: 0, unit: 'd' })
  })

  it('counts a weekly-target habit in weeks that met the target', () => {
    // Target 2. This week 2, last week 2, the week before 1 — so two weeks.
    const days = [
      '2026-09-21', '2026-09-22',   // this week (starts Mon 21)
      '2026-09-15', '2026-09-17',   // last week
      '2026-09-09',                 // the week before: one short
    ]
    expect(streak(2, days)).toEqual({ value: 2, unit: 'w' })
  })

  it('does not break a weekly streak on a current week still in progress', () => {
    // Target 2, nothing yet this week, but the two before were met.
    const days = ['2026-09-15', '2026-09-17', '2026-09-08', '2026-09-10']
    expect(streak(2, days)).toEqual({ value: 2, unit: 'w' })
  })

  it('will not invent a streak for a habit with no cadence', () => {
    expect(streak(null, daysBack(TODAY, [0, 1, 2]))).toBeNull()
  })
})

describe('longestStreak', () => {
  const best = (weeklyTarget: number | null, days: string[]) =>
    longestStreak({ weeklyTarget, days: [...days].sort(), todayStr: TODAY, weekStartDay: MONDAY })

  it('finds the longest run of days, not the current one', () => {
    // A six-day run a fortnight ago, then a two-day run ending today.
    expect(best(7, daysBack(TODAY, [0, 1, 14, 15, 16, 17, 18, 19]))).toEqual({ value: 6, unit: 'd' })
  })

  it('counts weeks that met the target for a weekly habit', () => {
    // Weeks starting 31 Aug, 7 Sep, 14 Sep each have two sessions; 21 Sep has one.
    const days = ['2026-08-31', '2026-09-02', '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16', '2026-09-21']
    expect(best(2, days)).toEqual({ value: 3, unit: 'w' })
  })

  it('is broken by a week that fell short', () => {
    const days = ['2026-08-31', '2026-09-02', '2026-09-07', '2026-09-14', '2026-09-16']
    expect(best(2, days)).toEqual({ value: 1, unit: 'w' })
  })

  it('is zero before anything is done, and null for an anytime habit', () => {
    expect(best(7, [])).toEqual({ value: 0, unit: 'd' })
    expect(best(null, daysBack(TODAY, [0]))).toBeNull()
  })
})

describe('habitSummary', () => {
  it('says the streak, the best, this week and the last day in one place', () => {
    const days = daysBack(TODAY, [0, 1, 2, 10, 11, 12, 13]).sort()
    expect(habitSummary({ weeklyTarget: 7, days, todayStr: TODAY, weekStartDay: MONDAY })).toEqual({
      streak: { value: 3, unit: 'd' },
      best: { value: 4, unit: 'd' },
      thisWeek: 1,          // TODAY is the Monday the week starts on
      lastDone: TODAY,
    })
  })

  it('reads a never-done habit as nothing yet', () => {
    expect(habitSummary({ weeklyTarget: 3, days: [], todayStr: TODAY, weekStartDay: MONDAY }))
      .toEqual({ streak: { value: 0, unit: 'w' }, best: { value: 0, unit: 'w' }, thisWeek: 0, lastDone: null })
  })

  it('words a streak in its own unit', () => {
    expect(streakWords({ value: 1, unit: 'd' })).toBe('1 day')
    expect(streakWords({ value: 14, unit: 'd' })).toBe('14 days')
    expect(streakWords({ value: 2, unit: 'w' })).toBe('2 weeks')
  })
})

describe('dotStrip', () => {
  it('is four weeks, oldest first, ending today', () => {
    const s = dotStrip(['2026-09-21'], TODAY)
    expect(s).toHaveLength(STRIP_DAYS)
    expect(s[STRIP_DAYS - 1]).toMatchObject({ day: TODAY, done: true })
    expect(s[0].day).toBe('2026-08-25')
  })

  it('marks the weekend, so four weeks of dots have a rhythm to read', () => {
    const s = dotStrip([], TODAY)
    const sat = s.find(d => d.day === '2026-09-19')
    const sun = s.find(d => d.day === '2026-09-20')
    const wed = s.find(d => d.day === '2026-09-16')
    expect([sat!.weekend, sun!.weekend, wed!.weekend]).toEqual([true, true, false])
  })
})

describe('weekGrid', () => {
  it('starts on the configured day and derives its letters from it', () => {
    expect(weekGrid([], '2026-09-21', TODAY).map(d => d.letter))
      .toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    // Sunday-start weeks are not relabelled by hand.
    expect(weekGrid([], '2026-09-20', TODAY).map(d => d.letter))
      .toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S'])
  })

  it('marks today and refuses to call the future loggable', () => {
    const g = weekGrid(['2026-09-21'], '2026-09-21', TODAY)
    expect(g[0]).toMatchObject({ done: true, today: true, future: false })
    expect(g[1].future).toBe(true)
    expect(g.filter(d => d.future)).toHaveLength(6)
  })
})

describe('weekRangeLabel', () => {
  it('names the month once when the week does not cross one', () => {
    expect(weekRangeLabel('2026-09-14')).toBe('14 — 20 Sep')
  })

  it('names both when it does', () => {
    expect(weekRangeLabel('2026-09-28')).toBe('28 Sep — 4 Oct')
  })
})

describe('habitsHeadline', () => {
  it('says the day has not started rather than restating the table', () => {
    expect(habitsHeadline({ total: 5, doneToday: 0, scheduled: [] }))
      .toBe('None logged yet today.')
  })

  it('adds what is already booked, which no row can say', () => {
    expect(habitsHeadline({ total: 5, doneToday: 0, scheduled: ['Gym', 'Piano'] }))
      .toBe('None logged yet today · Gym and Piano are already on the calendar today')
  })

  it('handles one, and three', () => {
    expect(habitsHeadline({ total: 5, doneToday: 2, scheduled: ['Gym'] }))
      .toBe('2 of 5 logged today · Gym is already on the calendar today')
    expect(habitsHeadline({ total: 5, doneToday: 2, scheduled: ['A', 'B', 'C'] }))
      .toContain('A, B and C are')
  })

  it('has something to say when the day is done', () => {
    expect(habitsHeadline({ total: 3, doneToday: 3, scheduled: [] })).toBe('All logged today.')
  })

  it('does not pretend there are habits', () => {
    expect(habitsHeadline({ total: 0, doneToday: 0, scheduled: [] })).toBe('No habits yet.')
  })
})
