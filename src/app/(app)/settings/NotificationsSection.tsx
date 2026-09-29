'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  previewNotifications, removePushSubscription, saveNotificationPrefs, savePushSubscription, sendTestPush,
  type SubscriptionJSON,
} from '@/app/actions/push'
import { KIND_LABELS, NOTIFY_KINDS, formatSendTime, type NotifyKind, type NotifyPrefs } from '@/lib/notify'
import type { PushMessage } from '@/lib/push'

/**
 * Turning push notifications on for this device.
 *
 * Per device, because a subscription is: the installed iPhone app and a
 * laptop's browser subscribe separately, and each shows its own state here.
 * The server keeps every subscription and sends to all of them.
 *
 * On iOS this only works inside the home-screen app — Safari in a tab has no
 * `PushManager` at all — so a tab gets told where to go rather than a button
 * that cannot work. And `requestPermission` must be the first thing the tap
 * does: iOS only allows the prompt during the tap itself, and an `await`
 * before it can use that up.
 */
type State =
  | 'loading'
  | 'ios-tab'       // iOS, but in Safari rather than the installed app
  | 'unsupported'   // no service worker or push in this browser
  | 'unconfigured'  // the deployment has no VAPID key
  | 'denied'        // the user said no; only the OS can undo that
  | 'off'
  | 'on'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** The VAPID key is base64url; `subscribe` wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function register(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}

