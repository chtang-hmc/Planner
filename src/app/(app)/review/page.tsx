import { createServiceClient } from '@/lib/supabase/server'
import { weekStartOfDay, fetchWeekStartDay } from '@/lib/week'
import { fetchTimezone, todayStr, addDays, startOfLocalDay } from '@/lib/day'
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

export default async function ReviewPage() {
  const db = createServiceClient()
  const [weekStartDay, tz] = await Promise.all([fetchWeekStartDay(db), fetchTimezone(db)])

  // A due date is a calendar *day*, stored at UTC midnight — so it's compared
  // as a day, against the user's today. Comparing it to the current instant
  // (what this did before) marks a task due today as overdue the moment UTC
  // midnight passes, which is mid-afternoon the day before on the US west
  // coast: "due tomorrow" showed up overdue, and dated today.
  const today    = todayStr(tz)
  const in7days  = addDays(today, 7)
  // completed_at is a real instant, so the week boundary is one too — the
  // user's local week start, not the server's midnight.
  const weekStart = startOfLocalDay(weekStartOfDay(today, weekStartDay), tz).toISOString()

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

  const overdue  = withFallback(allActive.filter(t => t.due_date && t.due_date.slice(0, 10) < today))
  const inbox    = withFallback(allActive.filter(t => !t.project_id && t.type !== 'someday'))
  const upcoming = withFallback(allActive.filter(t => {
    if (!t.due_date) return false
    const day = t.due_date.slice(0, 10)
    return day >= today && day <= in7days
  }))
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
