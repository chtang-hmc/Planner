import { NextResponse, after, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'
import { originOrConfigured } from '@/lib/request-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  /* From the headers, not from `request.url`: on a request to
     http://172.28.151.110:3000/auth/callback that resolved to
     http://localhost:3000, so signing in from a phone completed and then
     redirected to the laptop. */
  const origin = originOrConfigured(request.headers)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      const { session } = data

      /**
       * Reject a non-owner here, before a session cookie exists.
       *
       * `ALLOWED_EMAIL` was checked in exactly one other place — the edge
       * middleware — and behind it 63 call sites read the database with the
       * service-role key, which bypasses RLS. That made the middleware the
       * only thing between a signed-in stranger and everything, and on
       * 2026-09-22 a dot in the URL was enough to skip it.
       *
       * This is the choke point instead: there is exactly one way to obtain a
       * session, and a wrong email does not get one. The middleware check
       * stays as the second line rather than the only one. Signing out here
       * matters — without it the cookies are already set and only the redirect
       * stands in the way.
       */
      const allowedEmail = process.env.ALLOWED_EMAIL
      if (allowedEmail && session.user.email !== allowedEmail) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/403`)
      }

      // If the user granted calendar scope, store tokens and do an initial sync.
      // provider_token = Google access token; provider_refresh_token = Google refresh token.
      // Both are present when access_type: offline + prompt: consent were requested.
      if (session.provider_token && session.provider_refresh_token) {
        const db = createServiceClient()
        const tokenExpiry = session.expires_at
          ? new Date(session.expires_at * 1000).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString()

        // Upsert: delete any stale token then insert fresh one
        await db.from('user_integrations').delete().eq('provider', 'google')
        await db.from('user_integrations').insert({
          provider:      'google',
          access_token:  session.provider_token,
          refresh_token: session.provider_refresh_token,
          token_expiry:  tokenExpiry,
          scopes:        ['https://www.googleapis.com/auth/calendar.readonly'],
        })

        /* `after`, not a bare promise. On a serverless host the function is
           frozen the moment the response goes out, so a fire-and-forget sync
           was silently killed mid-flight once this deployed. `after` is the
           supported way to say "run this once the response is sent". */
        after(() =>
          syncCalendarEvents().catch(err =>
            console.error('Initial calendar sync failed:', err)
          )
        )
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth failed — redirect to login with an error hint
  return NextResponse.redirect(`${origin}/login?error=auth-failed`)
}
