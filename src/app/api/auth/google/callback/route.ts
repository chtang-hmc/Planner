import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'
import { parseScopes, READ_SCOPE, WRITE_SCOPE } from '@/lib/google-scopes'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    console.error('Google OAuth error:', error)
    return NextResponse.redirect(`${origin}/tasks?error=google-denied`)
  }

  // Exchange authorisation code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI!,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(`${origin}/tasks?error=google-token-failed`)
  }

  const { access_token, refresh_token, expires_in, scope } = await tokenRes.json()
  const token_expiry = new Date(Date.now() + expires_in * 1000).toISOString()

  const db = createServiceClient()

  // Replace any existing Google integration (single-user app)
  await db.from('user_integrations').delete().eq('provider', 'google')
  await db.from('user_integrations').insert({
    provider:     'google',
    access_token,
    refresh_token,
    token_expiry,
    // What Google granted, not what was asked for: the consent screen lets a
    // person untick a scope, and a hard-coded list would then claim write
    // access the token doesn't have (#116).
    scopes:       scope ? parseScopes(scope).filter(s => s.includes('/auth/calendar')) : [READ_SCOPE, WRITE_SCOPE],
    connected_at: new Date().toISOString(),
  })

  /* Call the lib directly rather than via fetch, per CLAUDE.md's "no HTTP
     self-calls". Wrapped in `after` because a bare promise does not survive
     the response on a serverless host — the function is frozen as soon as the
     redirect goes out, and the sync was being killed mid-flight. */
  after(() => syncCalendarEvents().catch(console.error))

  return NextResponse.redirect(`${origin}/tasks`)
}
