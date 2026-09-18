'use server'

import { revalidatePath } from 'next/cache'
import { RELEVANT_WINDOW_MIN, RELEVANT_WINDOW_MAX } from '@/lib/relevance'
import { createServiceClient } from '@/lib/supabase/server'
import { getValidToken, createTaskBlock, deleteTaskBlock, listAutoScheduledEvents } from '@/lib/google-calendar'
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
  blockLabel,
} from '@/lib/scheduler'
import { weekStartOf, fetchWeekStartDay, isWeekStartDay } from '@/lib/week'
import { isValidTimezone, fetchTimezone, localDayStr, startOfLocalDay, addDays as addDayStr } from '@/lib/day'

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
  // Independent of each other — one round trip instead of three
  const [{ data: habits }, weekStartDay, tz] = await Promise.all([
    db.from('tasks')
      .select('*')        // '*' so a pre-0007 database (no exclusive_group) still works
      .eq('type', 'habit')
      .in('status', ['inbox', 'active'])
      .is('parent_id', null)
      .or('scheduled_by.is.null,scheduled_by.eq.auto'),
    fetchWeekStartDay(db),
    fetchTimezone(db),
  ])

  if (!habits || habits.length === 0) return []

  // Which week it is depends on where you are — a Sunday-evening session west
  // of UTC is still this week, not the next one.
  const weekStart = weekStartOf(new Date(), weekStartDay, tz)

  // The instant this week ends. Sessions are owed *this* week, so they must not
  // spill past it — "Schedule week" runs a rolling 7 days from today, which
  // straddles the week boundary whenever today isn't the first day.
  //
  // weekStart is a local calendar day, so it converts through startOfLocalDay
  // like the completions query below. Reading it as UTC midnight put the
  // deadline at 17:00 on the week's last day in America/Los_Angeles, quietly
  // costing the scheduler the final evening of every week.
  const weekEnd = startOfLocalDay(addDayStr(weekStart, 7), tz).toISOString()

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
    .gte('completed_at', startOfLocalDay(weekStart, tz).toISOString())
    .not('completed_at', 'is', null)

  const daysByTitle = new Map<string, Set<string>>()
  for (const r of doneRows ?? []) {
    if (!r.completed_at) continue
    const set = daysByTitle.get(r.title) ?? new Set<string>()
    set.add(localDayStr(r.completed_at, tz))
    daysByTitle.set(r.title, set)
  }

  // One list per habit, interleaved below
  const perHabit: SchedulerTask[][] = []

  for (const h of habits) {
    const duration = h.adjusted_minutes ?? h.estimated_minutes
    if (!duration) continue          // no session length set — can't schedule it

    // No weekly target means "I keep doing this, no fixed count" — still worth
    // one slot a week rather than never being scheduled at all. Requiring a
    // target meant these habits were silently invisible to the scheduler.
    const done = daysByTitle.get(h.title)?.size ?? 0
    const owed = h.weekly_target == null
      ? (done > 0 ? 0 : 1)
      : Math.max(0, h.weekly_target - done)
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
        location:         h.location ?? 'anywhere',
        spanMinutes:      h.span_minutes ?? undefined,
        bufferMinutes:    h.buffer_minutes ?? undefined,
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

/** Something already on the week — context for reviewing a proposal. */
export interface ExistingItem {
  id:        string
  title:     string
  startISO:  string
  endISO:    string
  /** 'event' = calendar commitment; 'scheduled' = a task block already booked. */
  kind:      'event' | 'scheduled'
}

export interface ProposeResult {
  scheduled:     SerializedBlock[]
  unschedulable: SchedulerTask[]
  /** Everything already occupying the horizon, so the whole week is reviewable. */
  existing:      ExistingItem[]
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

  // The window is pure arithmetic, so it can be computed before any await and
  // let the calendar queries start alongside everything else.
  const dayStr  = startDateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const timeMin = new Date(localMidnight(dayStr, timezone))
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + horizonDays + 1)

  // ── 1. Everything independent, at once ─────────────────────────────────────
  // These were sequential awaits: ~2s of round trips for work that has no
  // ordering between it. Only the subtask query (needs parent ids) and freeBusy
  // (needs the token) have to follow.
  const [
    token,
    { workingHours, energySchedule, schedulerConfig },
    { data: taskRows },
    habitCandidates,
    { data: eventRows },
    { data: bookedRows },
  ] = await Promise.all([
    getValidToken(),
    fetchSchedulingInputs(),
    db.from('tasks')
    .select('*')                        // '*' so pre-0009 rows (no location/span) still load
    .in('status', ['inbox', 'active'])
    .is('parent_id', null)              // top-level tasks only here
    .neq('type', 'habit')               // habits are expanded per weekly target below
    .or('scheduled_by.is.null,scheduled_by.eq.auto')  // exclude manual locks; neq would drop NULLs
    .order('urgency_score', { ascending: false }),
    buildHabitCandidates(db),
    db.from('calendar_events')
      .select('id, title, start_time, end_time')
      .gte('start_time', timeMin.toISOString())
      .lte('start_time', timeMax.toISOString()),
    db.from('tasks')
      .select('id, title, scheduled_start, scheduled_end')
      .not('scheduled_start', 'is', null)
      .gte('scheduled_start', timeMin.toISOString())
      .lte('scheduled_start', timeMax.toISOString()),
  ])

  if (!token) return { scheduled: [], unschedulable: [], existing: [], error: 'Google Calendar not connected' }

  // Fetch subtasks for tasks that have them
  const parentIds = (taskRows ?? []).map(t => t.id)
  const { data: subtaskRows } = parentIds.length > 0
    ? await db
        .from('tasks')
        .select('*')
        .in('parent_id', parentIds)
        // Creation order is the running order for a staged chain
        .order('created_at', { ascending: true })
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
      dueTimeMinutes:   t.due_time_minutes ?? null,
      location:         t.location ?? 'anywhere',
      spanMinutes:      t.span_minutes ?? undefined,
      bufferMinutes:    t.buffer_minutes ?? undefined,
      notBefore:        t.start_date ?? undefined,
    })
  }

  const parents = new Map((taskRows ?? []).map(t => [t.id, t]))

  // Running order within each parent, taken from the created_at order above
  const chainIndex = new Map<string, number>()

  for (const s of subtaskRows ?? []) {
    chainIndex.set(s.parent_id, (chainIndex.get(s.parent_id) ?? -1) + 1)
    const duration = s.adjusted_minutes ?? s.estimated_minutes
    if (!duration) continue
    const parent = parents.get(s.parent_id)
    candidates.push({
      id:               s.id,
      title:            blockLabel(s.title, parent?.title),
      // Importance belongs to the parent. Subtasks are created at priority 1
      // with urgency 0, so a chain under a critical task used to sort to the
      // very bottom and get whatever slots were left — the opposite of what
      // marking the parent P4 is supposed to do.
      priority:         parent?.priority ?? s.priority,
      urgency_score:    parent?.urgency_score ?? s.urgency_score,
      energy_required:  s.energy_required,
      duration_minutes: duration,
      // Read from the parent every run rather than trusting the copy made at
      // creation: a subtask can never be due later than the work it's part of.
      // The hour travels with the day for the same reason — a step of work due
      // by five cannot run past five either.
      due_date:         parent?.due_date ?? s.due_date,
      dueTimeMinutes:   parent?.due_time_minutes ?? s.due_time_minutes ?? null,
      // Subtasks of one parent chain together — no buffer between them, one
      // buffer around the run.
      chainGroup:       s.parent_id,
      gapAfterMinutes:  s.gap_after_minutes ?? undefined,
      chainIndex:       chainIndex.get(s.parent_id)!,
      // Location follows the parent unless the subtask sets its own: the steps
      // of a laundry cycle happen wherever the laundry is.
      location:         s.location && s.location !== 'anywhere'
                          ? s.location
                          : (parent?.location ?? 'anywhere'),
      spanMinutes:      s.span_minutes ?? undefined,
      bufferMinutes:    s.buffer_minutes ?? undefined,
      // A step can't begin before the work as a whole is available
      notBefore:        parent?.start_date ?? s.start_date ?? undefined,
    })
  }

  // Habit sessions — one candidate per session still owed this week (fetched
  // above, alongside everything else).
  candidates.push(...habitCandidates)

  // ── 4. Busy intervals from GCal ────────────────────────────────────────────
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

  // ── 6. What's already on the week ──────────────────────────────────────────
  // Fetched up front; shaped here. Returned so the review shows the whole
  // horizon, not only the new blocks.
  const existing: ExistingItem[] = [
    ...(eventRows ?? []).map(e => ({
      id: e.id, title: e.title,
      startISO: e.start_time, endISO: e.end_time, kind: 'event' as const,
    })),
    ...(bookedRows ?? []).map(t => ({
      id: t.id, title: t.title,
      startISO: t.scheduled_start!, endISO: t.scheduled_end!, kind: 'scheduled' as const,
    })),
  ].sort((a, b) => a.startISO.localeCompare(b.startISO))

  return { scheduled: serialized, unschedulable, existing }
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

  let staleEvents: { id: string; taskId: string | null }[] = []
  try {
    staleEvents = await listAutoScheduledEvents(token.access_token, nowISO, sweepEnd)
  } catch (err) {
    // A failed sweep must not block scheduling — worst case some old blocks
    // linger, which is what the previous behaviour did anyway.
    console.error('Failed to list existing auto-scheduled events', err)
  }

  // ── 2. Fetch task info for the proposed blocks ────────────────────────────
  const taskIds = [...new Set(blocks.map(b => b.taskId))]
  const { data: taskRows } = await db
    .from('tasks')
    .select('id, title, description, priority, parent_id')
    .in('id', taskIds)

  // Parent titles for any subtasks in this batch, so the calendar event carries
  // the same "Parent - Subtask" label the preview showed.
  const parentIds = [...new Set((taskRows ?? []).map(t => t.parent_id).filter(Boolean))] as string[]
  const { data: parentRows } = parentIds.length > 0
    ? await db.from('tasks').select('id, title').in('id', parentIds)
    : { data: [] }
  const parentTitles = new Map((parentRows ?? []).map(p => [p.id, p.title as string]))

  const taskMap = new Map((taskRows ?? []).map(t => [
    t.id,
    { ...t, title: blockLabel(t.title, t.parent_id ? parentTitles.get(t.parent_id) : null) },
  ]))

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

  // ── 4. Replace the previous blocks for the tasks we just rescheduled ──────
  // Scoped to the approved tasks, not the whole horizon: the user can approve
  // part of a proposal, and blocks for work they didn't approve must survive
  // untouched rather than being swept because they weren't in this batch.
  // Events carry plannerTaskId, so a task's older blocks are identifiable even
  // though the row only remembers one id.
  //
  // An empty `blocks` is still a deliberate "clear the auto-schedule".
  const approvedTaskIds = new Set(blocks.map(b => b.taskId))
  const justCreated     = new Set([...rowWrites.values()].map(w => w.eventId))

  const toDelete = blocks.length === 0
    ? staleEvents
    : staleEvents.filter(e =>
        e.taskId && approvedTaskIds.has(e.taskId) && !justCreated.has(e.id))

  if (toDelete.length > 0 && (confirmed > 0 || blocks.length === 0)) {
    await Promise.allSettled(
      toDelete.map(e => deleteTaskBlock(token.access_token, e.id).catch(() => {}))
    )
  }

  // Clear DB fields only for tasks whose blocks we actually removed
  const clearedIds = blocks.length === 0
    ? null                                   // clearing everything
    : [...new Set(toDelete.map(e => e.taskId!))].filter(id => !rowWrites.has(id))

  if (clearedIds === null) {
    await db
      .from('tasks')
      .update({ gcal_event_id: null, scheduled_start: null, scheduled_end: null, scheduled_by: null })
      .eq('scheduled_by', 'auto')
  } else if (clearedIds.length > 0) {
    await db
      .from('tasks')
      .update({ gcal_event_id: null, scheduled_start: null, scheduled_end: null, scheduled_by: null })
      .in('id', clearedIds)
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
  /** Already on the day — context for the calendar view. */
  existing:       ExistingItem[]
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
  const { scheduled, unschedulable, existing, error } = await proposeSchedule(1, timezone, dayStr)
  if (error) return { existing: [], proposedBlocks: [], attackList: [], unschedulable: [], error }

  // Fetch only the energy schedule for buildAttackList — avoids double-fetching
  // working hours and config that proposeSchedule already consumed above.
  const { data: esRows } = await db.from('user_energy_schedule').select('*')
  const energySchedule: EnergyScheduleEntry[] = (esRows ?? []).map(r => ({
    day_of_week:  r.day_of_week,
    time_block:   r.time_block as TimeBlockId,
    energy_level: r.energy_level as 'low' | 'medium' | 'high',
  }))

  // Candidates for the day's ranked list.
  //
  // This used to filter `due_date <= day`, which silently dropped two whole
  // categories: anything with no due date — every habit — and anything the
  // scheduler pulled forward from later to fill the day. The blocks above
  // already include both, so the list disagreed with the plan beside it.
  //
  // Now: due today or earlier, or undated, or scheduled today. Far-future work
  // stays out unless it actually earned a block.
  const { data: allTasks } = await db
    .from('tasks')
    .select('*')
    .in('status', ['inbox', 'active'])
    .is('parent_id', null)
    .order('urgency_score', { ascending: false })

  const dayCutoff   = dayStr + 'T00:00:00Z'
  const blockedToday = new Set(scheduled.map(b => b.taskId))

  const schedulerTasks: SchedulerTask[] = (allTasks ?? [])
    .filter(t => !t.due_date || t.due_date <= dayCutoff || blockedToday.has(t.id))
    .map(t => ({
      id:               t.id,
      title:            t.title,
      priority:         t.priority,
      // Habits store 0 — they aren't deadline work — which would bury them at
      // the bottom of the list. Same baseline the scheduler gives them.
      urgency_score:    t.type === 'habit' ? t.priority * 10 : t.urgency_score,
      energy_required:  t.energy_required,
      duration_minutes: t.adjusted_minutes ?? t.estimated_minutes ?? 30,
      due_date:         t.due_date,
      dueTimeMinutes:   t.due_time_minutes ?? null,
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

  return { existing, proposedBlocks: scheduled, attackList, unschedulable, error: undefined }
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
/**
 * Record the user's timezone.
 *
 * Habit days are local days, and both server actions and the server-rendered
 * habits page need to know which zone that is — so it's stored rather than read
 * off the browser at the point of use. `TimezoneSync` reports it automatically
 * on load; this is also what the Settings control writes.
 *
 * Returns `changed` so the caller knows whether anything moved: the sync runs
 * on every page load and must not trigger a revalidation storm.
 */
export async function saveTimezone(tz: string): Promise<{ error?: string; changed?: boolean }> {
  if (!isValidTimezone(tz)) return { error: 'Unrecognised timezone' }

  const db = createServiceClient()
  const { data } = await db.from('user_scheduling_config').select('*').limit(1).maybeSingle()

  if (data?.timezone === tz) return { changed: false }

  const { error } = data
    ? await db.from('user_scheduling_config').update({ timezone: tz }).eq('id', data.id)
    : await db.from('user_scheduling_config').insert({
        max_session_minutes: 90, buffer_minutes: 15, timezone: tz,
      })

  if (error) {
    // Missing until 0014 runs. Reads fall back to UTC, which is the old
    // behaviour, so the app works — only the preference can't be stored.
    console.error('saveTimezone:', error.message)
    return { error: 'Could not save — run migration 0014_user_timezone.sql first.' }
  }

  revalidatePath('/habits')
  revalidatePath('/tasks')
  revalidatePath('/settings')
  return { changed: true }
}

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

/**
 * The two numbers behind the "Relevant" toggle.
 *
 * Saved together because they are one judgement — how much of the future counts
 * as now — and adjusting one usually means reconsidering the other.
 */
export async function saveRelevanceSettings(
  windowDays: number,
  minPriority: number,
): Promise<{ error?: string }> {
  if (!Number.isInteger(windowDays) || windowDays < RELEVANT_WINDOW_MIN || windowDays > RELEVANT_WINDOW_MAX) {
    return { error: `Window must be a whole number of days between ${RELEVANT_WINDOW_MIN} and ${RELEVANT_WINDOW_MAX}` }
  }
  if (!Number.isInteger(minPriority) || minPriority < 1 || minPriority > 4) {
    return { error: 'Priority must be between 1 and 4' }
  }

  const db = createServiceClient()
  const { data } = await db.from('user_scheduling_config').select('id').limit(1).single()

  const patch = { relevant_window_days: windowDays, relevant_min_priority: minPriority }
  const { error } = data
    ? await db.from('user_scheduling_config').update(patch).eq('id', data.id)
    : await db.from('user_scheduling_config').insert({
        max_session_minutes: 90, buffer_minutes: 15, ...patch,
      })

  if (error) {
    // Missing until 0017 runs. Reading falls back to the old constants, so the
    // filter still works — only the preference cannot be stored.
    console.error('saveRelevanceSettings:', error.message)
    return { error: 'Could not save — run migration 0017_relevance_settings.sql first.' }
  }

  revalidatePath('/settings')
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
