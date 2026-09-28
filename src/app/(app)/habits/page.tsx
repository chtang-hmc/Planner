import { createServiceClient } from '@/lib/supabase/server'
import { Project } from '@/types'
import { fetchWeekStartDay } from '@/lib/week'
import { fetchTimezone, todayStr } from '@/lib/day'
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

  const [{ habits, doneTodayIds, summaries, completionMap }, { data: projects }, { data: integration }] =
    await Promise.all([
      fetchTodaysHabits(db, { tz, today, weekStartDay }),
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
      summaries={summaries}
      gcalWriteEnabled={gcalWriteEnabled}
      weekStartDay={weekStartDay}
      tz={tz}
    />
  )
}
