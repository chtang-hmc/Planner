import { createServiceClient } from '@/lib/supabase/server'
import { normalizeRelevance } from '@/lib/relevance'
import SettingsView from './SettingsView'
import { isWeekStartDay, WEEK_START_DEFAULT } from '@/lib/week'
import { listDailyBreaks } from '@/app/actions/scheduling'

export const metadata = { title: 'Settings — Planner' }

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
