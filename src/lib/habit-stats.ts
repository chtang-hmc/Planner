/**
 * What a habit row says: cadence, this week, and the streak.
 *
 * All of it derived from the habit's completion days, which is the only
 * trustworthy record. **`habit_streaks` is not used here.** The table is keyed
 * by `task_id`, and a habit is a family of rows — the id on screen is usually
 * an occurrence created *after* the completions you want to count. On
 * 2026-09-21 every row in it read `current_streak: 1`, including Piano's,
 * which had been played five days running. A column that says 1 for a
 * five-day streak is worse than no column.
 *
 * `completionDaysByTitle` in `lib/habits.ts` produces the input: unique local
 * days, keyed by title, already deduplicated so two sessions in one evening
 * count once.
 */

import { addDays, dayOfWeek } from '@/lib/day'
import { weekStartOfDay } from '@/lib/week'

/** The dot strip's length: four weeks, which is where a pattern shows. */
export const STRIP_DAYS = 28

/** A weekly target of this many is a daily habit, not a target to hit. */
export const DAILY_TARGET = 7

export type CadenceKind = 'daily' | 'weekly' | 'anytime'

export interface Cadence {
  kind:  CadenceKind
  label: string
  /** Null for an anytime habit — there is nothing to be short of. */
  target: number | null
}

/**
 * How often this is meant to happen, in words.
 *
 * Seven is `Daily` rather than `7× a week`: a habit you do every day is not
 * one you are hitting a quota on, and the streak that goes with it is counted
 * in days rather than weeks.
 */
export function cadence(weeklyTarget: number | null): Cadence {
  if (weeklyTarget === null || weeklyTarget <= 0) {
    return { kind: 'anytime', label: 'Anytime', target: null }
  }
  if (weeklyTarget >= DAILY_TARGET) return { kind: 'daily', label: 'Daily', target: DAILY_TARGET }
  return { kind: 'weekly', label: `${weeklyTarget}× a week`, target: weeklyTarget }
}

export interface WeekProgress {
  count:  number
  /** Null on an anytime habit: a plain count, never `1/—`. */
  target: number | null
  met:    boolean
}

/**
 * This week's cell.
 *
 * Over-target is not capped. `3/2` reads oddly as a fraction, but the
 * numerator is the true count and hiding it to make the fraction tidy would be
 * lying about the week — the colour says the target is met, and the third
 * session is a fact.
 */
export function weekProgress(opts: {
  weeklyTarget: number | null
  days:         string[]
  weekStartStr: string
}): WeekProgress {
  const { weeklyTarget, days, weekStartStr } = opts
  const count = days.filter(d => d >= weekStartStr).length
  const c = cadence(weeklyTarget)

  return { count, target: c.target, met: c.target === null ? count > 0 : count >= c.target }
}

export interface Streak {
  value: number
  /** Always shown in the cell: `12d`, `2w`. The header alone cannot say it. */
  unit:  'd' | 'w'
}

/**
 * The streak, counted in the habit's own cadence unit.
 *
 * Daily habits count consecutive days; a habit with a weekly target counts
 * consecutive weeks in which the target was met, which is the only sensible
 * reading of a streak for something done twice a week.
 *
 * An anytime habit has no streak. There is no cadence for anything to be
 * consecutive in, and inventing one would put a number next to a habit that
 * never promised anything.
 *
 * **Today's absence does not break a streak.** A daily streak counts back from
 * today when today is done and from yesterday when it is not, so a habit you
 * have not got to yet at nine in the morning still reads as a streak. The same
 * grace applies to the current week.
 */
