import { createServiceClient } from '@/lib/supabase/server'

// ── Token management ──────────────────────────────────────────────────────────

export interface GoogleIntegration {
  id: string
  access_token: string
  refresh_token: string
  token_expiry: string
}

/**
 * Returns a valid Google access token, refreshing it first if it's within
 * 60 seconds of expiry. Returns null if no integration is stored.
 */
export async function getValidToken(): Promise<GoogleIntegration | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_integrations')
    .select('id, access_token, refresh_token, token_expiry')
    .eq('provider', 'google')
    .single()

  if (!data) return null

  const expiresAt = new Date(data.token_expiry).getTime()
  const needsRefresh = Date.now() > expiresAt - 60_000   // 60s buffer

  if (!needsRefresh) return data as GoogleIntegration

  // Refresh the access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: data.refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) {
    console.error('Google token refresh failed:', await res.text())
    return null
  }

  const { access_token, expires_in } = await res.json()
  const token_expiry = new Date(Date.now() + expires_in * 1000).toISOString()

  await db
    .from('user_integrations')
    .update({ access_token, token_expiry })
    .eq('id', data.id)

  return { ...data, access_token, token_expiry } as GoogleIntegration
}

// ── Calendar API ──────────────────────────────────────────────────────────────

export interface GCalEvent {
  id: string
  summary?: string
  status: string
  start: { dateTime?: string; date?: string }
  end:   { dateTime?: string; date?: string }
}

/**
 * Full sync: fetch events from Google, map to DB schema, upsert.
 * Call this directly from server actions instead of going through the API route
 * to avoid self-referential HTTP calls that break in serverless environments.
 */
export async function syncCalendarEvents(): Promise<number> {
  const token = await getValidToken()
  if (!token) throw new Error('Google Calendar not connected')

  const events = await fetchCalendarEvents(token.access_token)

  const rows = events
    .filter(e => e.status !== 'cancelled' && (e.start?.dateTime || e.start?.date))
    .map(e => {
      const allDay = !e.start.dateTime
      // Append 'Z' to treat all-day dates as UTC midnight, not local midnight
      const start_time = allDay
        ? new Date(e.start.date! + 'T00:00:00Z').toISOString()
        : e.start.dateTime!
      const end_time = allDay
        ? new Date((e.end?.date ?? e.start.date!) + 'T00:00:00Z').toISOString()
        : (e.end?.dateTime ?? e.start.dateTime!)

      return {
        gcal_id:    e.id,
        title:      e.summary ?? '(No title)',
        start_time,
        end_time,
        all_day:    allDay,
        source:     'google_calendar' as const,
      }
    })

  const db = createServiceClient()

  if (rows.length > 0) {
    const { error } = await db
      .from('calendar_events')
      .upsert(rows, { onConflict: 'gcal_id', ignoreDuplicates: false })
    if (error) throw new Error(error.message)
  }

  return rows.length
}

/** Fetch events from the user's primary calendar in a ±7 / +30 day window. */
export async function fetchCalendarEvents(accessToken: string): Promise<GCalEvent[]> {
  const timeMin = new Date()
  timeMin.setDate(timeMin.getDate() - 7)

  const timeMax = new Date()
  timeMax.setDate(timeMax.getDate() + 30)

  const params = new URLSearchParams({
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '250',
  })

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Calendar API ${res.status}: ${body}`)
  }

  const data = await res.json()
  return (data.items ?? []) as GCalEvent[]
}
