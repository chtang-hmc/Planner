import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project } from '@/types'
import { fetchTimezone, todayStr } from '@/lib/day'
import ProjectsView from './ProjectsView'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const db = createServiceClient()

  const [tz, { data: projects }, { data: tasks }] = await Promise.all([
    fetchTimezone(db),
    db.from('projects').select('*').order('name'),
    /**
     * Every task at every status, not just the open ones.
     *
     * `buildProjectRows` needs the completed ones to compute progress and to
     * know when a project last finished anything — a table built from the open
     * tasks alone cannot tell a never-started project from a finished one.
     */
    db.from('tasks').select('*, project:projects(id, name, color, archived, created_at)'),
  ])

  const allTasks = (tasks ?? []) as (Task & { project: Project | null })[]

  // Subtasks per parent, for the `N steps` chip. Counted here because only the
  // fetch knows whether the children came back.
  const kidCounts: Record<string, number> = {}
  for (const t of allTasks) {
    if (t.parent_id) kidCounts[t.parent_id] = (kidCounts[t.parent_id] ?? 0) + 1
  }

  const all = (projects ?? []) as Project[]

  return (
    <ProjectsView
      projects={all.filter(p => !p.archived)}
      archivedProjects={all.filter(p => p.archived)}
      tasks={allTasks}
      kidCounts={kidCounts}
      todayStr={todayStr(tz)}
    />
  )
}
