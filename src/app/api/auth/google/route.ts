import { NextResponse, type NextRequest } from 'next/server'
import { originOrConfigured } from '@/lib/request-origin'

// calendar.events = read + create/edit/delete events
// calendar.readonly = required for freeBusy query (events scope alone is insufficient)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

/** Where the round trip keeps its one-time check value. See the callback. */
export const STATE_COOKIE = 'planner.gcal.state'

/**
 * Settings → "Connect Google Calendar" / "Upgrade access".
 *
 * **The return address comes from the request (2026-09-30).** It was
 * `GOOGLE_REDIRECT_URI`, an environment variable, which on the deployment
 * pointed at `http://localhost:3000`: tapping Upgrade access on the phone went
 * to Google and came back to the laptop's address. It is now this request's
 * own origin, the same rule the sign-in flow has used since 2026-09-22
 * (`lib/request-origin`), and the callback derives the identical value so the
 * two legs agree. Google still has to list it as an authorised redirect URI.
 *
 * **`state` guards the callback.** A random value, set in a short-lived
 * httpOnly cookie here and required back from Google there, so only a
 * round trip that started from this button can replace the calendar
 * connection. Without it, a link to the callback carrying someone else's code
 * would connect *their* calendar for a signed-in owner.
 */
export async function GET(request: NextRequest) {
  const redirectUri = `${originOrConfigured(request.headers)}/api/auth/google/callback`
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',    // always return refresh_token
    state,
  })

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', path: '/api/auth/google', maxAge: 10 * 60,
    secure: redirectUri.startsWith('https://'),
  })
  return res
}
