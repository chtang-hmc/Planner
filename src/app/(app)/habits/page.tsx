import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, HabitStreak } from '@/types'
import HabitsView from './HabitsView'

export const dynamic = 'force-dynamic'

export default async function HabitsPage() {
  const db = createServiceClient()
  const cutoff = new Date(Date.now() - 112 * 24 * 60 * 60 * 1000).toISOString() // 16 weeks back

  // Day boundaries in UTC — due_date is always stored at UTC midnight (see
  // CLAUDE.md), so comparing against UTC day edges keeps "due today" stable
  // regardless of the server's local timezone.
  const now        = new Date()
  const endOfDay   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))

  const [
    { data: activeHabits },
    { data: doneTodayRows },
    { data: completions },
    { data: projects },
    { data: streakRows },
    { data: integration },
  ] = await Promise.all([
    // Habits still pending: due today or earlier (tomorrow's spawned occurrences stay hidden)
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('type', 'habit')
      .in('status', ['inbox', 'active'])
      .is('parent_id', null)
      .or(`due_date.is.null,due_date.lte.${endOfDay.toISOString()}`)
      .order('title'),

    // Habits already completed today. Completing a habit flips its row to
    // 'done' and spawns tomorrow's occurrence, so without this query the habit
    // would disappear from the page entirely instead of showing as done.
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('type', 'habit')
      .eq('status', 'done')
      .is('parent_id', null)
      .gte('completed_at', startOfDay.toISOString())
      .order('title'),

    // Completed habit instances in the past 16 weeks for the calendar
    db.from('tasks')
      .select('title, completed_at')
      .eq('type', 'habit')
      .eq('status', 'done')
      .gte('completed_at', cutoff)
      .not('completed_at', 'is', null),

    db.from('projects').select('*').eq('archived', false).order('name'),

    // Streaks + GCal state power the habit detail panel (weekly goal progress,
    // session length, schedule block)
    db.from('habit_streaks').select('*'),

    db.from('user_integrations')
      .select('id, scopes')
      .eq('provider', 'google')
      .maybeSingle(),
  ])

  const streaks: Record<string, HabitStreak> = {}
  for (const s of streakRows ?? []) streaks[s.task_id] = s as HabitStreak

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  // Map: habit title → sorted list of YYYY-MM-DD completion dates (unique)
  const completionMap: Record<string, string[]> = {}
  for (const c of completions ?? []) {
    if (!c.completed_at) continue
    const date = c.completed_at.slice(0, 10)
    if (!completionMap[c.title]) completionMap[c.title] = []
    if (!completionMap[c.title].includes(date)) completionMap[c.title].push(date)
  }

  // One row per habit, keyed by title: a habit family spans many rows (each
  // completion closes one row and spawns the next occurrence). A pending row
  // always wins over a done-today row so the habit stays actionable if it's
  // somehow both.
  const byTitle = new Map<string, { row: Task & { project: Project }; done: boolean }>()

  for (const h of (doneTodayRows ?? []) as (Task & { project: Project })[]) {
    if (!byTitle.has(h.title)) byTitle.set(h.title, { row: h, done: true })
  }
  for (const h of (activeHabits ?? []) as (Task & { project: Project })[]) {
    byTitle.set(h.title, { row: h, done: false })
  }

  const habits    = [...byTitle.values()].map(v => v.row).sort((a, b) => a.title.localeCompare(b.title))
  const doneToday = [...byTitle.values()].filter(v => v.done).map(v => v.row.id)

  return (
    <HabitsView
      habits={habits}
      completionMap={completionMap}
      doneToday={doneToday}
      projects={(projects ?? []) as Project[]}
      streaks={streaks}
      gcalWriteEnabled={gcalWriteEnabled}
    />
  )
}
