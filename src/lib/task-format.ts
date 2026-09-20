/**
 * Formatting shared by every task-row layout.
 *
 * These lived inside TaskList while it was the only thing rendering a row.
 * Four layouts now render rows, and a duration or a deadline must read the same
 * in all of them — "2h 15m" in one and "2h15" in another is the kind of drift
 * that makes a settings-driven look feel like four different apps.
 */

/**
 * A duration in prose: `45m`, `1h`, `3h 05m`.
 *
 * The minutes are padded where they show and dropped where they are zero —
 * `3h 05m` rather than `3h 5m`, and `1h` rather than `1h 00m`. That is the
 * form the design uses everywhere outside a column, and it is worth the two
 * lines: "3h 5m" reads as a typo, and "1h 00m" reads as a spreadsheet.
 *
 * `formatDuration` in lib/duration.ts is the column form, which pads
 * unconditionally so the minutes place cannot move down a list. Two functions
 * rather than a flag, because a caller should have to say which it means.
 */
export function formatMinutes(m: number | null): string {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`
}

/** Today where the user is, as YYYY-MM-DD — the shape a due date slices to. */
export function localDateStr(d: Date): string {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}

export type DueTone = 'late' | 'now' | 'soon' | 'later'

/** A wall-clock time on a 12-hour clock: 1020 → "5 PM", 1050 → "5:30 PM". */
export function formatTimeOfDay(minutes: number): string {
  const h24 = Math.floor(minutes / 60), min = minutes % 60
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, '0')} ${suffix}`
}

/**
 * A due date rendered as the day it was picked.
 *
 * Compared as local calendar dates, not instants: a due date is stored at UTC
 * midnight, so comparing it to `Date.now()` marks a task due today as overdue
 * once UTC midnight passes — mid-afternoon the day before on the US west coast.
 *
 * `timeMinutes` (migration 0015) is appended rather than folded in. It is a
 * wall-clock time held beside the day, never inside it, so it cannot move which
 * day the task is on — and it does not change the tone: a task due at 9am today
 * still reads as due today at half past nine, not overdue.
 */
export function formatDue(
  iso: string | null,
  timeMinutes?: number | null,
): { label: string; tone: DueTone } | null {
  if (!iso) return null
  const taskDate = iso.slice(0, 10)
  const today    = new Date()
  const todayStr = localDateStr(today)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const tmrwStr  = localDateStr(tomorrow)

  const at = (label: string, tone: DueTone) => ({
    label: timeMinutes == null ? label : `${label} ${formatTimeOfDay(timeMinutes)}`,
    tone,
  })

  if (taskDate <  todayStr)  return at('Overdue',  'late')
  if (taskDate === todayStr) return at('Today',    'now')
  if (taskDate === tmrwStr)  return at('Tomorrow', 'soon')

  const ms = new Date(taskDate + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()
  return at(`${Math.round(ms / 86400000)}d`, 'later')
}

/** Text colour for a deadline. Only urgency earns colour; the rest stays muted. */
export function dueToneClass(tone: DueTone): string {
  switch (tone) {
    case 'late': return 'text-red-500'
    case 'now':  return 'text-amber-500'
    default:     return 'text-slate-400'
  }
}
