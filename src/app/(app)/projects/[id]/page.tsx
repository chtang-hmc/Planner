import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, EstimationProfile, HabitStreak } from '@/types'
import ProjectDetailView from './ProjectDetailView'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const db = createServiceClient()

  const [
    { data: project, error: pe },
    { data: activeTasks },
    { data: doneTasks },
    { data: allProjects },
    { data: bias },
    { data: streakRows },
    { data: integration },
  ] = await Promise.all([
    db.from('projects').select('*').eq('id', id).single(),
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('project_id', id)
      .in('status', ['inbox', 'active'])
      .order('urgency_score', { ascending: false }),
    db.from('tasks')
      .select('*')
      .eq('project_id', id)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(50),
    db.from('projects').select('*').eq('archived', false).order('name'),
    db.from('estimation_profiles').select('*').eq('project_id', id).maybeSingle(),
    db.from('habit_streaks').select('*'),
    db.from('user_integrations').select('scopes').eq('provider', 'google').maybeSingle(),
  ])

  if (pe || !project) notFound()

  const streaks: Record<string, HabitStreak> = {}
  for (const s of streakRows ?? []) streaks[s.task_id] = s as HabitStreak

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <ProjectDetailView
      project={project as Project}
      activeTasks={(activeTasks ?? []) as (Task & { project: Project })[]}
      doneTasks={(doneTasks ?? []) as Task[]}
      allProjects={(allProjects ?? []) as Project[]}
      bias={bias as EstimationProfile | null}
      streaks={streaks}
      gcalWriteEnabled={gcalWriteEnabled}
    />
  )
}
