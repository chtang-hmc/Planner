'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { computeUrgency, Task } from '@/types'

// Fields whose changes require an urgency recompute
const URGENCY_FIELDS = new Set(['priority', 'due_date', 'urgency_curve'])

// ── Complete a task + log reflection ────────────────────────────────────────
export async function completeTask(
  taskId: string,
  actualMinutes: number | null,
  estimateAccurate: boolean | null,
  blockerNote: string | null
) {
  const db = createServiceClient()

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

  // Recalculate bias ratio for the task's project
  const { data: task } = await db.from('tasks').select('project_id, estimated_minutes').eq('id', taskId).single()
  if (task && actualMinutes != null && task.estimated_minutes) {
    const { data: profile } = await db
      .from('estimation_profiles')
      .select('*')
      .eq('project_id', task.project_id)
      .single()

    if (profile) {
      const newCount = profile.sample_count + 1
      // Running average of bias ratio
      const newRatio = (profile.bias_ratio * profile.sample_count + actualMinutes / task.estimated_minutes) / newCount
      await db.from('estimation_profiles').update({ sample_count: newCount, bias_ratio: newRatio, updated_at: new Date().toISOString() }).eq('project_id', task.project_id)
    } else {
      await db.from('estimation_profiles').insert({
        project_id: task.project_id,
        sample_count: 1,
        bias_ratio: actualMinutes / task.estimated_minutes,
      })
    }
  }

  revalidatePath('/tasks')
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
}) {
  const db = createServiceClient()
  const now = new Date().toISOString()
  const urgency_score = computeUrgency({
    priority:      data.priority as Task['priority'],
    urgency_curve: (data.urgency_curve ?? 'linear') as Task['urgency_curve'],
    due_date:      data.due_date,
    created_at:    now,
  })

  const { data: task, error } = await db
    .from('tasks')
    .insert({
      ...data,
      project_id: data.project_id || null,
      type: 'task',
      status: 'inbox',
      urgency_score,
      created_at: now,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/projects')
  return task
}
