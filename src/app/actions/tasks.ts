'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

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

  // Log focus session with reflection
  if (actualMinutes != null || estimateAccurate != null) {
    await db.from('focus_sessions').insert({
      task_id: taskId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_minutes: actualMinutes,
      estimate_accurate: estimateAccurate,
      blocker_note: blockerNote,
    })
  }

  // Recalculate bias ratio for the task's project
  const { data: task } = await db.from('tasks').select('project_id, estimated_minutes').eq('id', taskId).single()
  if (task && actualMinutes && task.estimated_minutes) {
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
  const { error } = await db.from('tasks').update(data).eq('id', taskId)
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
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
  const { data: task, error } = await db
    .from('tasks')
    .insert({
      ...data,
      project_id: data.project_id || null,
      type: 'task',
      status: 'inbox',
      urgency_score: data.priority * 10,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/projects')
  return task
}
