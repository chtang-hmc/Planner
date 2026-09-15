import { createServiceClient } from '@/lib/supabase/server'
import { Task, Project } from '@/types'
import HabitsView from './HabitsView'

export const dynamic = 'force-dynamic'

export default async function HabitsPage() {
  const db = createServiceClient()
  const cutoff    = new Date(Date.now() - 112 * 24 * 60 * 60 * 1000).toISOString() // 16 weeks back
  const endOfDay  = new Date(); endOfDay.setHours(23, 59, 59, 999)

  const [
    { data: activeHabits },
    { data: completions },
    { data: projects },
  ] = await Promise.all([
    // Only habits due today or earlier (tomorrow's spawned occurrences stay hidden)
    db.from('tasks')
      .select('*, project:projects(id,name,color,archived,created_at)')
      .eq('type', 'habit')
      .in('status', ['inbox', 'active'])
      .is('parent_id', null)
      .or(`due_date.is.null,due_date.lte.${endOfDay.toISOString()}`)
      .order('title'),

    // Completed habit instances in the past 16 weeks for the calendar
    db.from('tasks')
      .select('title, completed_at')
      .eq('type', 'habit')
      .eq('status', 'done')
      .gte('completed_at', cutoff)
      .not('completed_at', 'is', null),

    db.from('projects').select('*').eq('archived', false).order('name'),
  ])

  // Map: habit title → sorted list of YYYY-MM-DD completion dates (unique)
  const completionMap: Record<string, string[]> = {}
  for (const c of completions ?? []) {
    if (!c.completed_at) continue
    const date = c.completed_at.slice(0, 10)
    if (!completionMap[c.title]) completionMap[c.title] = []
    if (!completionMap[c.title].includes(date)) completionMap[c.title].push(date)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  // Habits already done today don't need to show — they've been completed
  // and their next occurrence is due tomorrow (hidden by the query above).
  // Pass doneToday so the client can show them greyed out vs. hiding entirely.
  const doneToday = new Set(
    (activeHabits ?? [])
      .filter(h => (completionMap[h.title] ?? []).includes(todayStr))
      .map(h => h.id)
  )

  return (
    <HabitsView
      habits={(activeHabits ?? []) as (Task & { project: Project })[]}
      completionMap={completionMap}
      doneToday={[...doneToday]}
      projects={(projects ?? []) as Project[]}
    />
  )
}
