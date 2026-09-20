'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Recording whether a calendar event is already doing a task.
 *
 * The matcher guesses from the title; this is where the person answers. Only
 * the answer is stored — suggestions are recomputed on every render, so there
 * is no queue of stale guesses to expire (migration 0019).
 */
async function decide(
  taskId: string,
  eventId: string,
  status: 'confirmed' | 'rejected',
): Promise<{ error?: string }> {
  const db = createServiceClient()
  const { error } = await db
    .from('task_event_links')
    .upsert({ task_id: taskId, event_id: eventId, status, decided_at: new Date().toISOString() },
            { onConflict: 'task_id,event_id' })

  if (error) {
    console.error('task_event_links:', error.message)
    return { error: 'Could not save — run migration 0019 first.' }
  }

  // Home only. Confirming changes `dueTotal`, which is the headline number on
  // exactly one screen today.
  revalidatePath('/')
  return {}
}

/**
 * Yes — this event is doing this task.
 *
 * The task's minutes leave `dueTotal` immediately: its time is already on the
 * calendar, so counting it as owed as well is the double-count this exists to
 * remove.
 */
export async function confirmTaskEventLink(taskId: string, eventId: string) {
  return decide(taskId, eventId, 'confirmed')
}

/**
 * No — and never ask about this pair again.
 *
 * The load-bearing half. Without a record of "no" the same wrong pair is
 * offered every morning, and a prompt that cannot be dismissed permanently is
 * one people learn to ignore.
 */
export async function rejectTaskEventLink(taskId: string, eventId: string) {
  return decide(taskId, eventId, 'rejected')
}
