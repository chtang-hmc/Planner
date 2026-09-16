/**
 * Formatting shared by every task-row layout.
 *
 * These lived inside TaskList while it was the only thing rendering a row.
 * Four layouts now render rows, and a duration or a deadline must read the same
 * in all of them — "2h 15m" in one and "2h15" in another is the kind of drift
 * that makes a settings-driven look feel like four different apps.
 */

export function formatMinutes(m: number | null): string {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

/** Today where the user is, as YYYY-MM-DD — the shape a due date slices to. */
export function localDateStr(d: Date): string {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}

export type DueTone = 'late' | 'now' | 'soon' | 'later'

/**
 * A due date rendered as the day it was picked.
 *
 * Compared as local calendar dates, not instants: a due date is stored at UTC
 * midnight, so comparing it to `Date.now()` marks a task due today as overdue
 * once UTC midnight passes — mid-afternoon the day before on the US west coast.
 */
export function formatDue(iso: string | null): { label: string; tone: DueTone } | null {
  if (!iso) return null
  const taskDate = iso.slice(0, 10)
  const today    = new Date()
  const todayStr = localDateStr(today)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const tmrwStr  = localDateStr(tomorrow)

  if (taskDate <  todayStr) return { label: 'Overdue',  tone: 'late' }
  if (taskDate === todayStr) return { label: 'Today',    tone: 'now'  }
  if (taskDate === tmrwStr)  return { label: 'Tomorrow', tone: 'soon' }

  const ms = new Date(taskDate + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()
  return { label: `${Math.round(ms / 86400000)}d`, tone: 'later' }
}

/** Text colour for a deadline. Only urgency earns colour; the rest stays muted. */
export function dueToneClass(tone: DueTone): string {
  switch (tone) {
    case 'late': return 'text-red-500'
    case 'now':  return 'text-amber-500'
    default:     return 'text-slate-400'
  }
}
