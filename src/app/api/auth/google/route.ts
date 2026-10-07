import { NextRequest, NextResponse } from 'next/server'
import { calendarRedirectUri } from '@/lib/request-origin'

// calendar.events = read + create/edit/delete events
// calendar.readonly = required for freeBusy query (events scope alone is insufficient)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

export async function GET(request: NextRequest) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  calendarRedirectUri(request.headers),
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',    // always return refresh_token
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )
}
