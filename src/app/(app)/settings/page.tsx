import { createServiceClient } from '@/lib/supabase/server'
import { normalizeRelevance } from '@/lib/relevance'
import SettingsView from './SettingsView'
import { isWeekStartDay, WEEK_START_DEFAULT } from '@/lib/week'
import { listDailyBreaks } from '@/app/actions/scheduling'

export const metadata = { title: 'Settings — Planner' }

/**
 * The only page under `(app)` that was not dynamic, and it reads the database
 * in its own body and in the shared layout.
 *
 * Next prerendered it at build time, so the build ran `createServiceClient()`
 * — and on a Vercel Preview, where the environment variables are
 * Production-scoped, that is `supabaseUrl is required` and a failed
 * deployment. It is per-user, live configuration; there was never a static
 * version of it to serve.
 */
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const db = createServiceClient()

  const [
    { data: integration },
    { data: whRows },
    { data: esRows },
    { data: configRow },
  ] = await Promise.all([
    db.from('user_integrations').select('scopes, connected_at').eq('provider', 'google').maybeSingle(),
    db.from('user_working_hours').select('*'),
    db.from('user_energy_schedule').select('*'),
    db.from('user_scheduling_config').select('*').limit(1).maybeSingle(),
  ])

  const gcalConnected     = !!integration
  const gcalHasWriteScope = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <SettingsView
      gcalConnected={gcalConnected}
      gcalHasWriteScope={gcalHasWriteScope}
      gcalConnectedAt={integration?.connected_at ?? null}
      workingHours={whRows ?? []}
      energySchedule={esRows ?? []}
      maxSession={configRow?.max_session_minutes ?? 90}
      bufferMinutes={configRow?.buffer_minutes ?? 15}
      weekStartDay={isWeekStartDay(configRow?.week_start_day) ? configRow.week_start_day : WEEK_START_DEFAULT}
      breaks={await listDailyBreaks()}
      relevance={normalizeRelevance(configRow)}
    />
  )
}
