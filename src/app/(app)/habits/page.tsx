import { createServiceClient } from '@/lib/supabase/server'
import { Project } from '@/types'
import { fetchWeekStartDay } from '@/lib/week'
import { fetchTimezone, todayStr, startOfLocalDay, addDays } from '@/lib/day'
import { fetchTodaysHabits } from '@/lib/habits'
import HabitsView from './HabitsView'

export const dynamic = 'force-dynamic'

export default async function HabitsPage() {
  const db = createServiceClient()

  // The user's day. Habit days are local days (src/lib/day.ts): an evening
  // session belongs to the evening you had, not to whatever date it already is
  // in UTC.
  const tz    = await fetchTimezone(db)
  const today = todayStr(tz)
  const weekStartDay = await fetchWeekStartDay(db)

  // Sixteen weeks back, for the completion calendar. Home reads the same
  // function with a one-week window; the weekly count is identical either way.
  const cutoff = startOfLocalDay(addDays(today, -112), tz).toISOString()

  const [{ habits, doneTodayIds, streaks, completionMap }, { data: projects }, { data: integration }] =
    await Promise.all([
      fetchTodaysHabits(db, { tz, today, weekStartDay, completionsSinceISO: cutoff }),
      db.from('projects').select('*').eq('archived', false).order('name'),
      db.from('user_integrations').select('id, scopes').eq('provider', 'google').maybeSingle(),
    ])

  const gcalWriteEnabled = (integration?.scopes ?? []).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )

  return (
    <HabitsView
      habits={habits}
      completionMap={completionMap}
      doneToday={doneTodayIds}
      projects={(projects ?? []) as Project[]}
      streaks={streaks}
      gcalWriteEnabled={gcalWriteEnabled}
      weekStartDay={weekStartDay}
      tz={tz}
    />
  )
}
