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

  // Stamp the pull so Home can say how stale it is showing (migration 0018).
  // Only after the upsert succeeded — a timestamp written on a failed sync
  // would claim freshness the rows do not have. Failing to write it is not
  // worth failing the sync over: the reads all treat a missing value as
  // "unknown", which is what it is.
  const { error: stampErr } = await db
    .from('user_integrations')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('provider', 'google')
  if (stampErr) console.error('syncCalendarEvents: could not stamp last_synced_at:', stampErr.message)

  return rows.length
}

// ── Write: task time blocks ───────────────────────────────────────────────────

const PRIORITY_COLOR_ID: Record<number, string> = {
  4: '11', // red   — Tomato
  3: '5',  // orange — Banana (closest)
  2: '1',  // blue  — Lavender
  1: '8',  // grey  — Graphite
}

/**
 * Create a "Focus: <title>" event in the user's primary calendar.
 * Returns the new GCal event id to store on the task.
 */
/**
 * Marker written into every auto-scheduled block's private extended properties.
 *
 * A task row has one `gcal_event_id` column but a task can occupy several
 * blocks (a long task split into segments, a habit scheduled 4× a week), so the
 * DB cannot record every event it created. Tagging the events makes Google
 * Calendar itself the register of what we scheduled: cleanup lists by tag
 * instead of trusting a column that only ever held the last id.
 */
export const AUTO_BLOCK_TAG = 'plannerAuto'

/**
 * Footer on every event Planner writes.
 *
 * The extended-property tag is invisible in Google Calendar, so from inside
 * Calendar there's no way to tell one of these blocks from an event you made
 * yourself — which matters most when you're deciding whether it's safe to
 * delete something. The description is the one field Calendar shows everywhere.
 */
export const PLANNER_SIGNATURE = '— Created by Planner'

/** Task note plus the signature, or the signature alone when there's no note. */
function describeBlock(note?: string | null): string {
  const body = note?.trim()
  return body ? `${body}\n\n${PLANNER_SIGNATURE}` : PLANNER_SIGNATURE
}

export async function createTaskBlock(
  accessToken: string,
  task: { title: string; description?: string | null; priority: number; id?: string },
  startISO: string,
  endISO: string,
  /**
   * Tag this block as auto-scheduled so a later run can find and clear it.
   * Must stay false for manually placed blocks — those are user-owned and the
   * auto-schedule sweep would delete them.
   */
  auto = false,
  /**
   * Leading glyph. '🎯' is work planned ahead; '✓' is a session already done.
   *
   * These stay emoji, deliberately. They go into the *title of a real Google
   * Calendar event*, which is plain text rendered by Google's clients — an SVG
   * icon cannot go there, and changing the glyph would make every event written
   * from now on inconsistent with the ones already in the calendar.
   */
  prefix = '🎯',
): Promise<string> {
  const body = {
    summary:     `${prefix} ${task.title}`,
    description: describeBlock(task.description),
    colorId:     PRIORITY_COLOR_ID[task.priority] ?? '8',
    start: { dateTime: startISO },
    end:   { dateTime: endISO },
    ...(auto
      ? {
          extendedProperties: {
            private: {
              [AUTO_BLOCK_TAG]: 'true',
              ...(task.id ? { plannerTaskId: task.id } : {}),
            },
          },
        }
      : {}),
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) throw new Error(`GCal createEvent ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.id as string
}

/**
 * Update the start/end time of an existing task block.
 */
export async function updateTaskBlock(
  accessToken: string,
  gcalEventId: string,
  startISO: string,
  endISO: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalEventId}`,
    {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start: { dateTime: startISO }, end: { dateTime: endISO } }),
    },
  )
  if (!res.ok) throw new Error(`GCal updateEvent ${res.status}: ${await res.text()}`)
}

/**
 * List the ids of auto-scheduled blocks in a time window.
 *
 * Used to clear the previous auto-schedule before writing a new one. Because it
 * queries by tag rather than by stored id, it also sweeps up blocks orphaned by
 * earlier runs that could not record every event they created.
 */
export async function listAutoScheduledEvents(
  accessToken: string,
  timeMinISO:  string,
  timeMaxISO:  string,
): Promise<{ id: string; taskId: string | null }[]> {
  const out: { id: string; taskId: string | null }[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      timeMin:                 timeMinISO,
      timeMax:                 timeMaxISO,
      singleEvents:            'true',
      maxResults:              '250',
      privateExtendedProperty: `${AUTO_BLOCK_TAG}=true`,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok) throw new Error(`GCal listEvents ${res.status}: ${await res.text()}`)

    const data = await res.json()
    for (const item of data.items ?? []) {
      if (!item.id) continue
      out.push({
        id: item.id as string,
        taskId: item.extendedProperties?.private?.plannerTaskId ?? null,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return out
}

/**
 * Delete a task block from GCal. Silently ignores 404 (already deleted).
 */
export async function deleteTaskBlock(
  accessToken: string,
  gcalEventId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalEventId}`,
    {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`GCal deleteEvent ${res.status}: ${await res.text()}`)
  }
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
