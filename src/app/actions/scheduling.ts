'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getValidToken, createTaskBlock, updateTaskBlock, deleteTaskBlock, listAutoScheduledEventIds } from '@/lib/google-calendar'
import {
  runScheduler,
  buildAttackList,
  localMidnight,
  type WorkingHours,
  type EnergyScheduleEntry,
  type TimeBlockId,
  type SchedulerConfig,
  type SchedulerTask,
  type BreakWindow,
  type ProposedBlock,
  type AttackItem,
} from '@/lib/scheduler'
import { weekStartOf, fetchWeekStartDay, isWeekStartDay } from '@/lib/week'

// ── GCal freeBusy ─────────────────────────────────────────────────────────────

async function fetchFreeBusy(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<Array<[number, number]>> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin:  timeMin.toISOString(),
      timeMax:  timeMax.toISOString(),
      items:    [{ id: 'primary' }],
    }),
  })
  if (!res.ok) {
    console.error('freeBusy error', res.status, await res.text())
    return []
  }
  const data = await res.json()
  const busy: Array<{ start: string; end: string }> = data?.calendars?.primary?.busy ?? []
  return busy.map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()])
}

// ── Shared data fetching ──────────────────────────────────────────────────────

async function fetchSchedulingInputs() {
  const db = createServiceClient()

  const [
    { data: whRows },
    { data: esRows },
    { data: configRow },
    { data: breakRows },
  ] = await Promise.all([
    db.from('user_working_hours').select('*'),
    db.from('user_energy_schedule').select('*'),
    db.from('user_scheduling_config').select('*').limit(1).single(),
    // Missing table (pre-0008) resolves to null rather than throwing, so the
    // scheduler just runs without breaks.
    db.from('user_daily_breaks').select('*').order('start_hour').then(
      r => r,
      () => ({ data: null }),
    ),
  ])

  const workingHours: WorkingHours[] = (whRows ?? []).map(r => ({
    day_of_week:  r.day_of_week,
    start_hour:   r.start_hour,
    start_minute: r.start_minute,
    end_hour:     r.end_hour,
    end_minute:   r.end_minute,
    enabled:      r.enabled,
  }))

  const energySchedule: EnergyScheduleEntry[] = (esRows ?? []).map(r => ({
    day_of_week:  r.day_of_week,
    time_block:   r.time_block as TimeBlockId,
    energy_level: r.energy_level as 'low' | 'medium' | 'high',
  }))

  const breaks: BreakWindow[] = (breakRows ?? [])
    .filter(r => r.enabled)
    .map(r => ({
      label:           r.label,
      durationMinutes: r.duration_minutes,
      startHour:       r.start_hour,
      startMinute:     r.start_minute,
      endHour:         r.end_hour,
      endMinute:       r.end_minute,
      cooldownMinutes: r.cooldown_minutes,
    }))

  const schedulerConfig: SchedulerConfig = {
    maxSessionMinutes: configRow?.max_session_minutes ?? 90,
    bufferMinutes:     configRow?.buffer_minutes ?? 15,
    timezone:          'UTC',  // overridden per-call via { ...schedulerConfig, timezone }
    breaks,
  }

  return { workingHours, energySchedule, schedulerConfig }
}

// ── Serialized output types (Date → ISO string for safe Server Action transport) ─

export interface SerializedBlock {
  taskId:        string
  taskTitle:     string
  taskPriority:  number
  startISO:      string
  endISO:        string
  segmentIndex:  number
  totalSegments: number
  energyMatch:   boolean
}

export interface SerializedAttackItem {
  taskId:            string
  taskTitle:         string
  priority:          number
  urgencyScore:      number
  durationMinutes:   number | null
  energyRequired:    string
  scheduledStartISO: string | null
  isScheduled:       boolean
  energyMatchNow:    boolean
  rank:              number
}

// ── Habit sessions ────────────────────────────────────────────────────────────

