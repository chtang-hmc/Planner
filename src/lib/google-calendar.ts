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
 * Local rows whose event is no longer in Google's answer for the same window.
 *
 * Separated out because it is the whole of the deletion rule and the rest of
 * the sync cannot be tested — this part can. `liveIds` is what the pull
 * actually returned, already filtered to events that still exist; anything in
 * the window and not in that set has been deleted in Google, because a pull
 * with `singleEvents=true` reports a deleted event by omitting it.
 */
export function staleEventIds(
  local: { id: string; gcal_id: string }[],
  liveIds: string[],
): string[] {
  const live = new Set(liveIds)
  return local.filter(r => !live.has(r.gcal_id)).map(r => r.id)
}

/**
 * Full sync: fetch events from Google, map to DB schema, upsert.
 * Call this directly from server actions instead of going through the API route
 * to avoid self-referential HTTP calls that break in serverless environments.
 */
export async function syncCalendarEvents(): Promise<number> {
  const token = await getValidToken()
  if (!token) throw new Error('Google Calendar not connected')

  const { events, timeMin, timeMax, complete } = await fetchCalendarEvents(token.access_token)

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

  /**
   * Delete what Google no longer has.
   *
   * The sync only ever upserted, so an event deleted in Google stayed in the
   * table for good and kept showing on Home. Google does not report deletions
   * — with `singleEvents=true` a deleted event is simply absent — so the only
   * way to see one is to compare the window against what came back.
   *
   * Three things this is careful about:
   *
   *   - **Only inside the window that was fetched.** Rows outside ±7/+30 were
   *     never asked about and their absence means nothing.
   *   - **Only rows from Google.** `source` distinguishes them from anything
   *     parsed out of mail, which this pull knows nothing about.
   *   - **Never on an incomplete or empty response.** `task_event_links`
   *     cascades on delete, so a fluke empty page would not just drop the
   *     cache — it would permanently discard the task↔event links the user
   *     confirmed by hand, and the next sync would re-add the events under new
   *     ids with nothing pointing at them. An emptied calendar is the one case
   *     this refuses to reconcile; it is rarer than a bad response, and the
   *     rows are harmless until the next real one.
   */
  if (complete && rows.length > 0) {
    const { data: local, error: listErr } = await db
      .from('calendar_events')
      .select('id, gcal_id')
      .eq('source', 'google_calendar')
      .gte('start_time', timeMin.toISOString())
      .lt('start_time', timeMax.toISOString())

    if (listErr) {
      console.error('syncCalendarEvents: could not list events in the window:', listErr.message)
    } else {
      /* Compared in JS rather than as a `not in (…)` filter. The ids are
         Google's strings and that filter has to be built by concatenating them
         into a quoted list, which is the shape of a problem; and it makes the
         rule testable, which a query is not. The window is ~150 rows. */
      const stale = staleEventIds(local ?? [], rows.map(r => r.gcal_id))
      if (stale.length > 0) {
        const { error: delErr } = await db.from('calendar_events').delete().in('id', stale)
        if (delErr) console.error('syncCalendarEvents: could not delete stale events:', delErr.message)
        else console.log(`syncCalendarEvents: removed ${stale.length} event(s) deleted in Google`)
      }
    }
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

/** How far back and forward a sync looks. Everything outside is left alone. */
export const SYNC_DAYS_BACK = 7
export const SYNC_DAYS_FORWARD = 30

export interface CalendarWindow {
  events:  GCalEvent[]
  timeMin: Date
  timeMax: Date
  /** False when a page failed to arrive, which makes the result incomplete. */
  complete: boolean
}

/**
 * Every event in the sync window, following pagination to the end.
 *
 * It used to ask for `maxResults: 250` and take whatever came back. That was
 * survivable while the sync only ever *added* rows — a truncated page just
 * meant a few events missing until the next pull. It stops being survivable
 * the moment the sync also deletes: a truncated response would look exactly
 * like "the user deleted the rest", and the reconciliation below would act on
 * it. There are already 150 events inside this window on the live calendar,
 * so the cap is not hypothetical headroom.
 *
 * The window is returned with the events so the caller reconciles against the
 * same range that was asked about, rather than a second guess at it.
 */
export async function fetchCalendarEvents(accessToken: string): Promise<CalendarWindow> {
  const timeMin = new Date()
  timeMin.setDate(timeMin.getDate() - SYNC_DAYS_BACK)

  const timeMax = new Date()
  timeMax.setDate(timeMax.getDate() + SYNC_DAYS_FORWARD)

  const events: GCalEvent[] = []
  let pageToken: string | undefined
  let pages = 0
  /* A stop, not a limit: 20 pages is 5,000 events in a 37-day window, which is
     not a calendar, it is a loop that will not end. */
  const MAX_PAGES = 20

  do {
    const params = new URLSearchParams({
      timeMin:      timeMin.toISOString(),
      timeMax:      timeMax.toISOString(),
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Google Calendar API ${res.status}: ${body}`)
    }

    const data = await res.json()
    events.push(...((data.items ?? []) as GCalEvent[]))
    pageToken = data.nextPageToken
    pages++
  } while (pageToken && pages < MAX_PAGES)

  return { events, timeMin, timeMax, complete: !pageToken }
}
