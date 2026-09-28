import webpush, { WebPushError } from 'web-push'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Sending a web push to every subscribed device.
 *
 * Each subscription is one browser that accepted notifications (see migration
 * 0023). A send encrypts the payload with that browser's keys and POSTs it to
 * its push service, signed with this app's VAPID key so the service knows who
 * is sending. The public half of that key is what the browser subscribed with,
 * so the three `VAPID_*` variables have to stay the same pair for as long as
 * the subscriptions they created are wanted: new keys means every device
 * enables notifications again.
 */
export interface PushMessage {
  title: string
  body:  string
  /** Where tapping it goes. A path in the app. */
  url?:  string
  /** A later message with the same tag replaces this one instead of stacking. */
  tag?:  string
}

export interface SendResult {
  sent:   number
  /** Subscriptions the push service said no longer exist, now deleted. */
  gone:   number
  failed: number
}

/**
 * What a push service's answer means for the row that produced it.
 *
 * 404 and 410 are the only way to learn a subscription is dead: the app was
 * deleted from the home screen, or notifications were turned off in iOS
 * Settings. Anything else — a 5xx, a timeout, 429 — is kept and retried by the
 * next send, because a push service having a bad minute is not a dead phone.
 */
export function outcomeOf(statusCode: number | undefined): 'sent' | 'gone' | 'failed' {
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) return 'sent'
  if (statusCode === 404 || statusCode === 410) return 'gone'
  return 'failed'
}

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
}

export async function sendToAll(message: PushMessage): Promise<SendResult> {
  if (!pushConfigured()) throw new Error('Push is not configured: set the three VAPID_* environment variables')
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )

  const db = createServiceClient()
  const { data: rows, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth')
  if (error) throw new Error(error.message)

  const payload = JSON.stringify(message)
  const now = new Date().toISOString()
  const result: SendResult = { sent: 0, gone: 0, failed: 0 }

  // One device at a time would make a slow push service everyone's problem.
  await Promise.all((rows ?? []).map(async row => {
    let status: number | undefined
    let detail = ''
    try {
      const res = await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        // An hour: a reminder that arrives the next morning is worse than none.
        { TTL: 60 * 60, urgency: 'high' },
      )
      status = res.statusCode
    } catch (err) {
      status = err instanceof WebPushError ? err.statusCode : undefined
      detail = err instanceof WebPushError ? `${err.statusCode} ${err.body}`.trim() : String(err)
    }

    const outcome = outcomeOf(status)
    result[outcome]++
    if (outcome === 'gone') {
      await db.from('push_subscriptions').delete().eq('endpoint', row.endpoint)
    } else {
      await db.from('push_subscriptions')
        .update(outcome === 'sent' ? { last_sent_at: now, last_error: null } : { last_error: detail.slice(0, 500) })
        .eq('endpoint', row.endpoint)
    }
  }))

  return result
}
