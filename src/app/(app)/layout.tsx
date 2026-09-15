import { createServiceClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import TimerShell from '@/components/TimerShell'
import TopSearchBar from '@/components/TopSearchBar'
import { Project } from '@/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = createServiceClient()
  const { data: projects } = await db
    .from('projects')
    .select('*')
    .eq('archived', false)
    .order('name')

  return (
    <TimerShell>
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
        <Sidebar projects={(projects ?? []) as Project[]} />

        {/* Main area: search bar fixed at top, content scrolls below */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopSearchBar />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </TimerShell>
  )
}
