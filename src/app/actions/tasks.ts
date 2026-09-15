'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { computeUrgency, Task } from '@/types'
import { getNextOccurrence } from '@/lib/rrule-utils'
import { weekStartOf, fetchWeekStartDay } from '@/lib/week'
import { getValidToken, deleteTaskBlock } from '@/lib/google-calendar'

// Fields whose changes require an urgency recompute
const URGENCY_FIELDS = new Set(['priority', 'due_date', 'urgency_curve'])

// ── Complete a task + log reflection ────────────────────────────────────────
export async function completeTask(
  taskId: string,
  actualMinutes: number | null,
  estimateAccurate: boolean | null,
  blockerNote: string | null,
  /** When true, recurring tasks are NOT given a next occurrence (permanently done). */
  permanent = false
) {
  const db = createServiceClient()

  // Fetch the task so we know its rrule and template fields before marking done
  const { data: taskRow } = await db
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  // Mark task done
  const { error: taskErr } = await db
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString(), actual_minutes: actualMinutes })
    .eq('id', taskId)

  if (taskErr) throw new Error(taskErr.message)

  // Log focus session with reflection — but only if the FloatingTimer hasn't
  // already written a session for this task in the last hour (to avoid duplicates).
  if (actualMinutes != null || estimateAccurate != null) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: recentSession } = await db
      .from('focus_sessions')
      .select('id')
      .eq('task_id', taskId)
      .not('ended_at', 'is', null)
      .gte('ended_at', oneHourAgo)
      .maybeSingle()

    if (!recentSession) {
      await db.from('focus_sessions').insert({
        task_id: taskId,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_minutes: actualMinutes,
        estimate_accurate: estimateAccurate,
        blocker_note: blockerNote,
      })
    }
  }

  // Recalculate bias ratio for the task's project (reuse taskRow fetched above)
  if (taskRow && actualMinutes != null && taskRow.estimated_minutes) {
    const { data: profile } = await db
      .from('estimation_profiles')
      .select('*')
      .eq('project_id', taskRow.project_id)
      .single()

    if (profile) {
      const newCount = profile.sample_count + 1
      // Running average of bias ratio
      const newRatio = (profile.bias_ratio * profile.sample_count + actualMinutes / taskRow.estimated_minutes) / newCount
      await db.from('estimation_profiles').update({ sample_count: newCount, bias_ratio: newRatio, updated_at: new Date().toISOString() }).eq('project_id', taskRow.project_id)
    } else {
      await db.from('estimation_profiles').insert({
        project_id: taskRow.project_id,
        sample_count: 1,
        bias_ratio: actualMinutes / taskRow.estimated_minutes,
      })
    }
  }

  // ── Recurring task / habit: spawn the next occurrence ───────────────────────
  const isHabit     = taskRow?.type === 'habit'
  const shouldSpawn = taskRow && !permanent && (taskRow.rrule || isHabit)

  if (shouldSpawn) {
    const today = new Date()
    const now   = new Date().toISOString()

    // For rrule habits/tasks: compute next date from rule.
    // Anchor from the task's own due_date (not today) so completing a weekly
    // task early doesn't re-spawn it for the same occurrence date.
    // e.g. "Weekly Review" due Sep 20 completed Sep 14 → next is Sep 27, not Sep 20.
    // For anytime habits (no rrule): spawn for tomorrow so the card reappears.
    let nextDue: string | null = null
    if (taskRow.rrule) {
      const anchor = taskRow.due_date ? new Date(taskRow.due_date) : today
      const nextDate = getNextOccurrence(taskRow.rrule, anchor)
      if (nextDate) nextDue = new Date(nextDate + 'T00:00:00Z').toISOString()
    } else if (isHabit) {
      // UTC midnight of the next calendar day — local midnight would land a few
      // hours either side of the UTC day boundary and the habits page (which
      // filters on UTC day edges) would show the habit a day early or late.
      const tomorrow = new Date(today)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      tomorrow.setUTCHours(0, 0, 0, 0)
      nextDue = tomorrow.toISOString()
    }

    // A habit must never have two pending occurrences: completing it twice in
    // one day would otherwise spawn a second row for tomorrow, and the habit
    // would show (and schedule) twice on the same day. Occurrences are linked
    // by title, the same identity the completion calendar uses.
    let alreadyPending = false
    if (nextDue && isHabit) {
      const { data: pending } = await db
        .from('tasks')
        .select('id')
        .eq('type', 'habit')
        .eq('title', taskRow.title)
        .in('status', ['inbox', 'active'])
        .is('parent_id', null)
        .neq('id', taskId)
        .limit(1)
      alreadyPending = (pending?.length ?? 0) > 0
    }

    if (nextDue && !alreadyPending) {
      const urgency_score = (isHabit && !taskRow.rrule) ? 0 : computeUrgency({
        priority:      taskRow.priority as Task['priority'],
        urgency_curve: (taskRow.urgency_curve ?? 'linear') as Task['urgency_curve'],
        due_date:      nextDue,
        created_at:    now,
      })

      await db.from('tasks').insert({
        title:              taskRow.title,
        description:        taskRow.description,
        project_id:         taskRow.project_id,
        type:               taskRow.type,
        status:             'inbox',
        priority:           taskRow.priority,
        energy_required:    taskRow.energy_required,
        urgency_curve:      taskRow.urgency_curve,
        urgency_score,
        estimated_minutes:  taskRow.estimated_minutes,
        rrule:              taskRow.rrule,
        weekly_target:      taskRow.weekly_target ?? null,
        due_date:           nextDue,
        created_at:         now,
        // Only when set: sending the key unconditionally would fail every
        // insert on a pre-0007 database, which is how weekly_target once broke
        // habit creation outright.
        ...(taskRow.exclusive_group ? { exclusive_group: taskRow.exclusive_group } : {}),
      })
    }

    // Upsert habit streak
    const todayStr = today.toISOString().slice(0, 10)

    // Start of the current week, per the user's configured first day
    const weekStartStr = weekStartOf(today, await fetchWeekStartDay(db))

    const { data: streak } = await db
      .from('habit_streaks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle()

    if (streak) {
      // Already logged today: completing again is a no-op. Without this the
      // streak check below sees last_completed === today (not yesterday),
      // reads it as "not consecutive" and resets a long streak to 1.
      if (streak.last_completed !== todayStr) {
        // Consecutive-day streak
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().slice(0, 10)
        const consecutive = streak.last_completed === yesterdayStr
        const newStreak = consecutive ? streak.current_streak + 1 : 1

        // Weekly count — reset if the stored week_start is from a different week
        const sameWeek = streak.week_start === weekStartStr
        const newWeeklyCount = sameWeek ? (streak.completions_this_week + 1) : 1

        await db.from('habit_streaks').update({
          current_streak:        newStreak,
          longest_streak:        Math.max(newStreak, streak.longest_streak),
          last_completed:        todayStr,
          completions_this_week: newWeeklyCount,
          week_start:            weekStartStr,
        }).eq('task_id', taskId)
      }
    } else {
      await db.from('habit_streaks').insert({
        task_id:               taskId,
        current_streak:        1,
        longest_streak:        1,
        last_completed:        todayStr,
        completions_this_week: 1,
        week_start:            weekStartStr,
      })
    }
  }

  revalidatePath('/tasks')
  revalidatePath('/habits')
}

