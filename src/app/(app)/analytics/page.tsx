/**
 * Insights.
 *
 * Analytics drew three pictures of data too thin to carry one — a 50%
 * accuracy donut from four samples, a histogram whose single finding is now a
 * card, and five energy bars between 2.0 and 3.0. They are gone. What is left
 * is three findings that each name a number, one bar showing how the remaining
 * work is divided, and an honest account of what is not known yet.
 *
 * **No range control.** The design drew `This week / Month / All time` and
 * never decided what they did; with no `daily_capacity` history only one
 * window is honest, so two of the three would lie. It comes back when the
 * history does, and then the range will *recompute* the findings rather than
 * re-scope the same three.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { Project, Task } from '@/types'
import {
  addDays, fetchTimezone, todayStr as todayIn, startOfLocalDay, localDayStr,
} from '@/lib/day'
import { freeGaps, type WorkingHours, type BreakWindow, type Interval } from '@/lib/scheduler'
import { capacityFromGaps, dueMinutesFor } from '@/lib/capacity'
import { buildProjectRows, isActiveTask, taskMinutes } from '@/lib/projects'
import { ESTIMATE_SAMPLES_NEEDED, thinData } from '@/lib/thin-data'
import { capacityFinding, urgencyFinding, concentrationFinding, workloadFinding } from '@/lib/insights'
import InsightsView from './AnalyticsView'

export const dynamic = 'force-dynamic'

/** Gaps shorter than this are not usable time and are not counted as free. */
const MIN_GAP_MINUTES = 15

/** Daily energy logs before a time-of-day pattern is worth reading. */
const ENERGY_DAYS_NEEDED = 21

