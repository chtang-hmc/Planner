import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project, HabitStreak } from '@/types'
import { weekStartOfDay, fetchWeekStartDay } from '@/lib/week'
import { fetchTimezone, localDayStr, todayStr, localDayRange, startOfLocalDay, addDays } from '@/lib/day'
import HabitsView from './HabitsView'

export const dynamic = 'force-dynamic'

export default async function HabitsPage() {
  const db = createServiceClient()
  // Async Server Component: this runs once per request on the server, not
  // during a React render, so there is no hydration to mismatch and no
  // re-render to be impure in.
  // eslint-disable-next-line react-hooks/purity
  const cutoff = new Date(Date.now() - 112 * 24 * 60 * 60 * 1000).toISOString() // 16 weeks back

  // The user's day, as instants. Habit days are local days (src/lib/day.ts):
  // an evening session belongs to the evening you had, not to whatever date it
  // already is in UTC.
  const tz    = await fetchTimezone(db)
  const today = todayStr(tz)
  const { startISO: startOfDay, endISO: endOfDay } = localDayRange(today, tz)

  // When does tomorrow's occurrence stop being hidden?
  //
  // A pending habit is available once its day has begun locally. Requiring the
  // *UTC* day to have begun as well — an earlier attempt at tolerating rows
  // spawned before the timezone change — hid working habits for most of the
  // day: a row due `2026-09-17T00:00:00Z` is 17:00 on the 16th in Los Angeles,
  // so Gym and Piano disappeared from the page every morning and only returned
  // at 5pm. Costing a whole day is far worse than the thing it guarded against,
  // which is a UTC-midnight row surfacing a few hours early on its eve.
  const available = startOfLocalDay(addDays(today, 1), tz).toISOString()

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
      .or(`due_date.is.null,due_date.lt.${available}`)
      .order('title'),

    // Habits already completed today. Completing a habit flips its row to
    // 'done' and spawns tomorrow's occurrence, so without this query the habit
    // would disappear from the page entirely instead of showing as done.
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('type', 'habit')
      .eq('status', 'done')
      .is('parent_id', null)
      .gte('completed_at', startOfDay)
      .lt('completed_at', endOfDay)
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
    const date = localDayStr(c.completed_at, tz)
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

  // Weekly goal progress, counted as distinct days since the user's configured
  // first day of the week (Settings → Smart scheduling). completionMap
  // already holds one entry per day, so two sessions on one day count once — a
  // "4× a week" target means four days.
  //
  // habit_streaks.completions_this_week can't be used: it's keyed by task_id
  // and every occurrence is a new row, so the counter for the row on screen is
  // always stale. The streak handed to TaskDetail is patched with the real
  // count below.
  const weekStartDay = await fetchWeekStartDay(db)
  const weekStartStr = weekStartOfDay(today, weekStartDay)

  const weeklyDays: Record<string, number> = {}
  for (const [title, dates] of Object.entries(completionMap)) {
    weeklyDays[title] = dates.filter(d => d >= weekStartStr).length
  }

  for (const h of habits) {
    const existing = streaks[h.id]
    streaks[h.id] = {
      task_id:               h.id,
      current_streak:        existing?.current_streak  ?? 0,
      longest_streak:        existing?.longest_streak  ?? 0,
      last_completed:        existing?.last_completed  ?? '',
      week_start:            weekStartStr,
      completions_this_week: weeklyDays[h.title] ?? 0,
    }
  }

  return (
    <HabitsView
      habits={habits}
      completionMap={completionMap}
      doneToday={doneToday}
      projects={(projects ?? []) as Project[]}
      streaks={streaks}
      gcalWriteEnabled={gcalWriteEnabled}
      weekStartDay={weekStartDay}
      tz={tz}
    />
  )
}