// ── Habit maintenance ────────────────────────────────────────────────────────
// A habit is a chain of task rows sharing a title (each completion closes one
// row and spawns the next), so both of these operate on the title rather than a
// single row id — the same identity the streak calendar uses.

/** Keep a habit off the cooldown window after meals (gym, running). */
export async function setHabitAvoidAfterBreaks(
  title: string,
  avoid: boolean,
): Promise<{ error?: string }> {
  const db = createServiceClient()
  const { error } = await db
    .from('tasks')
    .update({ avoid_after_breaks: avoid })
    .eq('type', 'habit')
    .eq('title', title)

  if (error) {
    console.error('setHabitAvoidAfterBreaks:', error.message)
    return { error: 'Could not save — run migration 0008_daily_breaks.sql first.' }
  }
  revalidatePath('/habits')
  return {}
}

/** A habit and the group it belongs to, for the exclusivity picker. */
export interface HabitExclusivity {
  title: string
  group: string | null
  avoidAfterBreaks: boolean
}

/** Every distinct habit, with its exclusive group. */
export async function listHabitExclusivity(): Promise<HabitExclusivity[]> {
  const db = createServiceClient()
  // select('*') so a pre-0007 database returns rows without the column
  const { data } = await db
    .from('tasks')
    .select('*')
    .eq('type', 'habit')
    .in('status', ['inbox', 'active'])
    .is('parent_id', null)

  const byTitle = new Map<string, HabitExclusivity>()
  for (const r of data ?? []) {
    if (!byTitle.has(r.title)) byTitle.set(r.title, {
      title: r.title,
      group: r.exclusive_group ?? null,
      avoidAfterBreaks: !!r.avoid_after_breaks,
    })
  }
  return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title))
}

