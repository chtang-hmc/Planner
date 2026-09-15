'use server'

import { revalidatePath } from 'next/cache'
import { blockLabel } from '@/lib/scheduler'
import { createServiceClient } from '@/lib/supabase/server'
import {
  syncCalendarEvents,
  getValidToken,
  createTaskBlock,
  updateTaskBlock,
  deleteTaskBlock,
} from '@/lib/google-calendar'
import { markScheduleManual } from '@/app/actions/scheduling'

export async function triggerCalendarSync() {
  await syncCalendarEvents()
  revalidatePath('/tasks')
}

export async function disconnectCalendar() {
  const db = createServiceClient()
  await db.from('user_integrations').delete().eq('provider', 'google')
  revalidatePath('/tasks')
}

// ── Task scheduling ───────────────────────────────────────────────────────────

/**
 * Block time on GCal for a task.
 * Creates a new event (or replaces an existing block) and stores the event id
 * + scheduled times back on the task row.
 */
export async function scheduleTask(
  taskId: string,
  startISO: string,
  endISO: string,
): Promise<{ error?: string }> {
  const token = await getValidToken()
  if (!token) return { error: 'Google Calendar not connected' }

  const db = createServiceClient()

  // Fetch enough task data to build the GCal event
  const { data: task, error: fetchErr } = await db
    .from('tasks')
    .select('title, description, priority, gcal_event_id, parent_id')
    .eq('id', taskId)
    .single()

  if (fetchErr || !task) return { error: 'Task not found' }

  // Same "Parent - Subtask" label the scheduler uses, so a manually placed
  // block reads identically to an auto-scheduled one.
  let title = task.title
  if (task.parent_id) {
    const { data: parent } = await db
      .from('tasks').select('title').eq('id', task.parent_id).maybeSingle()
    title = blockLabel(task.title, parent?.title)
  }

  try {
    // If a block already exists for this task, update it instead of creating a new one
    if (task.gcal_event_id) {
      await updateTaskBlock(token.access_token, task.gcal_event_id, startISO, endISO)
      await db
        .from('tasks')
        .update({ scheduled_start: startISO, scheduled_end: endISO })
        .eq('id', taskId)
    } else {
      const gcalEventId = await createTaskBlock(
        token.access_token,
        { title, description: task.description, priority: task.priority },
        startISO,
        endISO,
      )
      await db
        .from('tasks')
        .update({ gcal_event_id: gcalEventId, scheduled_start: startISO, scheduled_end: endISO })
        .eq('id', taskId)
    }
    // Mark as manually scheduled so the algorithm won't overwrite it on re-run
    await markScheduleManual(taskId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'GCal error' }
  }

  revalidatePath('/tasks')
  revalidatePath('/projects')
  revalidatePath('/habits')
  return {}
}

/**
 * Remove the GCal block for a task and clear the scheduling fields.
 */
export async function unscheduleTask(taskId: string): Promise<{ error?: string }> {
  const db = createServiceClient()

  const { data: task } = await db
    .from('tasks')
    .select('gcal_event_id')
    .eq('id', taskId)
    .single()

  if (task?.gcal_event_id) {
    const token = await getValidToken()
    if (token) {
      try {
        await deleteTaskBlock(token.access_token, task.gcal_event_id)
      } catch {
        // Ignore — the event may already be gone; we still clear our DB fields
      }
    }
  }

  await db
    .from('tasks')
    .update({ gcal_event_id: null, scheduled_start: null, scheduled_end: null })
    .eq('id', taskId)

  revalidatePath('/tasks')
  revalidatePath('/projects')
  revalidatePath('/habits')
  return {}
}
