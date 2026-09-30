/**
 * Moving overdue work to today (2026-09-30).
 *
 * Upcoming already let you drag a task onto another day, but drag and drop
 * doesn't work on a touch screen, so on the phone an overdue task could only
 * be moved by opening it and editing the date. Home, Upcoming and the weekly
 * review now have a "Today" button, and this decides what it may touch.
 */

export interface MovableRow {
  id:       string
  status:   string
  type:     string
  due_date: string | null
}

/**
 * Of the rows asked for, the ones that really are overdue: still open, dated
 * before `today`, and not a habit.
 *
 * Re-checked on the server rather than trusted from the button, because the
 * page can be stale: a task finished on another device, or already moved,
 * must not be dragged back to today. A habit's date is its chain's position,
 * so it is moved by logging it, never by this.
 */
export function movableToToday(rows: MovableRow[], today: string): string[] {
  return rows
    .filter(r => (r.status === 'inbox' || r.status === 'active')
              && r.type !== 'habit'
              && r.due_date !== null
              && r.due_date.slice(0, 10) < today)
    .map(r => r.id)
}

/** A due date for `day`, stored the way every due date is: UTC midnight. */
export function dueDateFor(day: string): string {
  return `${day}T00:00:00Z`
}
