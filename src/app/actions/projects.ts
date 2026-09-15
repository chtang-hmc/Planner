'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createProject(name: string, color: string) {
  const db = createServiceClient()
  const { error } = await db.from('projects').insert({
    name:     name.trim(),
    color,
    archived: false,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
}

export async function updateProject(id: string, name: string, color: string) {
  const db = createServiceClient()
  const { error } = await db.from('projects').update({ name: name.trim(), color }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
  revalidatePath('/tasks')
}

export async function archiveProject(id: string) {
  const db = createServiceClient()
  const { error } = await db.from('projects').update({ archived: true }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
  revalidatePath('/tasks')
}