/**
 * Expand each habit with a weekly target into one candidate per session still
 * owed this week (target minus sessions already completed). Sessions share a
 * spreadGroup so they land on separate days.
 *
 * Habits carry urgency_score 0 in the DB — they aren't deadline work — so for
 * scheduling they're given the same baseline an undated task of that priority
 * would get (priority × 10). Without it they'd sort dead last and only ever get
 * scheduled in leftover space.
 */
async function buildHabitCandidates(
  db: ReturnType<typeof createServiceClient>
): Promise<SchedulerTask[]> {
  const { data: habits } = await db
    .from('tasks')
    .select('*')          // '*' so a pre-0007 database (no exclusive_group) still works
    .eq('type', 'habit')
    .in('status', ['inbox', 'active'])
    .is('parent_id', null)
    .not('weekly_target', 'is', null)
    .or('scheduled_by.is.null,scheduled_by.eq.auto')

  if (!habits || habits.length === 0) return []

  const weekStart = weekStartOf(new Date(), await fetchWeekStartDay(db))

  // Last day of the current week. Sessions are owed *this* week, so they must
  // not spill past it — "Schedule week" runs a rolling 7 days from today, which
  // straddles the week boundary whenever today isn't the first day.
  const weekEndDate = new Date(`${weekStart}T00:00:00Z`)
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
  const weekEnd = weekEndDate.toISOString()

  // Progress is counted from the completions themselves, as DISTINCT DAYS per
  // habit title. Two sessions on one day count once — a weekly target means
  // that many days, not that many completions.
  //
  // Not read from habit_streaks.completions_this_week: that table is keyed by
  // task_id, but every occurrence is a new row with a new id, so the counter
  // for the current pending row is always 0 and the target would never shrink.
  // Title is the habit's real identity here, as it is for the streak calendar.
  const { data: doneRows } = await db
    .from('tasks')
    .select('title, completed_at')
    .eq('type', 'habit')
    .eq('status', 'done')
    .gte('completed_at', `${weekStart}T00:00:00Z`)
    .not('completed_at', 'is', null)

  const daysByTitle = new Map<string, Set<string>>()
  for (const r of doneRows ?? []) {
    if (!r.completed_at) continue
    const set = daysByTitle.get(r.title) ?? new Set<string>()
    set.add(r.completed_at.slice(0, 10))
    daysByTitle.set(r.title, set)
  }

  // One list per habit, interleaved below
  const perHabit: SchedulerTask[][] = []

  for (const h of habits) {
    const duration = h.adjusted_minutes ?? h.estimated_minutes
    if (!duration) continue          // no session length set — can't schedule it

    const done = daysByTitle.get(h.title)?.size ?? 0
    const owed = Math.max(0, (h.weekly_target ?? 0) - done)
    const sessions: SchedulerTask[] = []

    for (let i = 0; i < owed; i++) {
      sessions.push({
        id:               h.id,
        title:            h.title,
        priority:         h.priority,
        urgency_score:    h.priority * 10,
        energy_required:  h.energy_required,
        duration_minutes: duration,
        // Not the habit row's own due_date (a next-occurrence marker that would
        // pin every session to one day) — the end of the week the sessions are
        // owed for, which the scheduler already honours as a deadline.
        due_date:         weekEnd,
        // Habits in a shared exclusive group (e.g. Gym + Run as 'Exercise')
        // never land on the same day. Falling back to the title keys the group
        // per habit, which still keeps that habit's own sessions apart — and by
        // title rather than row id, so two pending rows of one habit can't
        // share a day either.
        spreadGroup:      h.exclusive_group
          ? `group:${h.exclusive_group}`
          : `habit:${h.title}`,
        avoidAfterBreaks: !!h.avoid_after_breaks,
        // A session is one unbroken block. Without this a 120-minute session
        // against a 90-minute cap is split into two, so "2× a week" quietly
        // becomes four scheduled blocks on four days.
        atomic:           true,
      })
    }

    perHabit.push(sessions)
  }

  // Round-robin rather than habit-by-habit. runScheduler's sort is stable, so
  // habits on equal footing keep this order and grouped ones alternate
  // (Gym, Run, Gym, Run) instead of running in blocks (Gym, Gym, Run, Run).
  // A genuinely higher-priority habit still sorts ahead of the rotation.
  const out: SchedulerTask[] = []
  const longest = Math.max(0, ...perHabit.map(l => l.length))
  for (let i = 0; i < longest; i++) {
    for (const sessions of perHabit) {
      if (sessions[i]) out.push(sessions[i])
    }
  }

  return out
}

