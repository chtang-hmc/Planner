'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { sendToAll, type SendResult, type PushMessage } from '@/lib/push'
import { normalizePrefs, type NotifyPrefs } from '@/lib/notify'
import { previewDay } from '@/lib/notify-run'
import { DEFAULT_BUFFER_MINUTES } from '@/lib/home'

/**
 * The browser's half of a subscription, as `PushSubscription.toJSON()` gives
 * it. Validated here because a Server Action is a public POST endpoint and its
 * argument is whatever the request body says.
 */
export interface SubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

function isSubscription(v: unknown): v is SubscriptionJSON {
  const s = v as SubscriptionJSON | null
  return !!s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://')
    && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
}

export async function savePushSubscription(sub: SubscriptionJSON, userAgent: string) {
  if (!isSubscription(sub)) throw new Error('Not a push subscription')
  const { error } = await createServiceClient().from('push_subscriptions').upsert({
    endpoint:   sub.endpoint,
    p256dh:     sub.keys.p256dh,
    auth:       sub.keys.auth,
    user_agent: userAgent.slice(0, 300),
    last_error: null,
  }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
}

export async function removePushSubscription(endpoint: string) {
  if (typeof endpoint !== 'string') return
  const { error } = await createServiceClient().from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw new Error(error.message)
}

export async function sendTestPush(): Promise<SendResult> {
  return sendToAll({
    title: 'Planner',
    body:  'Notifications are on. This is what a reminder will look like.',
    url:   '/settings',
    tag:   'test',
  })
}

/**
 * Which notifications, and when. Normalized on the way in, so whatever the
 * request says, what is stored is a complete and valid set.
 */
export async function saveNotificationPrefs(raw: NotifyPrefs): Promise<{ error?: string }> {
  const prefs = normalizePrefs(raw)
  const db = createServiceClient()
  const { data } = await db.from('user_scheduling_config').select('id').limit(1).maybeSingle()
  const { error } = data
    ? await db.from('user_scheduling_config').update({ notification_prefs: prefs }).eq('id', data.id)
    : await db.from('user_scheduling_config').insert({
        max_session_minutes: 90, buffer_minutes: DEFAULT_BUFFER_MINUTES, notification_prefs: prefs,
      })
  if (error) {
    console.error('saveNotificationPrefs:', error.message)
    return { error: 'Could not save. Run migration 0024_notifications.sql first.' }
  }
  revalidatePath('/settings')
  return {}
}

/** Everything today would send, whatever the time, for the preview in Settings. Sends nothing. */
export async function previewNotifications(): Promise<PushMessage[]> {
  return (await previewDay()).map(p => p.message)
}
