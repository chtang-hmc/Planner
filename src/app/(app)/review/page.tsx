import { createServiceClient } from '@/lib/supabase/server'
import { daysSinceWeekStart, fetchWeekStartDay } from '@/lib/week'
import { Task, Project, INBOX_PROJECT } from '@/types'
import ReviewView from './ReviewView'

export const dynamic = 'force-dynamic'

export interface ReviewData {
  // Step 1: This week
  weeklyCompleted: (Task & { project: Project })[]
  weekStart: string   // ISO date of the current week's first day

  // Step 2: Overdue
  overdue: (Task & { project: Project })[]

  // Step 3: Inbox (no project)
  inbox: (Task & { project: Project })[]

  // Step 4: Upcoming (due in next 7 days, not overdue)
  upcoming: (Task & { project: Project })[]

  // Step 5: Someday
  someday: (Task & { project: Project })[]

  // For the add-task modal
  projects: Project[]
}

/** Start of the current week in local time, per the configured first day. */
function weekStartLocal(weekStartDay: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysSinceWeekStart(d.getDay(), weekStartDay))
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default async function ReviewPage() {
  const db = createServiceClient()
  const now = new Date().toISOString()
  const weekStartDay = await fetchWeekStartDay(db)
  const weekStart = weekStartLocal(weekStartDay)
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString()

  const [
    { data: completedThisWeek },
    { data: activeTasks },
    { data: projects },
  ] = await Promise.all([
    db.from('tasks')
      .select('*, project:projects(id, name, color, archived, created_at)')
      .eq('status', 'done')
      .gte('completed_at', weekStart)
      .order('completed_at', { ascending: false }),
    db.from('tasks')
      .select('*, project:projects(id, name, color, archived, created_at)')
      .in('status', ['inbox', 'active'])
      .order('urgency_score', { ascending: false }),
    db.from('projects').select('*').eq('archived', false).order('name'),
  ])

  const allActive = (activeTasks ?? []) as (Task & { project: Project | null })[]

  function withFallback(tasks: (Task & { project: Project | null })[]) {
    return tasks.map(t => ({ ...t, project: t.project ?? INBOX_PROJECT })) as (Task & { project: Project })[]
  }

  const overdue  = withFallback(allActive.filter(t => t.due_date && t.due_date < now))
  const inbox    = withFallback(allActive.filter(t => !t.project_id && t.type !== 'someday'))
  const upcoming = withFallback(allActive.filter(t =>
    t.due_date && t.due_date >= now && t.due_date <= in7days
  ))
  const someday  = withFallback(allActive.filter(t => t.type === 'someday'))

  const data: ReviewData = {
    weeklyCompleted: withFallback(
      (completedThisWeek ?? []) as (Task & { project: Project | null })[]
    ),
    weekStart: weekStart,
    overdue,
    inbox,
    upcoming,
    someday,
    projects: (projects ?? []) as Project[],
  }

  return <ReviewView data={data} />
}
