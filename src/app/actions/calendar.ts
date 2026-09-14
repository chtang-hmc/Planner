'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { syncCalendarEvents } from '@/lib/google-calendar'

export async function triggerCalendarSync() {
  // Call the sync logic directly instead of via HTTP fetch so this
  // works in any serverless environment regardless of NEXT_PUBLIC_SITE_URL.
  await syncCalendarEvents()
  revalidatePath('/tasks')
}

export async function disconnectCalendar() {
  const db = createServiceClient()
  await db.from('user_integrations').delete().eq('provider', 'google')
  revalidatePath('/tasks')
}
