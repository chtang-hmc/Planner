import { createServiceClient } from '@/lib/supabase/server'
import SettingsView from './SettingsView'

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
    />
  )
}
