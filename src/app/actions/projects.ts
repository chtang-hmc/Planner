'use server'

import { createServiceClient } from '@/lib/supabase/server'
import type { Project } from '@/types'
import { revalidatePath } from 'next/cache'
import { revalidateTaskViews } from '@/lib/revalidate'

/**
 * Returns the created row so callers can select it straight away — the add-task
 * flow creates a project inline and needs its id without a round trip.
 */
export async function createProject(name: string, color: string): Promise<Project> {
  const db = createServiceClient()
  const { data, error } = await db.from('projects').insert({
    name:     name.trim(),
    color,
    archived: false,
  }).select().single()
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
  revalidateTaskViews()
  return data as Project
}

export async function updateProject(id: string, name: string, color: string) {
  const db = createServiceClient()
  const { error } = await db.from('projects').update({ name: name.trim(), color }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
  revalidateTaskViews()
}

export async function archiveProject(id: string) {
  const db = createServiceClient()
  const { error } = await db.from('projects').update({ archived: true }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
  revalidateTaskViews()
}
