import { createServiceClient } from '@/lib/supabase/server'
import { localDayRange, localDayStr, localMinutesOfDay, DEFAULT_TZ, isValidTimezone } from '@/lib/day'
import { isWeekStartDay, WEEK_START_DEFAULT } from '@/lib/week'
import { fetchTodaysHabits } from '@/lib/habits'
import { sendToAll, type PushMessage } from '@/lib/push'
import {
  awake, composeCalendar, composeHabits, composeMorning, composeWrapUp, inWindow, milestones,
  normalizePrefs, type DoneRow, type HabitState, type NotifyPrefs, type OpenTask,
} from '@/lib/notify'

/**
 * One tick of the notification scheduler: read the day, work out what is due,
 * send each thing once.
 *
 * Called every five minutes by `pg_cron` through `/api/cron/notify`
 * (migration 0024). Vercel's own cron cannot do it: the account is on Hobby,
 * where a cron runs at most once a day.
 *
 * **Once is enforced by `notification_log`, claimed before sending.** Each
 * send has a key — `morning:2026-09-29`, a milestone's title and value — and
 * the insert is what decides who sends, so two overlapping ticks cannot both
 * send. If every device then fails, the claim is released and the next tick
 * inside the window tries again.
 */

export interface Planned { key: string; message: PushMessage }

export interface TickReport {
  now:     string
  local:   string
  planned: Planned[]
  sent:    { key: string; devices: number; failed: number }[]
  skipped: string[]
}

async function loadDay(now: Date) {
  const db = createServiceClient()
  const { data: config } = await db.from('user_scheduling_config').select('*').limit(1).maybeSingle()
  const row = (config ?? {}) as Record<string, unknown>
  const tz = isValidTimezone(row.timezone) ? row.timezone as string : DEFAULT_TZ
  const weekStartDay = isWeekStartDay(row.week_start_day) ? row.week_start_day : WEEK_START_DEFAULT
  const prefs = normalizePrefs(row.notification_prefs)
  const today = localDayStr(now, tz)
  const { startISO, endISO } = localDayRange(today, tz)

  const [{ data: taskRows }, { data: doneRows }, habitsDay, { data: review }, { data: integration }] = await Promise.all([
    db.from('tasks')
      .select('id, title, type, priority, due_date, parent_id, project_id, urgency_score')
      .in('status', ['inbox', 'active']),
    db.from('tasks')
      .select('type, actual_minutes')
      .eq('status', 'done')
      .gte('completed_at', startISO)
      .lt('completed_at', endISO),
    fetchTodaysHabits(db, { tz, today, weekStartDay }),
    db.from('weekly_reviews').select('completed_at').order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('user_integrations').select('last_synced_at').eq('provider', 'google').maybeSingle(),
  ])

  const tasks: OpenTask[] = (taskRows ?? []).map(t => ({
    id: t.id, title: t.title, type: t.type, priority: t.priority,
    dueDay: t.due_date?.slice(0, 10) ?? null,
    parentId: t.parent_id, projectId: t.project_id, urgency: t.urgency_score ?? 0,
  }))
  const done: DoneRow[] = (doneRows ?? []).map(d => ({ type: d.type, minutes: d.actual_minutes }))
  const doneToday = new Set(habitsDay.doneTodayIds)
  const habits: HabitState[] = habitsDay.habits.map(h => ({
    title: h.title, weeklyTarget: h.weekly_target, doneToday: doneToday.has(h.id), summary: habitsDay.summaries[h.id],
  }))

  return {
    db, tz, today, weekStartDay, prefs, tasks, done, habits,
    lastReviewISO: (review?.completed_at as string | undefined) ?? null,
    integration: integration as { last_synced_at: string | null } | null,
  }
}

/** Every message the day would produce, ignoring the clock. For previews. */
export function everything(day: Awaited<ReturnType<typeof loadDay>>, now: Date): Planned[] {
  const { today, weekStartDay, prefs, tasks, habits, done } = day
  const nowISO = now.toISOString()
  const out: Planned[] = []
  const morning = composeMorning({ today, weekStartDay, tasks, habits, lastReviewISO: day.lastReviewISO, nowISO, prefs })
  if (morning) out.push({ key: `morning:${today}`, message: morning })
  const evening = composeHabits({ today, weekStartDay, habits, prefs })
  if (evening) out.push({ key: `habits:${today}`, message: evening })
  if (prefs.on.wrapUp) {
    const wrap = composeWrapUp({ today, done, tasks })
    if (wrap) out.push({ key: `wrapup:${today}`, message: wrap })
  }
  if (prefs.on.milestone) out.push(...milestones(habits, today, weekStartDay))
  if (prefs.on.calendar) {
    const cal = composeCalendar({ connected: !!day.integration, lastSyncedISO: day.integration?.last_synced_at ?? null, nowISO })
    if (cal) out.push({ key: `calendar:${today}`, message: cal })
  }
  return out
}

/** Which of `everything` is due at this minute. */
function dueNow(all: Planned[], nowMin: number, prefs: NotifyPrefs): Planned[] {
  return all.filter(({ key }) => {
    const kind = key.slice(0, key.indexOf(':'))
    if (kind === 'morning')   return inWindow(nowMin, prefs.morningAt)
    if (kind === 'habits')    return inWindow(nowMin, prefs.habitsAt)
    if (kind === 'wrapup')    return inWindow(nowMin, prefs.wrapUpAt)
    if (kind === 'calendar')  return awake(nowMin, prefs)
    return true   // milestones: as they happen
  })
}

export async function previewDay(now = new Date()): Promise<Planned[]> {
  return everything(await loadDay(now), now)
}

export async function runTick(opts: { now?: Date; dryRun?: boolean } = {}): Promise<TickReport> {
  const now = opts.now ?? new Date()
  const day = await loadDay(now)
  const nowMin = localMinutesOfDay(now, day.tz)
  const planned = dueNow(everything(day, now), nowMin, day.prefs)
  const report: TickReport = {
    now: now.toISOString(),
    local: `${day.today} ${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')} ${day.tz}`,
    planned, sent: [], skipped: [],
  }
  if (opts.dryRun || !planned.length) return report

  for (const p of planned) {
    const { data: claimed, error } = await day.db.from('notification_log')
      .upsert({ key: p.key }, { onConflict: 'key', ignoreDuplicates: true })
      .select('key')
    if (error) throw new Error(`notification_log: ${error.message}`)
    if (!claimed?.length) { report.skipped.push(p.key); continue }

    const r = await sendToAll(p.message)
    report.sent.push({ key: p.key, devices: r.sent, failed: r.failed })
    // Every device failed: let the next tick in the window try again.
    if (r.sent === 0 && r.failed > 0) await day.db.from('notification_log').delete().eq('key', p.key)
  }
  return report
}
