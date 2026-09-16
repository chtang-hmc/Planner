/**
 * Week-start handling.
 *
 * "This week" decides what a habit's weekly target counts against, so the
 * boundary has to be identical in the completion path, the scheduler and the
 * habits page — it used to be hand-rolled (and hardcoded to Monday) in all
 * three. Everything goes through weekStartOf().
 *
 * Days are UTC throughout, matching how habit due dates are stored.
 */

/** 0 = Sunday … 6 = Saturday, as returned by Date#getUTCDay(). */
export type WeekStartDay = 0 | 1 | 6

export const WEEK_START_DEFAULT: WeekStartDay = 1   // Monday

export const WEEK_START_OPTIONS: { id: WeekStartDay; label: string }[] = [
  { id: 1, label: 'Monday' },
  { id: 0, label: 'Sunday' },
  { id: 6, label: 'Saturday' },
]

export function isWeekStartDay(v: unknown): v is WeekStartDay {
  return v === 0 || v === 1 || v === 6
}

/**
 * The YYYY-MM-DD (UTC) of the week-start day on or before `date`.
 *
 * weekStartOf(Wed 2026-09-16, 1) → '2026-09-14'  (Monday)
 * weekStartOf(Wed 2026-09-16, 0) → '2026-09-13'  (Sunday)
 */
export function weekStartOf(date: Date, startDay: number): string {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() - daysSinceWeekStart(d.getUTCDay(), startDay))
  return d.toISOString().slice(0, 10)
}

/**
 * Days to step back from `dayOfWeek` to reach the week start.
 *
 * The timezone-free half of the calculation, so views working in local time
 * (the Upcoming strip, the habit heatmap) share the logic instead of
 * re-deriving it: addDays(d, -daysSinceWeekStart(d.getDay(), startDay)).
 */
export function daysSinceWeekStart(dayOfWeek: number, startDay: number): number {
  return (dayOfWeek - startDay + 7) % 7
}

/**
 * Day indices 0–6 in display order, e.g. [1,2,3,4,5,6,0] for a Monday start.
 * For column headers and any seven-across grid.
 */
export function weekDayOrder(startDay: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (startDay + i) % 7)
}

/**
 * Read the configured week start.
 *
 * Falls back to Monday when the column is absent, so the app keeps working on a
 * database where migration 0006 has not been applied yet — only saving the
 * preference requires it.
 */
export async function fetchWeekStartDay(
  db: { from: (t: string) => any },   // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<WeekStartDay> {
  const { data } = await db
    .from('user_scheduling_config')
    .select('*')
    .limit(1)
    .maybeSingle()
  const v = data?.week_start_day
  return isWeekStartDay(v) ? v : WEEK_START_DEFAULT
}