// ── proposeSchedule ───────────────────────────────────────────────────────────

export interface ProposeResult {
  scheduled:     SerializedBlock[]
  unschedulable: SchedulerTask[]
  error?:        string
}

/**
 * Run the scheduling algorithm and return proposed blocks WITHOUT committing
 * anything. The UI shows these to the user for preview before they confirm.
 *
 * @param horizonDays  7 = "schedule my week", 1 = "plan my day"
 */
export async function proposeSchedule(horizonDays: number, timezone: string = 'UTC', startDateStr?: string): Promise<ProposeResult> {
  const db = createServiceClient()

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const token = await getValidToken()
  if (!token) return { scheduled: [], unschedulable: [], error: 'Google Calendar not connected' }

  // ── 2. User config ─────────────────────────────────────────────────────────
  const { workingHours, energySchedule, schedulerConfig } = await fetchSchedulingInputs()

  // ── 3. Candidate tasks ─────────────────────────────────────────────────────
  // Include: active tasks (not yet scheduled or auto-scheduled, not manually locked)
  // If a task has subtasks, include the subtasks instead of the parent.
  const { data: taskRows } = await db
    .from('tasks')
    .select('id, title, priority, urgency_score, energy_required, estimated_minutes, adjusted_minutes, due_date, parent_id, scheduled_by')
    .in('status', ['inbox', 'active'])
    .is('parent_id', null)              // top-level tasks only here
    .neq('type', 'habit')               // habits are expanded per weekly target below
    .or('scheduled_by.is.null,scheduled_by.eq.auto')  // exclude manual locks; neq would drop NULLs
    .order('urgency_score', { ascending: false })

  // Fetch subtasks for tasks that have them
  const parentIds = (taskRows ?? []).map(t => t.id)
  const { data: subtaskRows } = parentIds.length > 0
    ? await db
        .from('tasks')
        .select('id, title, priority, urgency_score, energy_required, estimated_minutes, adjusted_minutes, due_date, parent_id, scheduled_by')
        .in('parent_id', parentIds)
        .in('status', ['inbox', 'active'])
        .or('scheduled_by.is.null,scheduled_by.eq.auto')
    : { data: [] }

  // Build candidate list: if a parent has subtasks, replace it with its subtasks
  const parentIdsWithSubs = new Set((subtaskRows ?? []).map(s => s.parent_id))

  const candidates: SchedulerTask[] = []

  for (const t of taskRows ?? []) {
    if (parentIdsWithSubs.has(t.id)) continue  // replaced by subtasks below
    const duration = t.adjusted_minutes ?? t.estimated_minutes
    if (!duration) continue  // no estimate — can't schedule
    candidates.push({
      id:               t.id,
      title:            t.title,
      priority:         t.priority,
      urgency_score:    t.urgency_score,
      energy_required:  t.energy_required,
      duration_minutes: duration,
      due_date:         t.due_date,
    })
  }

  for (const s of subtaskRows ?? []) {
    const duration = s.adjusted_minutes ?? s.estimated_minutes
    if (!duration) continue
    candidates.push({
      id:               s.id,
      title:            s.title,
      priority:         s.priority,
      urgency_score:    s.urgency_score,
      energy_required:  s.energy_required,
      duration_minutes: duration,
      due_date:         s.due_date,
    })
  }

  // ── 3b. Habit sessions ─────────────────────────────────────────────────────
  // A habit with a weekly target and a session length becomes N candidates —
  // one per session still owed this week. They share a spreadGroup so the
  // scheduler puts them on different days, and carry no due_date so they can
  // land anywhere in the horizon (the habit row's own due_date is just the
  // next occurrence marker and would otherwise pin every session to one day).
  const habitCandidates = await buildHabitCandidates(db)
  candidates.push(...habitCandidates)

  // ── 4. Busy intervals from GCal ────────────────────────────────────────────
  const now      = new Date()
  const dayStr   = startDateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  // Use local midnight so UTC+ users don't miss morning busy events
  const timeMin  = new Date(localMidnight(dayStr, timezone))
  const timeMax  = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + horizonDays + 1)

  const busyIntervals = await fetchFreeBusy(token.access_token, timeMin, timeMax)

  // ── 5. Run algorithm ───────────────────────────────────────────────────────
  const { scheduled, unschedulable } = runScheduler(
    candidates,
    workingHours,
    energySchedule,
    busyIntervals,
    horizonDays,
    { ...schedulerConfig, timezone, startDateStr: dayStr },
  )

  const serialized: SerializedBlock[] = scheduled.map(b => ({
    taskId:        b.taskId,
    taskTitle:     b.taskTitle,
    taskPriority:  b.taskPriority,
    startISO:      b.start.toISOString(),
    endISO:        b.end.toISOString(),
    segmentIndex:  b.segmentIndex,
    totalSegments: b.totalSegments,
    energyMatch:   b.energyMatch,
  }))

  return { scheduled: serialized, unschedulable }
}

