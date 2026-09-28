'use client'

import Image from 'next/image'
import { useStored, writeStored } from '@/lib/use-stored'

/**
 * "Add Planner to your Home Screen", shown only where it applies.
 *
 * iOS has no install prompt a page can trigger — Safari's Share sheet is the
 * only way in — so the page has to say where the button is. Shown in iOS
 * Safari only: not in the installed app (`standalone`), not on desktop, and
 * not again once dismissed on this device.
 *
 * Read through `useStored`, so the server render (nothing) and the first
 * browser render agree and there is no flash.
 */
const DISMISSED_KEY = 'planner.installHint.dismissed'

function shouldShow(): boolean {
  try {
    const ua = navigator.userAgent
    // iPadOS reports itself as a Mac; a touch screen is what gives it away.
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    return ios && !standalone && window.localStorage.getItem(DISMISSED_KEY) !== '1'
  } catch {
    return false
  }
}

export default function InstallHint() {
  const show = useStored(shouldShow, false)
  if (!show) return null

  function dismiss() {
    writeStored(() => {
      try { window.localStorage.setItem(DISMISSED_KEY, '1') } catch { /* private mode */ }
    })
  }

  return (
    <div role="note" className="shrink-0 flex items-start gap-3 px-4 py-3 border-b border-line bg-surface-sunk text-[13px] leading-snug">
      <Image src="/icons/icon-192.png" alt="" width={32} height={32} unoptimized className="rounded-[8px] shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0 text-ink-2">
        <span className="font-semibold text-ink">Install Planner. </span>
        Tap <ShareGlyph /> Share, then <span className="font-medium">Add to Home Screen</span>.
        It opens full-screen, like an app.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 -mr-1 px-2 py-1.5 rounded-md text-xs font-medium text-ink-muted hover:text-ink hover:bg-track"
      >
        Not now
      </button>
    </div>
  )
}

/** Safari's Share icon, so the instruction points at something recognisable. */
function ShareGlyph() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" aria-label="the Share icon" role="img"
         className="inline-block -mt-0.5 mx-0.5 text-accent-600">
      <path d="M6.5 1v8.5M3.5 4 6.5 1l3 3M2 7H1.5A.5.5 0 0 0 1 7.5v6a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5H11"
            fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
