'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getValidToken, createTaskBlock, updateTaskBlock, deleteTaskBlock } from '@/lib/google-calendar'
import {
  runScheduler,
  buildAttackList,
  type WorkingHours,
  type EnergyScheduleEntry,
  type TimeBlockId,
  type SchedulerConfig,
  type SchedulerTask,
  type ProposedBlock,
  type AttackItem,
} from '@/lib/scheduler'

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
  ] = await Promise.all([
    db.from('user_working_hours').select('*'),
    db.from('user_energy_schedule').select('*'),
    db.from('user_scheduling_config').select('*').limit(1).single(),
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

  const schedulerConfig: SchedulerConfig = {
    maxSessionMinutes: configRow?.max_session_minutes ?? 90,
    bufferMinutes:     configRow?.buffer_minutes ?? 15,
    timezone:          'UTC',  // overridden per-call via { ...schedulerConfig, timezone }
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
  urgencyScore:      number
  durationMinutes:   number | null
  energyRequired:    string
  scheduledStartISO: string | null
  isScheduled:       boolean
  energyMatchNow:    boolean
  rank:              number
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

  // ── 4. Busy intervals from GCal ────────────────────────────────────────────
  const now      = new Date()
  const dayStr   = startDateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  const timeMin  = new Date(`${dayStr}T00:00:00Z`)
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

  // ── 1. Clear all previously auto-scheduled tasks ──────────────────────────
  const { data: autoScheduled } = await db
    .from('tasks')
    .select('id, gcal_event_id')
    .eq('scheduled_by', 'auto')
    .not('gcal_event_id', 'is', null)

  await Promise.allSettled(
    (autoScheduled ?? []).map(t =>
      deleteTaskBlock(token.access_token, t.gcal_event_id!).catch(() => {})
    )
  )

  // Clear scheduling fields for all auto-scheduled tasks
  await db
    .from('tasks')
    .update({ gcal_event_id: null, scheduled_start: null, scheduled_end: null, scheduled_by: null })
    .eq('scheduled_by', 'auto')

  // ── 2. Fetch task info for the proposed blocks ────────────────────────────
  const taskIds = [...new Set(blocks.map(b => b.taskId))]
  const { data: taskRows } = await db
    .from('tasks')
    .select('id, title, description, priority')
    .in('id', taskIds)

  const taskMap = new Map((taskRows ?? []).map(t => [t.id, t]))

  // ── 3. Create GCal events + update DB ────────────────────────────────────
  let confirmed = 0
  let failed    = 0

  for (const block of blocks) {
    const task = taskMap.get(block.taskId)
    if (!task) { failed++; continue }

    try {
      const gcalEventId = await createTaskBlock(
        token.access_token,
        { title: task.title, description: task.description, priority: task.priority },
        block.startISO,
        block.endISO,
      )
      await db.from('tasks').update({
        gcal_event_id:   gcalEventId,
        scheduled_start: block.startISO,
        scheduled_end:   block.endISO,
        scheduled_by:    'auto',
      }).eq('id', block.taskId)
      confirmed++
    } catch (err) {
      console.error('Failed to schedule block', block.taskId, err)
      failed++
    }
  }

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

  const { workingHours, energySchedule, schedulerConfig } = await fetchSchedulingInputs()

  const dayStr = dateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  // Propose blocks for the chosen day
  const { scheduled, unschedulable, error } = await proposeSchedule(1, timezone, dayStr)
  if (error) return { proposedBlocks: [], attackList: [], unschedulable: [], error }

  // Fetch tasks due on or before the chosen day.
  // due_dates are stored as YYYY-MM-DDT00:00:00Z (UTC midnight of the local date).
  // Use `lte(dayStr + 'T00:00:00Z')` — tasks stored exactly at that midnight ARE included
  // (e.g. "2026-09-15T00:00:00Z" <= "2026-09-15T00:00:00Z" → true).
  const { data: todayTasks } = await db
    .from('tasks')
    .select('id, title, urgency_score, energy_required, estimated_minutes, adjusted_minutes, due_date')
    .in('status', ['inbox', 'active'])
    .lte('due_date', dayStr + 'T00:00:00Z')
    .order('urgency_score', { ascending: false })

  const schedulerTasks: SchedulerTask[] = (todayTasks ?? []).map(t => ({
    id:               t.id,
    title:            t.title,
    priority:         2,
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