// ── confirmSchedule ───────────────────────────────────────────────────────────

export interface ConfirmResult {
  confirmed: number
  failed:    number
  error?:    string
}

/**
 * Commit proposed blocks:
 * 1. Clear all auto-scheduled tasks (delete GCal events + wipe DB fields)
 * 2. Create new GCal events + update task rows for each proposed block
 */
export async function confirmSchedule(
  blocks: Array<{
    taskId:    string
    startISO:  string
    endISO:    string
  }>
): Promise<ConfirmResult> {
  const db    = createServiceClient()
  const token = await getValidToken()
  if (!token) return { confirmed: 0, failed: 0, error: 'Google Calendar not connected' }

  // ── 1. Snapshot existing auto-scheduled events BEFORE touching anything ────
  // Listed from GCal by tag, not from task rows: a task holds one
  // gcal_event_id but may own several blocks (segmented tasks, habit sessions),
  // so the column alone would leave the extra events behind on every re-run.
  // Snapshotting first also means these are, by definition, all old — the
  // events created below are not in this set, so we can create first and delete
  // after without a partial GCal failure wiping the existing calendar.
  //
  // Window starts at now: past blocks are history and stay put. It extends past
  // the last new block so stale future blocks from a longer previous schedule
  // are still swept up.
  const nowISO = new Date().toISOString()
  const lastEnd = blocks.reduce(
    (max, b) => (b.endISO > max ? b.endISO : max),
    nowISO,
  )
  const sweepEnd = new Date(new Date(lastEnd).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

  let staleEventIds: string[] = []
  try {
    staleEventIds = await listAutoScheduledEventIds(token.access_token, nowISO, sweepEnd)
  } catch (err) {
    // A failed sweep must not block scheduling — worst case some old blocks
    // linger, which is what the previous behaviour did anyway.
    console.error('Failed to list existing auto-scheduled events', err)
  }

  // ── 2. Fetch task info for the proposed blocks ────────────────────────────
  const taskIds = [...new Set(blocks.map(b => b.taskId))]
  const { data: taskRows } = await db
    .from('tasks')
    .select('id, title, description, priority')
    .in('id', taskIds)

  const taskMap = new Map((taskRows ?? []).map(t => [t.id, t]))

  // ── 3. Create new GCal events + update DB ────────────────────────────────
  let confirmed = 0
  let failed    = 0

  // A task with several blocks can only record one on its row; keep the
  // earliest so "next scheduled block" reads correctly in the UI. Cleanup no
  // longer depends on this value.
  const rowWrites = new Map<string, { startISO: string; endISO: string; eventId: string }>()

  for (const block of blocks) {
    const task = taskMap.get(block.taskId)
    if (!task) { failed++; continue }

    try {
      const gcalEventId = await createTaskBlock(
        token.access_token,
        { id: task.id, title: task.title, description: task.description, priority: task.priority },
        block.startISO,
        block.endISO,
        true,   // auto-scheduled — tagged so the next run can clear it
      )
      const existing = rowWrites.get(block.taskId)
      if (!existing || block.startISO < existing.startISO) {
        rowWrites.set(block.taskId, {
          startISO: block.startISO, endISO: block.endISO, eventId: gcalEventId,
        })
      }
      confirmed++
    } catch (err) {
      console.error('Failed to schedule block', block.taskId, err)
      failed++
    }
  }

  for (const [taskId, w] of rowWrites) {
    await db.from('tasks').update({
      gcal_event_id:   w.eventId,
      scheduled_start: w.startISO,
      scheduled_end:   w.endISO,
      scheduled_by:    'auto',
    }).eq('id', taskId)
  }

  // ── 4. Delete the previous auto-schedule ──────────────────────────────────
  // Only once the new events exist. Skipped when creates were attempted and all
  // of them failed, so a total GCal outage leaves the old schedule intact — but
  // an empty proposal is a deliberate "clear everything" and still sweeps.
  if (staleEventIds.length > 0 && (confirmed > 0 || blocks.length === 0)) {
    await Promise.allSettled(
      staleEventIds.map(id => deleteTaskBlock(token.access_token, id).catch(() => {}))
    )
  }

  // Clear DB fields for tasks that were auto-scheduled before but aren't now
  const stillScheduled = [...rowWrites.keys()]
  const clearQuery = db
    .from('tasks')
    .update({ gcal_event_id: null, scheduled_start: null, scheduled_end: null, scheduled_by: null })
    .eq('scheduled_by', 'auto')
  await (stillScheduled.length > 0
    ? clearQuery.not('id', 'in', `(${stillScheduled.join(',')})`)
    : clearQuery)

  revalidatePath('/tasks')
  revalidatePath('/projects')
  return { confirmed, failed }
}

// ── markScheduleManual ────────────────────────────────────────────────────────

/**
 * Mark a task's schedule as manual (locked). Called when the user manually
 * drags or sets a task's time — prevents the algorithm from moving it on re-run.
 */
export async function markScheduleManual(taskId: string): Promise<void> {
  const db = createServiceClient()
  await db.from('tasks').update({ scheduled_by: 'manual' }).eq('id', taskId)
}

// ── planDay ───────────────────────────────────────────────────────────────────

export interface DayPlan {
  proposedBlocks: SerializedBlock[]
  attackList:     SerializedAttackItem[]
  unschedulable:  SchedulerTask[]
  error?:         string
}

/**
 * Plan my day: schedule today's unscheduled tasks AND return a ranked attack
 * list of everything to work on today (scheduled + unscheduled in order).
 */
export async function planDay(timezone: string = 'UTC', dateStr?: string): Promise<DayPlan> {
  const db = createServiceClient()

  const dayStr = dateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  // Propose blocks for the chosen day (internally fetches scheduling inputs)
  const { scheduled, unschedulable, error } = await proposeSchedule(1, timezone, dayStr)
  if (error) return { proposedBlocks: [], attackList: [], unschedulable: [], error }

  // Fetch only the energy schedule for buildAttackList — avoids double-fetching
  // working hours and config that proposeSchedule already consumed above.
  const { data: esRows } = await db.from('user_energy_schedule').select('*')
  const energySchedule: EnergyScheduleEntry[] = (esRows ?? []).map(r => ({
    day_of_week:  r.day_of_week,
    time_block:   r.time_block as TimeBlockId,
    energy_level: r.energy_level as 'low' | 'medium' | 'high',
  }))

  // Fetch tasks due on or before the chosen day.
  // due_dates are stored as YYYY-MM-DDT00:00:00Z (UTC midnight of the local date).
  // Use `lte(dayStr + 'T00:00:00Z')` — tasks stored exactly at that midnight ARE included
  // (e.g. "2026-09-15T00:00:00Z" <= "2026-09-15T00:00:00Z" → true).
  const { data: todayTasks } = await db
    .from('tasks')
    .select('id, title, priority, urgency_score, energy_required, estimated_minutes, adjusted_minutes, due_date')
    .in('status', ['inbox', 'active'])
    .lte('due_date', dayStr + 'T00:00:00Z')
    .order('urgency_score', { ascending: false })

  const schedulerTasks: SchedulerTask[] = (todayTasks ?? []).map(t => ({
    id:               t.id,
    title:            t.title,
    priority:         t.priority,
    urgency_score:    t.urgency_score,
    energy_required:  t.energy_required,
    duration_minutes: t.adjusted_minutes ?? t.estimated_minutes ?? 30,
    due_date:         t.due_date,
  }))

  // All scheduled blocks for today (already in DB + newly proposed)
  const { data: existingScheduled } = await db
    .from('tasks')
    .select('id, scheduled_start, scheduled_end')
    .in('status', ['inbox', 'active'])
    .not('scheduled_start', 'is', null)
    .gte('scheduled_start', dayStr + 'T00:00:00Z')
    .lte('scheduled_start', dayStr + 'T23:59:59Z')

  const scheduledToday = [
    ...(existingScheduled ?? []).map(t => ({
      taskId: t.id,
      start:  new Date(t.scheduled_start!),
      end:    new Date(t.scheduled_end!),
    })),
    ...scheduled.map(b => ({ taskId: b.taskId, start: new Date(b.startISO), end: new Date(b.endISO) })),
  ]

  const rawAttack = buildAttackList(schedulerTasks, scheduledToday, energySchedule, timezone)

  const attackList: SerializedAttackItem[] = rawAttack.map(item => ({
    taskId:            item.taskId,
    taskTitle:         item.taskTitle,
    priority:          item.priority,
    urgencyScore:      item.urgencyScore,
    durationMinutes:   item.durationMinutes,
    energyRequired:    item.energyRequired,
    scheduledStartISO: item.scheduledStart?.toISOString() ?? null,
    isScheduled:       item.isScheduled,
    energyMatchNow:    item.energyMatchNow,
    rank:              item.rank,
  }))

  return { proposedBlocks: scheduled, attackList, unschedulable, error: undefined }
}

// ── Settings actions ──────────────────────────────────────────────────────────

export async function saveWorkingHours(
  day_of_week:  number,
  start_hour:   number,
  start_minute: number,
  end_hour:     number,
  end_minute:   number,
  enabled:      boolean,
): Promise<void> {
  const db = createServiceClient()
  await db.from('user_working_hours').upsert({
    day_of_week, start_hour, start_minute, end_hour, end_minute, enabled,
  }, { onConflict: 'day_of_week' })
  revalidatePath('/settings')
  revalidatePath('/tasks')
}

export async function saveEnergyLevel(
  day_of_week:  number,
  time_block:   TimeBlockId,
  energy_level: 'low' | 'medium' | 'high',
): Promise<void> {
  const db = createServiceClient()
  await db.from('user_energy_schedule').upsert(
    { day_of_week, time_block, energy_level },
    { onConflict: 'day_of_week,time_block' },
  )
  revalidatePath('/settings')
}

export async function saveSchedulingConfig(
  max_session_minutes: number,
  buffer_minutes: number,
): Promise<void> {
  const db = createServiceClient()
  // Upsert the singleton row
  const { data } = await db.from('user_scheduling_config').select('id').limit(1).single()
  if (data) {
    await db.from('user_scheduling_config')
      .update({ max_session_minutes, buffer_minutes })
      .eq('id', data.id)
  } else {
    await db.from('user_scheduling_config').insert({ max_session_minutes, buffer_minutes })
  }
  revalidatePath('/settings')
}

export interface DailyBreak {
  id:               number
  label:            string
  duration_minutes: number
  start_hour:       number
  start_minute:     number
  end_hour:         number
  end_minute:       number
  cooldown_minutes: number
  enabled:          boolean
}

export async function listDailyBreaks(): Promise<DailyBreak[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_daily_breaks')
    .select('*')
    .order('start_hour')
    .then(r => r, () => ({ data: null }))   // pre-0008: no table yet
  return (data ?? []) as DailyBreak[]
}

export async function saveDailyBreak(
  id: number,
  patch: Partial<Omit<DailyBreak, 'id'>>,
): Promise<{ error?: string }> {
  const db = createServiceClient()
  const { error } = await db.from('user_daily_breaks').update(patch).eq('id', id)
  if (error) {
    console.error('saveDailyBreak:', error.message)
    return { error: 'Could not save — run migration 0008_daily_breaks.sql first.' }
  }
  revalidatePath('/settings')
  return {}
}

/** Read the configured first day of the week (Monday until 0006 is applied). */
export async function getWeekStartDay(): Promise<number> {
  return fetchWeekStartDay(createServiceClient())
}

/**
 * Save the preferred first day of the week. Habit weekly targets count from
 * this day, so changing it re-derives "this week" everywhere at once.
 */
export async function saveWeekStartDay(day: number): Promise<{ error?: string }> {
  if (!isWeekStartDay(day)) return { error: 'Unsupported day' }

  const db = createServiceClient()
  const { data } = await db.from('user_scheduling_config').select('id').limit(1).single()

  const { error } = data
    ? await db.from('user_scheduling_config').update({ week_start_day: day }).eq('id', data.id)
    : await db.from('user_scheduling_config').insert({
        max_session_minutes: 90, buffer_minutes: 15, week_start_day: day,
      })

  if (error) {
    // The column is missing until migration 0006 runs. Reading falls back to
    // Monday, so the app still works — only the preference can't be stored.
    console.error('saveWeekStartDay:', error.message)
    return { error: 'Could not save — run migration 0006_week_start_day.sql first.' }
  }

  revalidatePath('/settings')
  revalidatePath('/habits')
  revalidatePath('/tasks')
  return {}
}

// ── Subtask helpers ───────────────────────────────────────────────────────────

/**
 * Recalculate a parent task's estimated_minutes as the sum of its active subtasks.
 */
async function recalcParentEstimate(parentId: string): Promise<void> {
  const db = createServiceClient()
  const { data: subs } = await db
    .from('tasks')
    .select('estimated_minutes')
    .eq('parent_id', parentId)
    .neq('status', 'done')

  const total = (subs ?? []).reduce((s, t) => s + (t.estimated_minutes ?? 0), 0)
  if (total > 0) {
    await db.from('tasks').update({ estimated_minutes: total }).eq('id', parentId)
  }
}

export async function updateSubtask(
  id: string,
  patch: { estimated_minutes?: number; energy_required?: string },
): Promise<void> {
  const db = createServiceClient()
  await db.from('tasks').update(patch).eq('id', id)

  const { data: sub } = await db.from('tasks').select('parent_id').eq('id', id).single()
  if (sub?.parent_id) await recalcParentEstimate(sub.parent_id)

  revalidatePath('/tasks')
}
