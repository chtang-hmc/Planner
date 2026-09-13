import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, EstimationProfile } from '@/types'
import ProjectsView from './ProjectsView'

export const dynamic = 'force-dynamic'

export interface ProjectData {
  project: Project
  activeTasks: (Task & { project: Project })[]
  doneCount: number
  bias: EstimationProfile | null
}

export default async function ProjectsPage() {
  const db = createServiceClient()

  const [
    { data: projects },
    { data: activeTasks },
    { data: doneCounts },
    { data: biasProfiles },
  ] = await Promise.all([
    db.from('projects').select('*').eq('archived', false).order('name'),
    db
      .from('tasks')
      .select('*, project:projects(id, name, color, archived, created_at)')
      .in('status', ['inbox', 'active'])
      .order('urgency_score', { ascending: false }),
    db
      .from('tasks')
      .select('project_id')
      .eq('status', 'done'),
    db.from('estimation_profiles').select('*'),
  ])

  const doneByProject: Record<string, number> = {}
  for (const t of doneCounts ?? []) {
    doneByProject[t.project_id] = (doneByProject[t.project_id] ?? 0) + 1
  }

  const biasMap: Record<string, EstimationProfile> = {}
  for (const b of biasProfiles ?? []) {
    biasMap[b.project_id] = b as EstimationProfile
  }

  const projectDataList: ProjectData[] = (projects ?? []).map((p) => ({
    project: p as Project,
    activeTasks: ((activeTasks ?? []) as (Task & { project: Project })[]).filter(
      (t) => t.project_id === p.id
    ),
    doneCount: doneByProject[p.id] ?? 0,
    bias: biasMap[p.id] ?? null,
  }))

  const allProjects = (projects ?? []) as Project[]

  return <ProjectsView projectDataList={projectDataList} allProjects={allProjects} />
}