/** Set the group on every row of a habit chain, so it survives the next spawn. */
async function writeGroup(
  db: ReturnType<typeof createServiceClient>,
  title: string,
  group: string | null,
) {
  return db.from('tasks').update({ exclusive_group: group }).eq('type', 'habit').eq('title', title)
}

/**
 * Link or unlink two habits so they are never scheduled on the same day.
 *
 * Takes the *other habit* rather than a group name. Naming a group is the kind
 * of thing that reads as "not on the same day as ___" and invites you to type
 * the other habit's title — which silently creates two groups of one that
 * exclude nothing. Picking the habit updates both sides in one go.
 *
 * Exclusivity is a set, not a pair: linking Gym–Run and then Run–Piano puts all
 * three in one group, so none of them share a day.
 */
export async function setHabitExclusiveLink(
  title: string,
  otherTitle: string,
  linked: boolean,
): Promise<{ error?: string }> {
  if (title === otherTitle) return { error: 'A habit cannot exclude itself' }

  const db = createServiceClient()
  const all = await listHabitExclusivity()
  const mine  = all.find(h => h.title === title)
  const other = all.find(h => h.title === otherTitle)
  if (!mine || !other) return { error: 'Habit not found' }

  let err: { message: string } | null = null

  if (linked) {
    // Join whichever group already exists, else start one named for the pair.
    const group = other.group ?? mine.group ?? [title, otherTitle].sort().join(' + ')
    err = (await writeGroup(db, title, group)).error
      ?? (await writeGroup(db, otherTitle, group)).error
  } else {
    const group = mine.group
    if (group) {
      const members = all.filter(h => h.group === group)
      // A group of one excludes nothing, so unlinking a pair clears both sides.
      // With more members, only the habit being unticked leaves.
      err = members.length <= 2
        ? ((await writeGroup(db, title, null)).error ?? (await writeGroup(db, otherTitle, null)).error)
        : (await writeGroup(db, otherTitle, null)).error
    }
  }

  if (err) {
    console.error('setHabitExclusiveLink:', err.message)
    return { error: 'Could not save — run migration 0007_habit_exclusive_group.sql first.' }
  }

  revalidatePath('/habits')
  return {}
}

/**
 * Delete a habit and its entire history: every occurrence, its streak rows, and
 * any calendar blocks that were scheduled for it.
 */
export async function deleteHabit(title: string): Promise<{ error?: string }> {
  const db = createServiceClient()

  const { data: rows, error: fetchErr } = await db
    .from('tasks')
    .select('id, gcal_event_id')
    .eq('type', 'habit')
    .eq('title', title)

  if (fetchErr) return { error: fetchErr.message }
  if (!rows || rows.length === 0) return { error: 'Habit not found' }

  const ids = rows.map(r => r.id)

  // Remove calendar blocks first — once the rows are gone we can't find them,
  // and they'd sit on the user's calendar forever.
  const eventIds = rows.map(r => r.gcal_event_id).filter((v): v is string => !!v)
  if (eventIds.length > 0) {
    const token = await getValidToken()
    if (token) {
      await Promise.allSettled(
        eventIds.map(id => deleteTaskBlock(token.access_token, id).catch(() => {}))
      )
    }
  }

  await db.from('habit_streaks').delete().in('task_id', ids)

  const { error } = await db.from('tasks').delete().in('id', ids)
  if (error) return { error: error.message }

  revalidatePath('/habits')
  revalidatePath('/tasks')
  revalidatePath('/analytics')
  return {}
}

/**
 * Record or un-record a habit on a past date — for when you did the thing but
 * forgot to log it.
 *
 * Recording inserts a completed occurrence rather than touching the pending
 * row, so today's card stays actionable and the spawn chain is untouched.
 * completed_at is noon UTC so the date survives being sliced back out.
 */
