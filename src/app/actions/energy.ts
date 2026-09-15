'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

export async function logEnergy(
  level: 1 | 2 | 3 | 4 | 5,
  taskId?: string | null,
) {
  const db = createServiceClient()
  const { error } = await db.from('energy_logs').insert({
    level,
    task_id:   taskId ?? null,
    logged_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath('/analytics')
}
