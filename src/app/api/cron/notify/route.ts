import { NextResponse, type NextRequest } from 'next/server'
import { runTick } from '@/lib/notify-run'

/**
 * The notification scheduler's tick, called every five minutes by `pg_cron`
 * (migration 0024). Authenticates itself exactly as `cron/sync-calendar`
 * does, because the edge gate lets `/api/cron/` through: `CRON_SECRET` as a
 * bearer token, and everything refused while that variable is unset.
 *
 * `?dry=1` returns what would be sent at this minute without sending or
 * logging anything, for checking a schedule from a terminal.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('cron/notify: CRON_SECRET is not set; refusing')
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const report = await runTick({ dryRun: request.nextUrl.searchParams.get('dry') === '1' })
    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron/notify:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