export async function setHabitCompletion(
  title: string,
  dateStr: string,          // YYYY-MM-DD
  done: boolean,
): Promise<{ error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: 'Bad date' }

  const today = new Date().toISOString().slice(0, 10)
  if (dateStr > today) return { error: "Can't log a habit in the future" }

  const db = createServiceClient()

  const dayStart = `${dateStr}T00:00:00Z`
  const dayEnd   = `${dateStr}T23:59:59.999Z`

  if (!done) {
    const { error } = await db
      .from('tasks')
      .delete()
      .eq('type', 'habit')
      .eq('title', title)
      .eq('status', 'done')
      .gte('completed_at', dayStart)
      .lte('completed_at', dayEnd)
    if (error) return { error: error.message }
    revalidatePath('/habits')
    return {}
  }

  // Already recorded that day — nothing to do (one completion per day).
  const { data: existing } = await db
    .from('tasks')
    .select('id')
    .eq('type', 'habit')
    .eq('title', title)
    .eq('status', 'done')
    .gte('completed_at', dayStart)
    .lte('completed_at', dayEnd)
    .limit(1)
  if (existing && existing.length > 0) return {}

  // Copy the habit's settings from its most recent row
  const { data: template } = await db
    .from('tasks')
    .select('*')
    .eq('type', 'habit')
    .eq('title', title)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!template) return { error: 'Habit not found' }

  const { error } = await db.from('tasks').insert({
    title,
    description:       template.description,
    project_id:        template.project_id,
    type:              'habit',
    status:            'done',
    priority:          template.priority,
    energy_required:   template.energy_required,
    urgency_curve:     template.urgency_curve,
    urgency_score:     0,
    estimated_minutes: template.estimated_minutes,
    rrule:             template.rrule,
    weekly_target:     template.weekly_target ?? null,
    due_date:          null,
    created_at:        `${dateStr}T12:00:00Z`,
    completed_at:      `${dateStr}T12:00:00Z`,
    ...(template.exclusive_group ? { exclusive_group: template.exclusive_group } : {}),
  })
  if (error) return { error: error.message }

  revalidatePath('/habits')
  revalidatePath('/analytics')
  return {}
}

/**
 * Where a task happens and how long it ties you up.
 *
 * Separate from updateTask because these columns arrive in 0009: a failed write
 * comes back as a message instead of throwing into the UI.
 */
export async function setTaskPlacement(
  taskId: string,
  patch: { location?: string; span_minutes?: number | null; buffer_minutes?: number | null },
): Promise<{ error?: string }> {
  const db = createServiceClient()
  const { error } = await db.from('tasks').update(patch).eq('id', taskId)
  if (error) {
    console.error('setTaskPlacement:', error.message)
    return { error: 'Could not save — run migrations 0009 and 0010 first.' }
  }
  revalidatePath('/tasks')
  revalidatePath('/habits')
  return {}
}

// ── Update task fields ───────────────────────────────────────────────────────
export async function updateTask(taskId: string, data: Record<string, unknown>) {
  const db = createServiceClient()

  // If any urgency-affecting field changed, recompute the score immediately
  const needsRecompute = Object.keys(data).some(k => URGENCY_FIELDS.has(k))
  let patch = { ...data }

  if (needsRecompute) {
    // Fetch current task to fill in any fields not in the patch
    const { data: current, error: fetchErr } = await db
      .from('tasks')
      .select('priority, urgency_curve, due_date, created_at')
      .eq('id', taskId)
      .single()

    if (fetchErr) console.error('updateTask: failed to fetch task for urgency recompute:', fetchErr.message)

    if (current) {
      const merged = {
        priority:      (data.priority      ?? current.priority)      as Task['priority'],
        urgency_curve: (data.urgency_curve ?? current.urgency_curve) as Task['urgency_curve'],
        due_date:      (data.due_date      !== undefined ? data.due_date : current.due_date) as string | null,
        created_at:    current.created_at  as string,
      }
      patch = { ...patch, urgency_score: computeUrgency(merged) }
    }
  }

  const { error } = await db.from('tasks').update(patch).eq('id', taskId)
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/projects')
  revalidatePath('/habits')   // habits are edited from /habits via TaskDetail
}

// ── Quick triage (no reflection) — used in weekly review ────────────────────
export type TriageAction = 'done' | 'someday' | 'cancel' | 'activate'

export async function triageTask(taskId: string, action: TriageAction) {
  const db = createServiceClient()
  let patch: Record<string, unknown>
  switch (action) {
    case 'done':
      patch = { status: 'done', completed_at: new Date().toISOString() }
      break
    case 'someday':
      patch = { type: 'someday', status: 'inbox' }
      break
    case 'cancel':
      patch = { status: 'cancelled' }
      break
    case 'activate':
      patch = { type: 'task', status: 'active' }
      break
  }
  const { error } = await db.from('tasks').update(patch).eq('id', taskId)
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/review')
}

