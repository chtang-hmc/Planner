/*
 * Planner's service worker. It does one job: receive a push and show it.
 *
 * No caching, no offline mode. A service worker that caches pages is a second
 * copy of the app that can go stale, and nothing here asked for offline. This
 * one exists because iOS delivers web push only to an installed app with a
 * registered worker.
 *
 * The payload is the JSON `lib/push.ts` sends: { title, body, url, tag }.
 * iOS revokes permission from a page that receives a push and shows nothing,
 * so a payload that fails to parse still shows *something*.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }

  const title = data.title || 'Planner'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    // Same tag replaces rather than stacks: a reminder re-sent for the same
    // task updates the one on the lock screen.
    tag:  data.tag || undefined,
    icon: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Reuse the app if it is already open, rather than stacking a second copy.
    for (const client of open) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client && client.url !== url) await client.navigate(url)
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
