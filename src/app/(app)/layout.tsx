import { createServiceClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import MobileTabBar from '@/components/MobileTabBar'
import TimerShell from '@/components/TimerShell'
import TopSearchBar from '@/components/TopSearchBar'
import TimezoneSync from '@/components/TimezoneSync'
import InstallHint from '@/components/InstallHint'
import { Project } from '@/types'
import { todayStr } from '@/lib/day'
import { fetchUserConfig } from '@/lib/user-config'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = createServiceClient()
  // In parallel, and the config read is shared with the page below through
  // `cache()` — the layout and the page used to read it separately (#96).
  const [{ data: projects }, config] = await Promise.all([
    db.from('projects').select('*').eq('archived', false).order('name'),
    fetchUserConfig(),
  ])

  // The sidebar draws today's date and cannot read the clock itself — see the
  // prop's comment. Resolved in the configured timezone, which is what the app
  // means by "today" everywhere else.
  const today = todayStr(config.timezone)

  return (
    <TimerShell>
      <TimezoneSync />
      <div className="app-shell flex overflow-hidden bg-slate-50 dark:bg-slate-950">
        <Sidebar projects={(projects ?? []) as Project[]} todayStr={today} />

        {/* Main area: search bar fixed at top, content scrolls below, and
            below 640 a tab bar at the bottom where the sidebar used to be.
            The bar is in the column rather than fixed over it, so a page's
            last row is never hidden underneath it. */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <TopSearchBar />
          <InstallHint />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
          <MobileTabBar />
        </div>
      </div>
    </TimerShell>
  )
}
