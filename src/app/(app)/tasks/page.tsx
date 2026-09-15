import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, CalendarEvent, HabitStreak } from '@/types'
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
    { data: streakRows },
  ] = await Promise.all([
    // Habits live on /habits and are excluded here so they don't clutter the
    // task list with untimed, non-urgent recurring work.
    db.from('tasks')
      .select('*, project:projects(id, name, color)')
      .in('status', ['inbox', 'active'])
      .neq('type', 'habit')
      .order('urgency_score', { ascending: false }),
    db.from('projects')
      .select('*')
      .eq('archived', false)
      .order('name'),
    db.from('calendar_events')
      .select('*')
      .gte('end_time', new Date().toISOString())
      .order('start_time')
      .limit(100),
    db.from('user_integrations')
      .select('id, scopes')
      .eq('provider', 'google')
      .maybeSingle(),
    db.from('habit_streaks').select('*'),
  ])

  if (te) console.error('Tasks fetch error:', te.message)
  if (pe) console.error('Projects fetch error:', pe.message)

  // Index streaks by task_id for O(1) lookup in TaskList / TaskDetail
  const streaks: Record<string, HabitStreak> = {}
  for (const s of streakRows ?? []) {
    streaks[s.task_id] = s as HabitStreak
  }

  const calEvents = (events ?? []) as CalendarEvent[]

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto min-w-0">
        <TaskList
          tasks={(tasks ?? []) as (Task & { project: Project })[]}
          projects={(projects ?? []) as Project[]}
          streaks={streaks}
          events={calEvents}
          gcalWriteEnabled={gcalWriteEnabled}
        />
      </div>
      <CalendarPanel
        events={calEvents}
        connected={!!integration}
      />
    </div>
  )
}