// ── Save weekly review record ────────────────────────────────────────────────
export async function saveWeeklyReview(data: {
  week_start: string
  completed_count: number
  postponed_count: number
  notes: string | null
}) {
  const db = createServiceClient()
  const { error } = await db.from('weekly_reviews').insert({
    ...data,
    completed_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath('/review')
}

// ── Focus session lifecycle ──────────────────────────────────────────────────
export async function startFocusSession(taskId: string): Promise<string> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('focus_sessions')
    .insert({ task_id: taskId, started_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function abandonFocusSession(sessionId: string) {
  const db = createServiceClient()
  await db.from('focus_sessions').delete().eq('id', sessionId)
}

export async function finishFocusSession(
  sessionId: string,
  durationMinutes: number,
  estimateAccurate: boolean | null,
  blockerNote: string | null,
) {
  const db = createServiceClient()
  const { error } = await db
    .from('focus_sessions')
    .update({
      ended_at:          new Date().toISOString(),
      duration_minutes:  durationMinutes,
      estimate_accurate: estimateAccurate,
      blocker_note:      blockerNote,
    })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
  revalidatePath('/analytics')
}

// ── Create a new task ────────────────────────────────────────────────────────
export async function createTask(data: {
  title: string
  project_id?: string | null
  priority: number
  energy_required: string
  estimated_minutes: number | null
  due_date: string | null
  urgency_curve: string
  rrule?: string | null
  weekly_target?: number | null
  /** Explicit type override — 'habit' skips urgency scoring */
  taskType?: 'task' | 'recurring' | 'habit'
}) {
  const db = createServiceClient()
  const now = new Date().toISOString()

  const resolvedType = data.taskType ?? (data.rrule ? 'recurring' : 'task')

  // Habits don't have urgency — they're not time-pressured work items
  const urgency_score = resolvedType === 'habit' ? 0 : computeUrgency({
    priority:      data.priority as Task['priority'],
    urgency_curve: (data.urgency_curve ?? 'linear') as Task['urgency_curve'],
    due_date:      data.due_date,
    created_at:    now,
  })

  const { data: task, error } = await db
    .from('tasks')
    .insert({
      title:              data.title,
      project_id:         data.project_id || null,
      priority:           data.priority,
      energy_required:    data.energy_required,
      estimated_minutes:  data.estimated_minutes,
      due_date:           data.due_date,
      urgency_curve:      data.urgency_curve,
      rrule:              data.rrule || null,
      weekly_target:      data.weekly_target ?? null,
      type:               resolvedType,
      status:             'inbox',
      urgency_score,
      created_at:         now,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/projects')
  if (resolvedType === 'habit') revalidatePath('/habits')
  return task
}

// ── Subtask actions ──────────────────────────────────────────────────────────

export type SubtaskRow = {
  id:                string
  title:             string
  status:            string
  estimated_minutes: number | null
  energy_required:   string
  gcal_event_id:     string | null
  scheduled_start:   string | null
  scheduled_end:     string | null
  created_at:        string
}

export async function getSubtasks(parentId: string): Promise<SubtaskRow[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('tasks')
    .select('id, title, status, estimated_minutes, energy_required, gcal_event_id, scheduled_start, scheduled_end, created_at')
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as SubtaskRow[]
}

async function recalcParentEstimate(parentId: string) {
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

export async function createSubtask(
  parentId: string,
  title: string,
  estimatedMinutes?: number | null,
) {
  const db = createServiceClient()
  const { error } = await db.from('tasks').insert({
    parent_id:         parentId,
    title,
    status:            'active',
    type:              'task',
    priority:          1,
    energy_required:   'low',
    urgency_score:     0,
    urgency_curve:     'linear',
    estimated_minutes: estimatedMinutes ?? null,
    created_at:        new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  if (estimatedMinutes) await recalcParentEstimate(parentId)
  revalidatePath('/tasks')
}

export async function updateSubtaskFields(
  subtaskId: string,
  parentId:  string,
  patch: { estimated_minutes?: number | null; energy_required?: string },
) {
  const db = createServiceClient()
  const { error } = await db.from('tasks').update(patch).eq('id', subtaskId)
  if (error) throw new Error(error.message)
  await recalcParentEstimate(parentId)
  revalidatePath('/tasks')
}

export async function toggleSubtask(subtaskId: string, done: boolean) {
  const db = createServiceClient()
  const { error } = await db
    .from('tasks')
    .update({
      status:       done ? 'done' : 'active',
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', subtaskId)
  if (error) throw new Error(error.message)
}

export async function deleteSubtask(subtaskId: string) {
  const db = createServiceClient()
  const { error } = await db.from('tasks').delete().eq('id', subtaskId)
  if (error) throw new Error(error.message)
}