export function habitStreak(opts: {
  weeklyTarget: number | null
  /** Sorted ascending, unique local days. */
  days:         string[]
  todayStr:     string
  weekStartDay: number
}): Streak | null {
  const { weeklyTarget, days, todayStr, weekStartDay } = opts
  const c = cadence(weeklyTarget)
  if (c.kind === 'anytime') return null

  const set = new Set(days)

  if (c.kind === 'daily') {
    let cursor = set.has(todayStr) ? todayStr : addDays(todayStr, -1)
    let n = 0
    while (set.has(cursor)) { n++; cursor = addDays(cursor, -1) }
    return { value: n, unit: 'd' }
  }

  const target = c.target!
  const inWeek = (start: string) => {
    const end = addDays(start, 7)
    return days.filter(d => d >= start && d < end).length
  }

  let week = weekStartOfDay(todayStr, weekStartDay)
  if (inWeek(week) < target) week = addDays(week, -7)

  let n = 0
  while (inWeek(week) >= target) { n++; week = addDays(week, -7) }
  return { value: n, unit: 'w' }
}

export interface StripDay {
  day:  string
  done: boolean
  /** Sundays and Saturdays, so four weeks of dots have somewhere to breathe. */
  weekend: boolean
}

/**
 * The last four weeks, oldest first, ending today.
 *
 * Replaces a 16-week heatmap: 448 squares to represent twelve piano sessions
 * is a lot of ink for no signal, and nobody acts on what they did in June.
 */
export function dotStrip(days: string[], todayStr: string, n = STRIP_DAYS): StripDay[] {
  const set = new Set(days)
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(todayStr, -(n - 1 - i))
    const dow = dayOfWeek(day)
    return { day, done: set.has(day), weekend: dow === 0 || dow === 6 }
  })
}

export interface GridDay {
  day:    string
  done:   boolean
  /** A day that has not happened yet: shown, but not loggable. */
  future: boolean
  today:  boolean
  /** `M`, `T`, … derived from the configured first day, never hardcoded. */
  letter: string
}

const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/**
 * One habit's row in the This week grid: seven days from the configured week
 * start. Monday was an accident of the reference drawing; the first column is
 * whatever the setting says.
 */
export function weekGrid(days: string[], weekStartStr: string, todayStr: string): GridDay[] {
  const set = new Set(days)
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStartStr, i)
    return {
      day,
      done:   set.has(day),
      future: day > todayStr,
      today:  day === todayStr,
      letter: WEEKDAY_LETTER[dayOfWeek(day)],
    }
  })
}

/** `14 — 20 Sep`, the label above the grid. */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function weekRangeLabel(weekStartStr: string): string {
  const end = addDays(weekStartStr, 6)
  const [, sm, sd] = weekStartStr.split('-')
  const [, em, ed] = end.split('-')
  const left = sm === em ? Number(sd) : `${Number(sd)} ${MONTHS[Number(sm) - 1]}`
  return `${left} — ${Number(ed)} ${MONTHS[Number(em) - 1]}`
}

/**
 * The line under the heading.
 *
 * Says what is true of today and stops. "3 of 5 logged" on a page whose rows
 * each carry their own count is the heading restating the table; what the
 * table cannot say is whether the day has started at all.
 */
export function habitsHeadline(opts: {
  total:       number
  doneToday:   number
  /**
   * Titles with a calendar block on today, still unlogged.
   *
   * On today, not *later* today: knowing whether a block is still ahead means
   * reading the clock during render, which is impure and would have the server
   * and the client disagree about the sentence. The day is what the data
   * supports without a clock.
   */
  scheduled:   string[]
}): string {
  const { total, doneToday, scheduled } = opts

  const head =
    total === 0        ? 'No habits yet.'
    : doneToday === 0  ? 'None logged yet today'
    : doneToday >= total ? 'All logged today'
    : `${doneToday} of ${total} logged today`

  if (scheduled.length === 0) return head.endsWith('.') ? head : `${head}.`

  const names = scheduled.length === 1 ? scheduled[0]
    : scheduled.length === 2 ? `${scheduled[0]} and ${scheduled[1]}`
    : `${scheduled.slice(0, -1).join(', ')} and ${scheduled[scheduled.length - 1]}`

  return `${head} · ${names} ${scheduled.length === 1 ? 'is' : 'are'} already on the calendar today`
}
