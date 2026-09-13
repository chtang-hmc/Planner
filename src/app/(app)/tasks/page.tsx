import { createServiceClient as createClient } from '@/lib/supabase/server'
import { Task, Project } from '@/types'
import TaskList from './TaskList'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const db = createClient()

  // Fetch all active/inbox tasks with their projects, sorted by urgency
  const { data: tasks, error: te } = await db
    .from('tasks')
    .select('*, project:projects(id, name, color)')
    .in('status', ['inbox', 'active'])
    .order('urgency_score', { ascending: false })

  const { data: projects, error: pe } = await db
    .from('projects')
    .select('*')
    .eq('archived', false)
    .order('name')

  if (te) console.error('Tasks fetch error:', te.message)
  if (pe) console.error('Projects fetch error:', pe.message)

  return (
    <TaskList
      tasks={(tasks ?? []) as (Task & { project: Project })[]}
      projects={(projects ?? []) as Project[]}
    />
  )
}
