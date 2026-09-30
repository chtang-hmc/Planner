import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'
import { parseScopes, READ_SCOPE, WRITE_SCOPE } from '@/lib/google-scopes'
import { originOrConfigured } from '@/lib/request-origin'
import { STATE_COOKIE } from '../route'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  // From the headers, not `request.url`, which resolves to localhost behind a
  // LAN address (see lib/request-origin). Must equal what the first leg sent
  // Google, or the code exchange is refused.
  const origin = originOrConfigured(request.headers)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    console.error('Google OAuth error:', error)
    return NextResponse.redirect(`${origin}/settings?error=google-denied`)
  }

  // The round trip must be the one this browser started (see ../route.ts).
  const expected = request.cookies.get(STATE_COOKIE)?.value
  if (!expected || searchParams.get('state') !== expected) {
    console.error('Google OAuth: state missing or mismatched; refusing')
    return NextResponse.redirect(`${origin}/settings?error=google-state`)
  }

  // Exchange authorisation code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  `${origin}/api/auth/google/callback`,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(`${origin}/settings?error=google-token-failed`)
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

  // Back to where the button was, so the new state is the first thing seen.
  const res = NextResponse.redirect(`${origin}/settings`)
  res.cookies.delete({ name: STATE_COOKIE, path: '/api/auth/google' })
  return res
}
