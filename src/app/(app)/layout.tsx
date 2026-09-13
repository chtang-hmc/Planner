import { createServiceClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import { Project } from '@/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = createServiceClient()
  const { data: projects } = await db
    .from('projects')
    .select('*')
    .eq('archived', false)
    .order('name')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <Sidebar projects={(projects ?? []) as Project[]} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
