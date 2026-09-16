/**
 * Calendar days in the user's timezone.
 *
 * Habits are counted by *day*: the completion heatmap, the streak, the weekly
 * target, "already logged today". Days used to be UTC day edges, which is
 * correct only if you live on the prime meridian — west of it an evening
 * session counted toward tomorrow, so a 7pm gym session lit up the next
 * square and the streak moved a day.
 *
 * Everything day-shaped now goes through here, against the timezone stored in
 * `user_scheduling_config.timezone` (the same one the scheduler works in).
 *
 * Two representations, deliberately kept apart:
 *   - a **day string** (`YYYY-MM-DD`) is a calendar day, with no time in it —
 *     arithmetic on these is pure string/UTC math and can't drift
 *   - an **instant** (`Date` / ISO) is a moment; turning one into a day
 *     requires a timezone, which is what `localDayStr` is for
 */

export const DEFAULT_TZ = 'UTC'

/** Cheap validity check — an unknown zone makes Intl throw. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The calendar day an instant falls on, in `tz`. */
export function localDayStr(instant: Date | string, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  // 'en-CA' formats as YYYY-MM-DD, which is what every day string here is.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
}

/** Today, in `tz`. */
export function todayStr(tz: string): string {
  return localDayStr(new Date(), tz)
}

/**
 * Offset of `tz` from UTC at a given instant, in ms. Positive east of UTC.
 * DST-aware because it asks Intl what the wall clock actually reads.
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value)
  const asIfUTC = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  )
  return asIfUTC - instant.getTime()
}

/**
 * The instant local midnight begins on `dayStr` in `tz`.
 *
 * Two passes: the first guesses the offset using UTC midnight, the second
 * re-reads it at the corrected instant, which fixes days where a DST change
 * moved the offset between the two. The one case it can't represent is a local
 * midnight that doesn't exist (spring-forward at 00:00, a handful of zones) —
 * there it lands on the following hour, which is the closest real instant.
 */
export function startOfLocalDay(dayStr: string, tz: string): Date {
  const utcGuess = Date.parse(dayStr + 'T00:00:00Z')
  let ms = utcGuess - tzOffsetMs(new Date(utcGuess), tz)
  ms = utcGuess - tzOffsetMs(new Date(ms), tz)
  return new Date(ms)
}

/**
 * Half-open [start, end) instants covering `dayStr` in `tz`.
 *
 * Half-open rather than ending at 23:59:59.999 so a completion in the final
 * millisecond of a day can't fall through the gap between two days.
 */
export function localDayRange(dayStr: string, tz: string): { startISO: string; endISO: string } {
  return {
    startISO: startOfLocalDay(dayStr, tz).toISOString(),
    endISO:   startOfLocalDay(addDays(dayStr, 1), tz).toISOString(),
  }
}

/**
 * `n` days after `dayStr` (negative to go back).
 *
 * Pure calendar arithmetic — parsed and stepped in UTC, where every day is 24
 * hours, so a DST day can't turn into 23 or 25 hours and shift the result.
 */
export function addDays(dayStr: string, n: number): string {
  const d = new Date(dayStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday, for a day string. */
export function dayOfWeek(dayStr: string): number {
  return new Date(dayStr + 'T00:00:00Z').getUTCDay()
}

/**
 * Read the configured timezone.
 *
 * Falls back to UTC when the column is absent (pre-0014) or empty, which is
 * exactly the old behaviour — so the app keeps working before the migration
 * runs and before the browser has reported a zone.
 */
export async function fetchTimezone(
  db: { from: (t: string) => any },   // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<string> {
  const { data } = await db
    .from('user_scheduling_config')
    .select('*')
    .limit(1)
    .maybeSingle()
  const tz = data?.timezone
  return isValidTimezone(tz) ? tz : DEFAULT_TZ
}
