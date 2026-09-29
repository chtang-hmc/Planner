/**
 * Who may sign in: `ALLOWED_EMAIL`, one address or several separated by
 * commas (2026-09-29: the owner's school and personal Google accounts).
 *
 * Unset means no gate, as before. Compared case-insensitively, because Google
 * reports an address in whatever case the account was created with.
 *
 * **The first address owns the calendar.** Every Google sign-in asks for
 * calendar access, and the callback used to store whichever account signed in
 * as *the* calendar connection, replacing the last one. With two accounts
 * allowed, signing in on the personal one would have quietly switched every
 * sync, the day's plan and the calendar notification to the personal
 * calendar. So only the first address's sign-in updates the connection; the
 * others just get a session. The data behind both is the same: this is still
 * one person's planner (#82).
 */
export function allowedEmails(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

/** True when there is no list, or `email` is on it. */
export function isAllowed(email: string | null | undefined, raw: string | undefined): boolean {
  const list = allowedEmails(raw)
  if (!list.length) return true
  return !!email && list.includes(email.trim().toLowerCase())
}

/** Whether this sign-in may replace the stored calendar connection. */
export function ownsCalendar(email: string | null | undefined, raw: string | undefined): boolean {
  const list = allowedEmails(raw)
  if (!list.length) return true
  return !!email && email.trim().toLowerCase() === list[0]
}
