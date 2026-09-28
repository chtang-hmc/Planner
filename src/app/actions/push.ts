'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { sendToAll, type SendResult } from '@/lib/push'

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
