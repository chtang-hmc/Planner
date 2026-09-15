import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'

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

  const { access_token, refresh_token, expires_in } = await tokenRes.json()
  const token_expiry = new Date(Date.now() + expires_in * 1000).toISOString()

  const db = createServiceClient()

  // Replace any existing Google integration (single-user app)
  await db.from('user_integrations').delete().eq('provider', 'google')
  await db.from('user_integrations').insert({
    provider:     'google',
    access_token,
    refresh_token,
    token_expiry,
    scopes:       [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    connected_at: new Date().toISOString(),
  })

  // Kick off the initial sync (fire-and-forget is fine — call the lib directly,
  // not via fetch, per CLAUDE.md "No HTTP self-calls in server actions")
  syncCalendarEvents().catch(console.error)

  return NextResponse.redirect(`${origin}/tasks`)
}
