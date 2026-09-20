/**
 * Home — the landing page, and the answer to "what should I do now?".
 *
 * All the I/O for `src/lib/home.ts`, which does the thinking. Two constraints
 * from `docs/HOME.md` shape this file:
 *
 *   - **No Google round trip.** Everything here is already local: the calendar
 *     is synced into `calendar_events`, the tasks and habits are ours, and the
 *     working hours are config. The freeBusy call is what made "Schedule my
 *     week" unpleasant, and it must not sit on the landing path. The cost is
 *     staleness, which the page says out loud rather than blocking on.
 *   - **A subtask's importance is its parent's.** Resolved here once, at the
 *     edge, the same way `proposeSchedule` resolves it on every run.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { addDays, fetchTimezone, todayStr as todayIn, localDayRange, startOfLocalDay } from '@/lib/day'
import { fetchWeekStartDay } from '@/lib/week'
import { fetchTodaysHabits } from '@/lib/habits'
import {
  freeGaps, localMidnight, workWindowFor,
  type BreakWindow, type EnergyScheduleEntry, type Interval,
  type TimeBlockId, type WorkingHours,
} from '@/lib/scheduler'
import {
  buildHome, dayReason, describeAge, freeTimeBasis, isCandidate, resolveAgainstParent,
  MIN_GAP_MINUTES, type HomeEvent, type HomeTask,
} from '@/lib/home'
import { capacityFromGaps, dueMinutesFor } from '@/lib/capacity'
import type { BandInput } from '@/lib/band'
import { dayOfWeek } from '@/lib/day'
import { Task, Project, INBOX_PROJECT } from '@/types'
import HomeView from './HomeView'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const db = createServiceClient()
  const tz = await fetchTimezone(db)
  const today = todayIn(tz)
  const { startISO, endISO } = localDayRange(today, tz)

  /**
   * How far past today the event query has to reach.
   *
   * A working day is not a calendar day. "10:00 to 01:30" ends ninety minutes
   * into tomorrow, and an event at 00:15 sits squarely inside it — but bounding
   * the query at local midnight never fetched one, so `freeGaps` had nothing to
   * subtract and Home offered a booked stretch as free. Ten events on this
   * calendar between 2026-09-01 and 09-20 started between midnight and 2am.
   *
   * Forty-eight hours rather than the window itself, because the window is not
   * known until `user_working_hours` has been read, and making the event query
   * wait on that turns one round trip into two on the landing path. A window
   * can start at 23:59 and run a full day, so it can end at most 47h59m after
   * local midnight; 48 hours covers every case. The surplus is filtered out
   * below rather than passed to the arithmetic.
   */
  const fetchUntilISO = startOfLocalDay(addDays(today, 2), tz).toISOString()

  const [
    { data: whRows },
    { data: esRows },
    { data: configRow },
    { data: breakRows },
    { data: eventRows },
    { data: taskRows },
    { data: projectRows },
    { data: integration },
    { data: confirmedLinks },
  ] = await Promise.all([
    db.from('user_working_hours').select('*'),
    db.from('user_energy_schedule').select('*'),
    db.from('user_scheduling_config').select('*').limit(1).maybeSingle(),
    // Missing table (pre-0008) resolves to null rather than throwing, exactly
    // as it does for the scheduler — the day is then simply drawn without meals.
    db.from('user_daily_breaks').select('*').order('start_hour').then(r => r, () => ({ data: null })),
    db.from('calendar_events')
      .select('*')
      .lt('start_time', fetchUntilISO)
      .gt('end_time', startISO)
      .order('start_time'),
    db.from('tasks')
      .select('*, project:projects(id, name, color), parent:parent_id(id, title)')
      .in('status', ['inbox', 'active'])
      .order('urgency_score', { ascending: false }),
    db.from('projects').select('*').eq('archived', false).order('name'),
    // select('*') so a pre-0018 database still returns the row; last_synced_at
    // is then undefined, which reads as "unknown" rather than "never".
    db.from('user_integrations').select('*').eq('provider', 'google').maybeSingle(),
    // Confirmed only. A title-similarity guess never moves a number — see
    // `suggestTaskEventLinks`. Missing table (pre-0019) resolves to null.
    db.from('task_event_links').select('task_id').eq('status', 'confirmed')
      .then(r => r, () => ({ data: null })),
  ])

  const workingHours: WorkingHours[] = (whRows ?? []).map(r => ({
    day_of_week: r.day_of_week,
    start_hour: r.start_hour, start_minute: r.start_minute,
    end_hour: r.end_hour, end_minute: r.end_minute,
    enabled: r.enabled,
  }))

  const energySchedule: EnergyScheduleEntry[] = (esRows ?? []).map(r => ({
    day_of_week:  r.day_of_week,
    time_block:   r.time_block as TimeBlockId,
    energy_level: r.energy_level as 'low' | 'medium' | 'high',
  }))

  const breaks: BreakWindow[] = (breakRows ?? []).filter(r => r.enabled).map(r => ({
    label: r.label, durationMinutes: r.duration_minutes,
    startHour: r.start_hour, startMinute: r.start_minute,
    endHour: r.end_hour, endMinute: r.end_minute,
    cooldownMinutes: r.cooldown_minutes,
  }))

  const bufferMinutes = configRow?.buffer_minutes ?? 15

  const rows = (taskRows ?? []) as (Task & { project: Project | null; parent?: { id: string; title: string } | null })[]

  // ── What is on the day ──────────────────────────────────────────────────────
  //
  // All-day events are held out of the busy set. Google marks them free, and
  // treating "Chengyi's birthday" as a fourteen-hour block would leave the day
  // with no gaps at all. They get their own line instead.
  /**
   * The stretch this page is about: today, extended to wherever the working
   * window actually ends.
   *
   * Events before the window opens still belong to the day and still show — an
   * 8am meeting is part of today even when work starts at ten. What this adds
   * is the other end: the hours after midnight that the window covers.
   */
  const dayStartMs = Date.parse(startISO)
  const workWindow = workWindowFor(localMidnight(today, tz), workingHours, tz)
  const horizonMs  = Math.max(Date.parse(endISO), workWindow?.[1] ?? 0)

  const overlapsHorizon = (startMs: number, endMs: number) =>
    startMs < horizonMs && endMs > dayStartMs

  const allEvents = (eventRows ?? []).filter(e =>
    overlapsHorizon(Date.parse(e.start_time), Date.parse(e.end_time))
  )
  const allDay = allEvents.filter(e => e.all_day).map(e => ({ id: e.id as string, title: e.title as string }))

  const timedEvents: HomeEvent[] = allEvents
    .filter(e => !e.all_day)
    .map(e => ({
      id: e.id as string, title: e.title as string,
      startMs: Date.parse(e.start_time), endMs: Date.parse(e.end_time),
    }))

  // A focus block already booked is as real as a meeting: it takes the time,
  // and the work in it should not be offered again in the gap beside it.
  const bookedBlocks: HomeEvent[] = rows
    .filter(t => t.scheduled_start && t.scheduled_end
              && overlapsHorizon(Date.parse(t.scheduled_start), Date.parse(t.scheduled_end)))
    .map(t => ({
      id: `task:${t.id}`, title: t.title, taskId: t.id,
      startMs: Date.parse(t.scheduled_start!), endMs: Date.parse(t.scheduled_end!),
    }))

  const events = [...timedEvents, ...bookedBlocks]
  const busy: Interval[] = events.map(e => [e.startMs, e.endMs])

  const lastSyncedISO = (integration as { last_synced_at?: string } | null)?.last_synced_at ?? null

  // Whether the gaps below are observed or assumed. `timedEvents` rather than
  // every row: an all-day event is held out of the busy set, so it is no
  // evidence that the day's hours are known.
  const basis = freeTimeBasis({
    calendarConnected: !!integration,
    lastSyncedISO,
    eventCount: timedEvents.length,
  })

  const dayGaps = freeGaps({
    dayStr: today, tz, workingHours, busy, breaks, minMinutes: MIN_GAP_MINUTES,
  })
  const gaps = dayGaps.gaps

  // ── Tasks, resolved ─────────────────────────────────────────────────────────
  const toHomeTask = (t: typeof rows[number], chainIndex: number): HomeTask => ({
    id:             t.id,
    title:          t.title,
    parentId:       t.parent_id,
    parentTitle:    t.parent?.title ?? null,
    type:           t.type,
    priority:       t.priority,
    urgencyScore:   t.urgency_score,
    energyRequired: t.energy_required,
    minutes:        t.adjusted_minutes ?? t.estimated_minutes,
    dueDay:         t.due_date?.slice(0, 10) ?? null,
    startDay:       t.start_date?.slice(0, 10) ?? null,
    location:       t.location ?? 'anywhere',
    bufferMinutes:  t.buffer_minutes,
    scheduledStartISO: t.scheduled_start,
    chainIndex,
  })

  const byId = new Map(rows.map(t => [t.id, t]))
  const parentsWithOpenSubtasks = new Set(rows.filter(t => t.parent_id).map(t => t.parent_id!))

  /**
   * Position within a chain, from creation order — you cannot fold the sheets
   * before they have been in the dryer, and `rows` arrives sorted by urgency,
   * which for subtasks (all created at urgency 0) is no order at all. This is
   * the same `order('created_at')` the scheduler applies for the same reason.
   */
  const chainIndexOf = new Map<string, number>()
  for (const [parentId] of new Map(rows.filter(t => t.parent_id).map(t => [t.parent_id!, true]))) {
    rows
      .filter(t => t.parent_id === parentId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((t, i) => chainIndexOf.set(t.id, i))
  }

  const tasks: HomeTask[] = rows
    // A parent with open subtasks is the same work described twice — the
    // scheduler replaces it with its children, and so does Home.
    .filter(t => !parentsWithOpenSubtasks.has(t.id))
    .map(t => {
      const own = toHomeTask(t, chainIndexOf.get(t.id) ?? 0)
      const parentRow = t.parent_id ? byId.get(t.parent_id) : null
      return parentRow ? resolveAgainstParent(own, toHomeTask(parentRow, 0)) : own
    })

  const data = buildHome({
    // A force-dynamic Server Component renders once per request, so reading the
    // clock here is a property of the request, not an unstable render. The
    // purity rule is written for components that re-render on their own; this
    // one cannot. HomeView re-fetches when the tab comes back, which is what
    // keeps "1h 30m free" from being an hour old.
    // eslint-disable-next-line react-hooks/purity
    nowMs: Date.now(), todayStr: today, tz,
    gaps, workWindow, events, tasks, energySchedule, bufferMinutes,
    reason: dayReason(basis, dayGaps),
  })

  // ── The band ────────────────────────────────────────────────────────────────
  //
  // Everything the headline needs that capacity alone cannot say. `fragmented`
  // is the reason `smallestTaskMinutes` is here: a day of 45-minute holes is
  // only a failure relative to what is left to place, so the gaps cannot tell
  // you on their own.
  const coveredTaskIds = new Set<string>(
    ((confirmedLinks ?? []) as { task_id: string }[]).map(l => l.task_id),
  )

  const dueToday  = tasks.filter(t => t.dueDay != null && t.dueDay <= today && !coveredTaskIds.has(t.id))
  const unplaced  = tasks.filter(t => isCandidate(t, today) && !coveredTaskIds.has(t.id))
  const smallest  = unplaced.reduce<number | null>(
    (m, t) => (t.minutes == null ? m : m == null ? t.minutes : Math.min(m, t.minutes)), null)

  const capacity = capacityFromGaps({
    gaps, dayStr: today, tz,
    dueMinutes: dueMinutesFor(tasks, today, coveredTaskIds),
  })

  /**
   * The next day whose working hours are switched on, within a week.
   *
   * Named rather than counted, because "Move it all to Monday" has to be a day
   * you recognise. Its free time is only reported when it falls inside the
   * events already fetched; beyond that the clause is dropped rather than
   * guessed, and `bandCopy` handles the null.
   */
  const nextWorking = (() => {
    for (let i = 1; i <= 7; i++) {
      const day = addDays(today, i)
      const wh = workingHours.find(w => w.day_of_week === dayOfWeek(day))
      if (!wh?.enabled) continue
      const label = new Date(day + 'T12:00:00Z')
        .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
      if (i > 1) return { label, free: null }
      const win = workWindowFor(localMidnight(day, tz), workingHours, tz)
      const r = freeGaps({ dayStr: day, tz, workingHours, busy, breaks, minMinutes: MIN_GAP_MINUTES })
      return {
        label,
        free: win ? r.gaps.reduce((m, [gS, gE]) => m + (gE - gS) / 60_000, 0) : null,
      }
    }
    return null
  })()

  /** The next thing due after today, for the nothing-due line. */
  const nextDue = tasks
    .filter(t => t.dueDay != null && t.dueDay > today && t.minutes != null)
    .sort((a, b) => a.dueDay!.localeCompare(b.dueDay!))[0]

  const band: BandInput = {
    reason: dayReason(basis, dayGaps),
    capacity,
    gaps,
    dueCount: dueToday.length,
    smallestTaskMinutes: smallest,
    nextWorkingDay: nextWorking?.label ?? null,
    nextWorkingDayFree: nextWorking?.free ?? null,
    start: data.suggestions[0] && data.rightNow.gap
      ? {
          title: data.suggestions[0].title,
          gapMinutes: data.rightNow.gap.minutes,
          beforeTitle: data.rightNow.nextEvent?.title ?? null,
        }
      : null,
    nextDue: nextDue
      ? {
          title: nextDue.title,
          when: nextDue.dueDay === addDays(today, 1)
            ? 'tomorrow'
            : `on ${new Date(nextDue.dueDay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`,
          minutes: nextDue.minutes!,
        }
      : null,
  }

  // ── Habits ──────────────────────────────────────────────────────────────────
  //
  // Not filtered out of `rows`: a habit is a family of rows, not a row, so
  // "today's habits" and "how far through the week" are both questions about
  // titles rather than ids. `fetchTodaysHabits` is the one place that knows
  // that — Home read `habit_streaks.completions_this_week` directly at first,
  // which is keyed by an id that a completion replaces, and showed Piano at 0/7
  // in a week it had been played six times.
  //
  // One week of completions is all this needs; /habits asks the same function
  // for sixteen because it also draws a calendar from them.
  const weekStartDay = await fetchWeekStartDay(db)
  const { habits, doneTodayIds, streaks } = await fetchTodaysHabits(db, {
    tz, today, weekStartDay,
    completionsSinceISO: startOfLocalDay(addDays(today, -14), tz).toISOString(),
  })

  const gcalWriteEnabled = ((integration?.scopes ?? []) as string[]).includes(
    'https://www.googleapis.com/auth/calendar.events'
  )


  // Measured here, not in the view: a duration read during render is read once
  // on the server and again when the browser hydrates, and the two answers
  // straddle a boundary often enough to throw the tree away. Same reason the
  // clock read above is a property of the request rather than of a render.
  // eslint-disable-next-line react-hooks/purity
  const syncAge = describeAge(lastSyncedISO, Date.now())


  return (
    <HomeView
      data={data}
      dayStr={today}
      tz={tz}
      allDayEvents={allDay}
      tasks={rows.map(t => ({ ...t, project: t.project ?? INBOX_PROJECT }))}
      habits={habits}
      habitsDoneToday={doneTodayIds}
      streaks={streaks}
      projects={(projectRows ?? []) as Project[]}
      gcalWriteEnabled={gcalWriteEnabled}
      calendarConnected={!!integration}
      syncAge={syncAge}
      band={band}
      freeTime={basis}
    />
  )
}
