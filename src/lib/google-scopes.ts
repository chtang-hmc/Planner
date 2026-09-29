/**
 * What a Google calendar connection is allowed to do, and when a new grant may
 * replace the stored one (#116).
 *
 * Every Google sign-in asks for calendar access and used to overwrite the
 * stored connection with its own tokens, recorded as read-only by hard-coded
 * list. A connection upgraded to write access in Settings was therefore
 * narrowed back to read-only by the next ordinary sign-in: reinstalling the
 * home-screen app, a new browser, an expired session. Anything that writes to
 * the calendar ("Block today", focus blocks) then stopped working.
 *
 * Now a sign-in replaces the connection only when its grant covers every scope
 * the stored one has, and both flows record the scopes Google reports rather
 * than the ones they asked for.
 */

export const READ_SCOPE  = 'https://www.googleapis.com/auth/calendar.readonly'
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

/** A space-separated scope string, as Google returns it, as a sorted list. */
export function parseScopes(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(/\s+/).filter(Boolean))].sort()
}

/**
 * What a sign-in should do with the calendar connection.
 *
 * - `insert`: there is none yet; store this one.
 * - `replace`: the new grant can do everything the stored one could; take the
 *   fresher tokens.
 * - `keep`: the new grant is narrower; leave the stored connection alone.
 *   A broken stored connection is repaired from Settings, deliberately, not
 *   by a sign-in that happens to be read-only.
 */
export function signInAction(stored: string[] | null, granted: string[]): 'insert' | 'replace' | 'keep' {
  if (stored === null) return 'insert'
  return stored.every(s => granted.includes(s)) ? 'replace' : 'keep'
}

/**
 * The scopes Google actually granted an access token, or null if it would not
 * say. POSTed rather than in the query string, so the token stays out of URLs
 * and logs.
 */
export async function grantedScopes(accessToken: string): Promise<string[] | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }),
    })
    if (!res.ok) return null
    const { scope } = await res.json() as { scope?: string }
    return scope ? parseScopes(scope) : null
  } catch {
    return null
  }
}
