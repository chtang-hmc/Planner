import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, CalendarEvent } from '@/types'
import TaskList from './TaskList'
import CalendarPanel from '@/components/CalendarPanel'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const db = createServiceClient()

  const [
    { data: tasks,      error: te },
    { data: projects,   error: pe },
    { data: events },
    { data: integration },
  ] = await Promise.all([
    db.from('tasks')
      .select('*, project:projects(id, name, color)')
      .in('status', ['inbox', 'active'])
      .order('urgency_score', { ascending: false }),
    db.from('projects')
      .select('*')
      .eq('archived', false)
      .order('name'),
    db.from('calendar_events')
      .select('*')
      .gte('end_time', new Date().toISOString())   // include in-progress events
      .order('start_time')
      .limit(100),
    db.from('user_integrations')
      .select('id')
      .eq('provider', 'google')
      .maybeSingle(),
  ])

  if (te) console.error('Tasks fetch error:', te.message)
  if (pe) console.error('Projects fetch error:', pe.message)

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto min-w-0">
        <TaskList
          tasks={(tasks ?? []) as (Task & { project: Project })[]}
          projects={(projects ?? []) as Project[]}
        />
      </div>
      <CalendarPanel
        events={(events ?? []) as CalendarEvent[]}
        connected={!!integration}
      />
    </div>
  )
}
