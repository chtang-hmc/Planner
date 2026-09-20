import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, CalendarEvent, HabitStreak } from '@/types'
import TaskList from './TaskList'
import { fetchWeekStartDay } from '@/lib/week'
import { addDays, fetchTimezone, todayStr as todayIn, startOfLocalDay } from '@/lib/day'
import { normalizeRelevance } from '@/lib/relevance'
import {
  freeGaps, localMidnight, workWindowFor,
  type BreakWindow, type Interval, type WorkingHours,
} from '@/lib/scheduler'
import { capacityFromGaps } from '@/lib/capacity'
import { MIN_GAP_MINUTES } from '@/lib/home'

/** How far the date groups reach. Two weeks is what Upcoming will want too. */
const HORIZON_DAYS = 15

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const db = createServiceClient()
  const tz = await fetchTimezone(db)
  const today = todayIn(tz)
  const startISO   = startOfLocalDay(today, tz).toISOString()
  const horizonISO = startOfLocalDay(addDays(today, HORIZON_DAYS), tz).toISOString()

  const [
    { data: tasks,      error: te },
    { data: projects,   error: pe },
    { data: events },
    { data: integration },
    { data: streakRows },
    { data: whRows },
    { data: breakRows },
  ] = await Promise.all([
    // Habits live on /habits and are excluded here so they don't clutter the
    // task list with untimed, non-urgent recurring work.
    db.from('tasks')
      .select('*, project:projects(id, name, color), parent:parent_id(id, title)')
      .in('status', ['inbox', 'active'])
      .neq('type', 'habit')
      .order('urgency_score', { ascending: false }),
    db.from('projects')
      .select('*')
      .eq('archived', false)
      .order('name'),
    // Two weeks, because every date group header carries a capacity meter and
    // that needs the events on its day. The old query took the next hundred
    // events from now, which is a different and much less useful window.
    db.from('calendar_events')
      .select('*')
      .lt('start_time', horizonISO)
      .gte('end_time', startISO)
      .order('start_time'),
    db.from('user_integrations')
      .select('id, scopes')
      .eq('provider', 'google')
      .maybeSingle(),
    db.from('habit_streaks').select('*'),
    db.from('user_working_hours').select('*'),
    db.from('user_daily_breaks').select('*').then(r => r, () => ({ data: null })),
  ])

  if (te) console.error('Tasks fetch error:', te.message)
  if (pe) console.error('Projects fetch error:', pe.message)

  // Index streaks by task_id for O(1) lookup in TaskList / TaskDetail
  const streaks: Record<string, HabitStreak> = {}
  for (const s of streakRows ?? []) {
    streaks[s.task_id] = s as HabitStreak
  }

  const calEvents = (events ?? []) as CalendarEvent[]

  const weekStartDay = await fetchWeekStartDay(db)


  /**
   * Free time per day, for the capacity meter in every date group header.
   *
   * Only the free half is computed here. What is *due* on a day is the group
   * the list has already built, so sending a due total down as well would be
   * the same number arrived at twice — and the two would disagree the moment
   * a filter hid a row.
   */
  const workingHours: WorkingHours[] = (whRows ?? []).map(r => ({
    day_of_week: r.day_of_week,
    start_hour: r.start_hour, start_minute: r.start_minute,
    end_hour: r.end_hour, end_minute: r.end_minute,
    enabled: r.enabled,
  }))
  const breaks: BreakWindow[] = ((breakRows ?? []) as Record<string, never>[])
    .filter(r => r.enabled)
    .map(r => ({
      label: r.label, durationMinutes: r.duration_minutes,
      startHour: r.start_hour, startMinute: r.start_minute,
      endHour: r.end_hour, endMinute: r.end_minute,
      cooldownMinutes: r.cooldown_minutes,
    }))

  const scheduled: Interval[] = ((tasks ?? []) as Task[])
    .filter(t => t.scheduled_start && t.scheduled_end)
    .map(t => [Date.parse(t.scheduled_start!), Date.parse(t.scheduled_end!)])

  const freeByDay: Record<string, { before: number; after: number }> = {}
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDays(today, i)
    const win = workWindowFor(localMidnight(day, tz), workingHours, tz)
    if (!win) continue   // a day off has no meter; the header simply omits it
    const busy: Interval[] = [
      ...calEvents.filter(e => !e.all_day)
        .map(e => [Date.parse(e.start_time), Date.parse(e.end_time)] as Interval),
      ...scheduled,
    ].filter(([bS, bE]) => bS < win[1] && bE > win[0])

    const { gaps } = freeGaps({ dayStr: day, tz, workingHours, busy, breaks, minMinutes: MIN_GAP_MINUTES })
    const c = capacityFromGaps({ gaps, dayStr: day, tz, dueMinutes: 0 })
    freeByDay[day] = { before: c.freeBeforeCutoff, after: c.freeAfterCutoff }
  }

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  // select('*') so a pre-0017 database returns the row without the columns;
  // normalizeRelevance then falls back to the constants the filter used before
  // they were settings.
  const { data: relevanceRow } = await db
    .from('user_scheduling_config').select('*').limit(1).maybeSingle()
  const relevance = normalizeRelevance(relevanceRow)

  return (
    /* The calendar rail is gone. Between the group headers' capacity meters and
       Today's own timeline, the calendar was appearing three times across two
       screens, and the one on this page was the copy that could not be acted
       on. */
    <div className="h-full overflow-y-auto">
        <TaskList
          tasks={(tasks ?? []) as (Task & { project: Project })[]}
          projects={(projects ?? []) as Project[]}
          streaks={streaks}
          events={calEvents}
          gcalWriteEnabled={gcalWriteEnabled}
          weekStartDay={weekStartDay}
          relevance={relevance}
          todayStr={today}
          freeByDay={freeByDay}
        />
    </div>
  )
}
