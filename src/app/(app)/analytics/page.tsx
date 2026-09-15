import { createServiceClient } from '@/lib/supabase/server'
import { Project, EstimationProfile, EnergyPattern } from '@/types'
import AnalyticsView from './AnalyticsView'

export const dynamic = 'force-dynamic'

export interface DailyEnergy {
  date: string        // YYYY-MM-DD
  avg: number         // 1–5
  count: number
}

export interface AnalyticsData {
  // Summary
  activeCount: number
  doneCount: number
  totalEstMinutes: number   // active tasks only
  avgUrgency: number

  // Urgency distribution — bucket counts [0-20), [20-40), [40-60), [60-80), [80-100]
  urgencyBuckets: number[]

  // Per-project stats
  projectStats: {
    project: Project
    activeCount: number
    estimatedMinutes: number
    doneCount: number
    bias: EstimationProfile | null
  }[]

  // Estimation accuracy from focus sessions
  accurateSessions: number
  inaccurateSessions: number

  // Energy
  recentEnergy: DailyEnergy[]      // last 7 days, ascending
  energyPatterns: EnergyPattern[]  // nightly rollup — empty until pg_cron has run
}

export default async function AnalyticsPage() {
  const db = createServiceClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: activeTasks },
    { data: doneTasks },
    { data: projects },
    { data: biasProfiles },
    { data: focusSessions },
    { data: energyLogs },
    { data: energyPatterns },
  ] = await Promise.all([
    db.from('tasks').select('urgency_score, estimated_minutes, adjusted_minutes, project_id').in('status', ['inbox', 'active']),
    db.from('tasks').select('project_id').eq('status', 'done'),
    db.from('projects').select('*').eq('archived', false).order('name'),
    db.from('estimation_profiles').select('*'),
    db.from('focus_sessions').select('estimate_accurate').not('estimate_accurate', 'is', null),
    db.from('energy_logs').select('logged_at, level').gte('logged_at', sevenDaysAgo).order('logged_at'),
    db.from('energy_patterns').select('*'),
  ])

  const active = activeTasks ?? []
  const done   = doneTasks   ?? []
  const projs  = (projects   ?? []) as Project[]

  // Summary
  const totalEst   = active.reduce((s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0)
  const avgUrgency = active.length ? active.reduce((s, t) => s + (t.urgency_score ?? 0), 0) / active.length : 0

  // Urgency buckets  [0-20) [20-40) [40-60) [60-80) [80-100]
  const buckets = [0, 0, 0, 0, 0]
  for (const t of active) {
    const idx = Math.min(Math.floor((t.urgency_score ?? 0) / 20), 4)
    buckets[idx]++
  }

  // Bias map
  const biasMap: Record<string, EstimationProfile> = {}
  for (const b of biasProfiles ?? []) biasMap[b.project_id] = b as EstimationProfile

  // Done count map
  const doneMap: Record<string, number> = {}
  for (const t of done) {
    if (t.project_id) doneMap[t.project_id] = (doneMap[t.project_id] ?? 0) + 1
  }

  // Per-project stats
  const projectStats = projs.map(p => {
    const pTasks = active.filter(t => t.project_id === p.id)
    return {
      project: p,
      activeCount: pTasks.length,
      estimatedMinutes: pTasks.reduce((s, t) => s + (t.adjusted_minutes ?? t.estimated_minutes ?? 0), 0),
      doneCount: doneMap[p.id] ?? 0,
      bias: biasMap[p.id] ?? null,
    }
  }).filter(ps => ps.activeCount > 0 || ps.doneCount > 0)

  // Estimation accuracy from sessions
  const sessions = focusSessions ?? []
  const accurateSessions   = sessions.filter(s => s.estimate_accurate === true).length
  const inaccurateSessions = sessions.filter(s => s.estimate_accurate === false).length

  // Rolling 7-day energy — group by calendar date, compute daily avg
  const dailyMap: Record<string, { sum: number; count: number }> = {}
  for (const log of (energyLogs ?? [])) {
    const date = log.logged_at.slice(0, 10)  // YYYY-MM-DD
    if (!dailyMap[date]) dailyMap[date] = { sum: 0, count: 0 }
    dailyMap[date].sum   += log.level
    dailyMap[date].count += 1
  }
  const recentEnergy: DailyEnergy[] = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({ date, avg: sum / count, count }))

  const data: AnalyticsData = {
    activeCount: active.length,
    doneCount: done.length,
    totalEstMinutes: totalEst,
    avgUrgency,
    urgencyBuckets: buckets,
    projectStats,
    accurateSessions,
    inaccurateSessions,
    recentEnergy,
    energyPatterns: (energyPatterns ?? []) as EnergyPattern[],
  }

  return <AnalyticsView data={data} />
}
