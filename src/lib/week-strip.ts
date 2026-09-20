/**
 * The fourteen-day strip at the top of Upcoming.
 *
 * Two bars per day — free calendar behind, work due in front — on **one shared
 * scale**, so a column that dwarfs its neighbour dwarfs it for a reason. That
 * is the whole point of the component: on the reference data everything due
 * sits in the next three days and the other eleven are empty, which is a
 * due-date problem you can see at a glance and cannot see in a list.
 *
 * Two things the old strip got wrong and this fixes:
 *
 *   - **It ran Monday to Sunday with today at the far right**, so a view
 *     called Upcoming showed mostly the past. This starts at today.
 *   - **Its bars carried no information** — no scale, no comparison, nothing
 *     to read across columns.
 */

import { addDays, dayOfWeek } from '@/lib/day'

/** The shortest ceiling a column is measured against. */
export const STRIP_FLOOR_MINUTES = 12 * 60

/** Tallest bar in pixels; every column is drawn against this. */
export const STRIP_BAR_HEIGHT = 64

export const STRIP_DAYS = 14

const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export interface StripColumn {
  day:        string
  /** Single letter under which the date sits — S M T W T F S. */
  letter:     string
  /** Day of the month, as the strip prints it. */
  date:       number
  freeMinutes: number
  dueMinutes:  number
  /** Positive when more is due than there is time. */
  deficit:    number
  isToday:    boolean
  /** A day with no working hours: no bars, because there is no ratio. */
  dayOff:     boolean
}

export interface WeekStrip {
  columns: StripColumn[]
  /**
   * Minutes represented by a full-height bar. The largest of any column's due
   * or free, floored at twelve hours — so a quiet fortnight does not magnify a
   * twenty-minute day into a wall, and a brutal one is not clipped.
   */
  scaleMinutes: number
}

/** Bar height in pixels for a quantity, against the shared scale. */
export function barHeight(minutes: number, scaleMinutes: number): number {
  if (minutes <= 0) return 2   // a stub, not nothing: the day exists
  return Math.max(2, Math.round((minutes / scaleMinutes) * STRIP_BAR_HEIGHT))
}

export function buildWeekStrip(opts: {
  todayStr:   string
  /** Free minutes per day. A missing entry means the day is switched off. */
  freeByDay:  Record<string, { before: number; after: number }>
  /** Due minutes per day, already summed by the caller. */
  dueByDay:   Record<string, number>
  days?:      number
}): WeekStrip {
  const { todayStr, freeByDay, dueByDay, days = STRIP_DAYS } = opts

  const columns: StripColumn[] = []
  for (let i = 0; i < days; i++) {
    const day  = addDays(todayStr, i)
    const free = freeByDay[day]
    const due  = dueByDay[day] ?? 0
    const freeMinutes = free ? free.before + free.after : 0

    columns.push({
      day,
      letter: WEEKDAY_LETTER[dayOfWeek(day)],
      date:   Number(day.slice(8, 10)),
      freeMinutes,
      dueMinutes: due,
      /**
       * A day off is not a deficit.
       *
       * With no working hours everything due is technically short, but the
       * band already settled this: a day off with work on it is a scheduling
       * mistake worth surfacing, and not as a shortfall against time that was
       * never offered. The column draws a dash instead, and the day section
       * below says the rest.
       */
      deficit: free ? Math.max(0, due - freeMinutes) : 0,
      isToday: day === todayStr,
      dayOff:  !free,
    })
  }

  const peak = columns.reduce((m, c) => Math.max(m, c.dueMinutes, c.freeMinutes), 0)

  return { columns, scaleMinutes: Math.max(peak, STRIP_FLOOR_MINUTES) }
}

/**
 * The sentence above the strip, when the fortnight has one to offer.
 *
 * Only said when it is true and worth saying: a run of empty days at the end
 * is a due-date problem, and it is the finding the strip exists to make
 * visible. Null when the work is spread, because inventing a finding is worse
 * than having none.
 */
export function stripFinding(strip: WeekStrip): string | null {
  const withWork = strip.columns.filter(c => c.dueMinutes > 0)
  if (withWork.length === 0) return null

  const lastWithWork = strip.columns.findLastIndex(c => c.dueMinutes > 0)
  const empty = strip.columns.length - 1 - lastWithWork
  if (empty < 7) return null

  const span = lastWithWork + 1
  return `Everything you owe is in the next ${span === 1 ? 'day' : `${span} days`}. `
       + `The other ${empty} are empty.`
}
