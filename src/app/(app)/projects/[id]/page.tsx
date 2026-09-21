import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, EstimationProfile, HabitStreak, CalendarEvent } from '@/types'
import { fetchTimezone, todayStr, startOfLocalDay } from '@/lib/day'
import ProjectDetailView from './ProjectDetailView'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

/** The calendar block's window: today plus six days. */
const CALENDAR_DAYS = 7

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const db = createServiceClient()

  const [
    tz,
    { data: project, error: pe },
    { data: tasks },
    { data: allProjects },
    { data: bias },
    { data: streakRows },
    { data: integration },
    { data: links },
  ] = await Promise.all([
    fetchTimezone(db),
    db.from('projects').select('*').eq('id', id).single(),
    /**
     * Every task in this project, at every status.
     *
     * Progress, the repeating panel's history and the estimate panel all read
     * the finished ones. Splitting active and done into two queries, as this
     * page used to, meant the done list was capped at 50 and the percentage
     * quietly stopped being a percentage on the 51st.
     */
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('project_id', id)
      .order('urgency_score', { ascending: false }),
    db.from('projects').select('*').eq('archived', false).order('name'),
    db.from('estimation_profiles').select('*').eq('project_id', id).maybeSingle(),
    db.from('habit_streaks').select('*'),
    db.from('user_integrations').select('scopes').eq('provider', 'google').maybeSingle(),
    /* Confirmed only. A suggestion is a guess, and the calendar block reads as
       a record of what is actually booked. */
    db.from('task_event_links').select('task_id, event_id').eq('status', 'confirmed'),
  ])

  if (pe || !project) notFound()

  const today = todayStr(tz)
  /* Local midnight, not UTC midnight. `today + 'T00:00:00Z'` is the instant
     the day begins in London; on the US west coast that is five in the
     afternoon *yesterday*, so an evening event would fall outside a window
     that is supposed to start today. */
  const fromMs = startOfLocalDay(today, tz).getTime()
  const toMs   = fromMs + CALENDAR_DAYS * 86_400_000

  const { data: events } = await db
    .from('calendar_events')
    .select('*')
    .gte('start_time', new Date(fromMs - 86_400_000).toISOString())
    .lt('start_time', new Date(toMs + 86_400_000).toISOString())

  const streaks: Record<string, HabitStreak> = {}
  for (const s of streakRows ?? []) streaks[s.task_id] = s as HabitStreak

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <ProjectDetailView
      project={project as Project}
      tasks={(tasks ?? []) as (Task & { project: Project })[]}
      allProjects={(allProjects ?? []) as Project[]}
      bias={bias as EstimationProfile | null}
      streaks={streaks}
      gcalWriteEnabled={gcalWriteEnabled}
      links={(links ?? []) as { task_id: string; event_id: string }[]}
      events={(events ?? []) as CalendarEvent[]}
      todayStr={today}
      tz={tz}
      windowMs={[fromMs, toMs]}
    />
  )
}