export default async function InsightsPage() {
  const db = createServiceClient()

  const tz    = await fetchTimezone(db)
  const today = todayIn(tz)
  const startISO = startOfLocalDay(today, tz).toISOString()
  const untilISO = startOfLocalDay(addDays(today, 2), tz).toISOString()
  const weekEndISO = startOfLocalDay(addDays(today, 7), tz).toISOString()

  const [
    { data: whRows },
    { data: breakRows },
    { data: eventRows },
    { data: taskRows },
    { data: projectRows },
    { data: biasRows },
    { data: sessionRows },
    { data: energyRows },
    { data: linkRows },
    { data: weekEventRows },
  ] = await Promise.all([
    db.from('user_working_hours').select('*'),
    db.from('user_daily_breaks').select('*').order('start_hour').then(r => r, () => ({ data: null })),
    db.from('calendar_events').select('*').lt('start_time', untilISO).gt('end_time', startISO),
    /* Every task at every status: progress and the done column need the
       finished ones, exactly as the projects table does. */
    db.from('tasks').select('*'),
    db.from('projects').select('*').eq('archived', false).order('name'),
    db.from('estimation_profiles').select('*'),
    db.from('focus_sessions').select('estimate_accurate').not('estimate_accurate', 'is', null),
    db.from('energy_logs').select('logged_at'),
    db.from('task_event_links').select('task_id, event_id, status')
      .then(r => r, () => ({ data: null })),
    db.from('calendar_events').select('id, start_time').gte('start_time', startISO).lt('start_time', weekEndISO),
  ])

  const workingHours: WorkingHours[] = (whRows ?? []).map(r => ({
    day_of_week: r.day_of_week,
    start_hour: r.start_hour, start_minute: r.start_minute,
    end_hour: r.end_hour, end_minute: r.end_minute,
    enabled: r.enabled,
  }))
  const breaks: BreakWindow[] = (breakRows ?? []).filter(r => r.enabled).map(r => ({
    label: r.label, durationMinutes: r.duration_minutes,
    startHour: r.start_hour, startMinute: r.start_minute,
    endHour: r.end_hour, endMinute: r.end_minute,
    cooldownMinutes: r.cooldown_minutes,
  }))

  const tasks    = (taskRows ?? []) as Task[]
  const projects = (projectRows ?? []) as Project[]
  const links    = (linkRows ?? []) as { task_id: string; event_id: string; status: string }[]
  const confirmed = links.filter(l => l.status === 'confirmed')
  const coveredTaskIds = new Set(confirmed.map(l => l.task_id))

  // ── Today's capacity, by the same arithmetic Home uses ─────────────────────

  const busy: Interval[] = (eventRows ?? [])
    .filter(e => !e.all_day)
    .map(e => [Date.parse(e.start_time), Date.parse(e.end_time)] as Interval)

  const dayGaps = freeGaps({
    dayStr: today, tz, workingHours, busy, breaks, minMinutes: MIN_GAP_MINUTES,
  })

  /**
   * Null rather than zeroes when there is no ratio to report.
   *
   * A day with working hours switched off and a day with no calendar connected
   * both produce `free = 0`, and "today holds 10h of work and 0h of time" is
   * not a finding about your workload — it is a finding about your settings.
   */
  const capacity = dayGaps.reason === 'dayOff' ? null : capacityFromGaps({
    gaps: dayGaps.gaps, dayStr: today, tz,
    dueMinutes: dueMinutesFor(
      tasks.filter(isActiveTask).map(t => ({
        id: t.id,
        dueDay: t.due_date ? t.due_date.slice(0, 10) : null,
        minutes: taskMinutes(t) || null,
      })),
      today, coveredTaskIds),
  })

  const dueToday = tasks.filter(t =>
    isActiveTask(t) && t.due_date && t.due_date.slice(0, 10) <= today && !coveredTaskIds.has(t.id))

  /**
   * How many of today's due tasks fit before the late cutoff, largest-first.
   *
   * Largest-first rather than by urgency: the claim is about how much of the
   * day's work the day can physically hold, and the greedy answer to that is
   * the packing one.
   */
  const fitCount = (() => {
    if (!capacity) return 0
    let left = capacity.freeBeforeCutoff
    let n = 0
    for (const m of dueToday.map(taskMinutes).filter(m => m > 0).sort((a, b) => b - a)) {
      if (m <= left) { left -= m; n++ }
    }
    return n
  })()

  // ── The three findings ─────────────────────────────────────────────────────

  const rows = buildProjectRows({ projects, tasks, todayStr: today })

  const largest = rows.filter(r => !r.isInbox)
    .reduce<typeof rows[number] | null>(
      (best, r) => !best || r.minutesLeft > best.minutesLeft ? r : best, null)

  /* Tasks in the largest project with a confirmed calendar slot in the coming
     week — the clause the concentration card ends on. */
  const weekEventIds = new Set((weekEventRows ?? []).map(e => e.id))
  const largestTaskIds = new Set(
    tasks.filter(t => isActiveTask(t) && t.project_id === largest?.id).map(t => t.id))
  const scheduledCount = new Set(
    confirmed.filter(l => largestTaskIds.has(l.task_id) && weekEventIds.has(l.event_id))
      .map(l => l.task_id),
  ).size

  const findings = [
    capacityFinding({ capacity, dueCount: dueToday.length, fitCount }),
    urgencyFinding(tasks.filter(isActiveTask).map(t => t.urgency_score)),
    concentrationFinding({ rows, scheduledCount }),
  ].filter(f => f !== null)

  // ── What is not known yet ──────────────────────────────────────────────────

  const sessions = sessionRows ?? []
  const withBias = (biasRows ?? []).filter(b => b.sample_count >= ESTIMATE_SAMPLES_NEEDED)
  const energyDays = new Set((energyRows ?? []).map(r => localDayStr(r.logged_at, tz))).size

  const panels = [
    {
      label: 'Estimate accuracy',
      data: thinData({
        have: sessions.length, need: 12, unit: ['reflection', 'reflections'],
        unlocks: n => `Reflect on ${n} more finished task${n === 1 ? '' : 's'} and this becomes a reliable multiplier.`,
        readyText: 'Planner is correcting your estimates from your own finished work.',
      }),
    },
    {
      label: 'Per-project bias',
      data: thinData({
        have: withBias.length, need: Math.max(1, projects.length),
        unit: ['project', 'projects'],
        unlocks: () => withBias.length === 0
          ? `No project has ${ESTIMATE_SAMPLES_NEEDED} finished tasks with a reflection yet.`
          : `${withBias.length === 1 ? 'Only one project has' : `${withBias.length} projects have`} enough samples. `
            + `${projects.length - withBias.length} do not.`,
        readyText: 'Every project has enough history to correct its own estimates.',
      }),
    },
    {
      label: 'Energy and output',
      data: thinData({
        have: energyDays, need: ENERGY_DAYS_NEEDED, unit: ['day', 'days'],
        unlocks: n => `${n} more day${n === 1 ? '' : 's'} of energy logs before a time-of-day pattern is worth reading.`,
        readyText: 'There is enough history to read a time-of-day pattern.',
      }),
    },
  ]

  const doneAllTime = tasks.filter(t => t.status === 'done' && t.parent_id === null).length

  return (
    <InsightsView
      findings={findings}
      rows={rows}
      workload={workloadFinding(rows)}
      totalMinutes={rows.reduce((n, r) => n + r.minutesLeft, 0)}
      activeCount={rows.reduce((n, r) => n + r.activeCount, 0)}
      doneAllTime={doneAllTime}
      panels={panels}
    />
  )
}