async function currentState(): Promise<State> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIOS() && !isStandalone() ? 'ios-tab' : 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await register()
  const sub = await reg.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export default function NotificationsSection({ prefs }: { prefs: NotifyPrefs }) {
  const [state, setState]     = useState<State>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, startBusy]     = useTransition()

  useEffect(() => {
    currentState().then(setState, () => setState('unsupported'))
  }, [])

  function enable() {
    setMessage(null)
    // First, before any await — see the note at the top.
    const asked = Notification.requestPermission()
    startBusy(async () => {
      try {
        if (await asked !== 'granted') { setState(Notification.permission === 'denied' ? 'denied' : 'off'); return }
        const reg = await register()
        const sub = await reg.pushManager.getSubscription()
          ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
        await savePushSubscription(sub.toJSON() as SubscriptionJSON, navigator.userAgent)
        setState('on')
      } catch (err) {
        setMessage(`Couldn't turn them on: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  function disable() {
    setMessage(null)
    startBusy(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/')
        const sub = await reg?.pushManager.getSubscription()
        if (sub) {
          await removePushSubscription(sub.endpoint)
          await sub.unsubscribe()
        }
        setState('off')
      } catch (err) {
        setMessage(`Couldn't turn them off: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  function test() {
    setMessage(null)
    startBusy(async () => {
      try {
        const r = await sendTestPush()
        setMessage(r.sent > 0
          ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.${r.failed ? ` ${r.failed} failed.` : ''}`
          : r.failed > 0 ? `Sending failed on ${r.failed} device${r.failed === 1 ? '' : 's'}.`
          : 'No devices are subscribed.')
      } catch (err) {
        setMessage(`Couldn't send: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  const button = 'px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40'
  const primary = `${button} bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold hover:opacity-80`
  const quiet = `${button} border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400`

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Notifications</h2>
      <p className="text-xs text-slate-400 mb-4">
        Reminders on this device&apos;s lock screen. Each device is turned on separately.
      </p>

      {state === 'loading' && <p className="text-sm text-slate-400">Checking this device…</p>}

      {state === 'ios-tab' && (
        <Note>
          On iPhone, notifications only work in the installed app. Add Planner to your Home Screen
          (Share, then Add to Home Screen), open it from there, and come back to this page.
        </Note>
      )}

      {state === 'unsupported' && <Note>This browser can&apos;t receive push notifications.</Note>}

      {state === 'unconfigured' && (
        <Note>This deployment has no push key yet. Set the three <code>VAPID_*</code> environment variables and redeploy.</Note>
      )}

      {state === 'denied' && (
        <Note>
          Notifications were declined on this device, and only the system can undo that. On iPhone:
          Settings → Notifications → Planner → Allow Notifications.
        </Note>
      )}

      {state === 'off' && (
        <button type="button" onClick={enable} disabled={busy} className={primary}>
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}

      {state === 'on' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-green-700 dark:text-green-300 mr-2">On for this device</span>
          <button type="button" onClick={test} disabled={busy} className={quiet}>Send a test</button>
          <button type="button" onClick={disable} disabled={busy}
                  className={`${button} border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800`}>
            Turn off
          </button>
        </div>
      )}

      {message && <p role="status" className="mt-3 text-xs text-slate-500 dark:text-slate-400">{message}</p>}

      <Schedule initial={prefs} />
    </section>
  )
}

// ── What gets sent, and when ─────────────────────────────────────────────────

/**
 * The switches, grouped by the message they belong to. Saved on every change:
 * there is no form to submit, and a switch that needs a second tap to stick
 * is one that gets left unsaved. Shared by every device, unlike the on/off
 * above, because the schedule belongs to the account.
 */
const SLOTS: { id: 'morning' | 'habits' | 'wrapUp' | 'instant'; label: string; at?: 'morningAt' | 'habitsAt' | 'wrapUpAt' }[] = [
  { id: 'morning', label: 'Morning summary', at: 'morningAt' },
  { id: 'habits',  label: 'Habit reminder',  at: 'habitsAt'  },
  { id: 'wrapUp',  label: 'Evening wrap-up', at: 'wrapUpAt'  },
  { id: 'instant', label: 'As it happens' },
]

const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromClock = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

function Schedule({ initial }: { initial: NotifyPrefs }) {
  const [prefs, setPrefs]     = useState(initial)
  const [status, setStatus]   = useState<string | null>(null)
  const [preview, setPreview] = useState<PushMessage[] | null>(null)
  const [pending, start]      = useTransition()

  function save(next: NotifyPrefs) {
    setPrefs(next)
    setStatus(null)
    start(async () => {
      const r = await saveNotificationPrefs(next)
      setStatus(r.error ?? 'Saved')
    })
  }

  function toggle(k: NotifyKind) { save({ ...prefs, on: { ...prefs.on, [k]: !prefs.on[k] } }) }

  function showPreview() {
    start(async () => {
      try { setPreview(await previewNotifications()) }
      catch (err) { setStatus(`Couldn't build the preview: ${err instanceof Error ? err.message : String(err)}`) }
    })
  }

  return (
    <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">What to send</h3>
        <span role="status" className="text-xs text-slate-400">{pending ? 'Saving…' : status}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SLOTS.map(slot => {
          const kinds = NOTIFY_KINDS.filter(k => KIND_LABELS[k].slot === slot.id)
          return (
            <fieldset key={slot.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{slot.label}</legend>
              {slot.at && (
                <label className="flex items-center gap-2 mb-2 text-sm text-slate-600 dark:text-slate-400">
                  At
                  <input
                    type="time" step={300}
                    value={toClock(prefs[slot.at])}
                    onChange={e => { if (e.target.value) save({ ...prefs, [slot.at!]: fromClock(e.target.value) }) }}
                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
                  />
                  <span className="text-xs text-slate-400">({formatSendTime(prefs[slot.at])})</span>
                </label>
              )}
              <ul className="flex flex-col gap-1.5">
                {kinds.map(k => (
                  <li key={k}>
                    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={prefs.on[k]} onChange={() => toggle(k)} className="mt-0.5 accent-accent-500" />
                      <span className="flex-1">
                        {KIND_LABELS[k].label}
                        {k === 'inbox' && prefs.on.inbox && (
                          <span className="ml-1 text-xs text-slate-400">
                            at{' '}
                            <input
                              type="number" min={1} max={99}
                              value={prefs.inboxThreshold}
                              onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) save({ ...prefs, inboxThreshold: n }) }}
                              aria-label="Inbox size that triggers the line"
                              className="w-12 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums"
                            />{' '}or more
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )
        })}
      </div>

      <div className="mt-4">
        <button type="button" onClick={showPreview} disabled={pending}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-400 hover:border-accent-400 hover:text-accent-600 disabled:opacity-40">
          Preview today&apos;s messages
        </button>
        {preview && (
          <ul className="mt-3 flex flex-col gap-2">
            {preview.length === 0 && <li className="text-sm text-slate-400">Nothing would be sent today with these settings.</li>}
            {preview.map(m => (
              <li key={m.tag ?? m.title} className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{m.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-600 dark:text-slate-400">
      {children}
    </p>
  )
}
