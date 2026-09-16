'use client'

import { useEffect } from 'react'
import { saveTimezone } from '@/app/actions/scheduling'

/**
 * Reports the browser's timezone to the server once per load.
 *
 * Habit days are local days, and the habits page computes the heatmap on the
 * server — so the zone has to be stored, not read at the point of use. Asking
 * the user to pick it from a list first would mean the app is wrong until they
 * do; the browser already knows.
 *
 * `saveTimezone` returns without writing when nothing changed, so the common
 * case is one cheap call and no revalidation. Settings can still override it,
 * and the next load will report the browser's zone again — which is the right
 * behaviour when the difference is that you've travelled.
 */
export default function TimezoneSync() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return
    // Failure is silent on purpose: nothing the user did caused it, everything
    // falls back to UTC, and Settings shows the stored value.
    saveTimezone(tz).catch(() => {})
  }, [])

  return null
}
