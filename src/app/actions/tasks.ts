'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { computeUrgency, Task } from '@/types'
import { getNextOccurrence } from '@/lib/rrule-utils'

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
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)
      nextDue = tomorrow.toISOString()
    }

    if (nextDue) {
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
        due_date:           nextDue,
        created_at:         now,
      })
    }

    // Upsert habit streak
    const todayStr = today.toISOString().slice(0, 10)
    const { data: streak } = await db
      .from('habit_streaks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle()

    if (streak) {
      // Check if last completion was yesterday (consecutive day = increment)
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)
      const consecutive = streak.last_completed === yesterdayStr
      const newStreak = consecutive ? streak.current_streak + 1 : 1
      await db.from('habit_streaks').update({
        current_streak: newStreak,
        longest_streak: Math.max(newStreak, streak.longest_streak),
        last_completed: todayStr,
      }).eq('task_id', taskId)
    } else {
      await db.from('habit_streaks').insert({
        task_id: taskId,
        current_streak: 1,
        longest_streak: 1,
        last_completed: todayStr,
      })
    }
  }

  revalidatePath('/tasks')
  revalidatePath('/habits')
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
