import { createServiceClient } from '@/lib/supabase/server'
import SettingsView from './SettingsView'

export const metadata = { title: 'Settings — Planner' }

export default async function SettingsPage() {
  const db = createServiceClient()
  const { data: integration } = await db
    .from('user_integrations')
    .select('scopes, connected_at')
    .eq('provider', 'google')
    .maybeSingle()

  const gcalConnected      = !!integration
  const gcalHasWriteScope  = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <SettingsView
      gcalConnected={gcalConnected}
      gcalHasWriteScope={gcalHasWriteScope}
      gcalConnectedAt={integration?.connected_at ?? null}
    />
  )
}
