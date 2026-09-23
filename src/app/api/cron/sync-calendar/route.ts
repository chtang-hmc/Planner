import { NextResponse, type NextRequest } from 'next/server'
import { syncCalendarEvents } from '@/lib/google-calendar'

/**
 * The calendar sync, on a schedule.
 *
 * Until this existed the calendar was only pulled when something asked: the
 * OAuth callback on first connect, and the `refresh` link on Home. So Home
 * could show a day that had changed hours ago, and a deleted event stayed
 * visible until someone happened to press a button — which is what made a
 * missing deletion look like a bug in the sync rather than the absence of one.
 *
 * **It authenticates itself, because nothing else can.** A cron request
 * carries no session, so the edge gate lets `/api/cron/` through (see
 * `proxy.ts`) and this route is responsible for its own door. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when that variable is set; with the
 * variable unset the route refuses everything rather than defaulting open — an
 * unauthenticated endpoint that spends someone's Google quota is not a thing
 * to leave lying around.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('cron/sync-calendar: CRON_SECRET is not set; refusing')
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const synced = await syncCalendarEvents()
    return NextResponse.json({ synced })
  } catch (err) {
    /* A failed pull is not a failed deployment, and Vercel retries nothing.
       Report it in the body and log it; the next run tries again. Returning
       500 would only turn an expired Google token into a red cron. */
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron/sync-calendar:', message)
    return NextResponse.json({ error: message }, { status: 200 })
  }
}
