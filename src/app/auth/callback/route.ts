import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/tasks'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      const { session } = data

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

        // Fire-and-forget initial calendar sync — don't block the redirect
        syncCalendarEvents().catch(err =>
          console.error('Initial calendar sync failed:', err)
        )
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth failed — redirect to login with an error hint
  return NextResponse.redirect(`${origin}/login?error=auth-failed`)
}
