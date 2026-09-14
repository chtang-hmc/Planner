'use client'

import { useState, useTransition } from 'react'
import { CalendarEvent } from '@/types'
import { triggerCalendarSync, disconnectCalendar } from '@/app/actions/calendar'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return 'All day'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const today    = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const date     = new Date(d); date.setHours(0,0,0,0)

  if (date.getTime() === today.getTime())    return 'Today'
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const key = new Date(e.start_time).toDateString()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return Array.from(map.entries())
}

function eventDuration(e: CalendarEvent): string {
  if (e.all_day) return ''
  const mins = Math.round(
    (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60_000
  )
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ── Not-connected state ───────────────────────────────────────────────────────

function ConnectPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
      <div className="text-3xl mb-3">📅</div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
        Connect Google Calendar
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-5 leading-relaxed">
        See your events alongside tasks so you know when you have free focus time.
      </p>
      <a
        href="/api/auth/google"
        className="inline-block px-4 py-2 rounded-xl bg-teal-500 text-white text-xs font-semibold hover:bg-teal-600 transition-colors"
      >
        Connect Calendar
      </a>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  events: CalendarEvent[]
  connected: boolean
}

export default function CalendarPanel({ events, connected }: Props) {
  const [isPending, startTransition] = useTransition()
  const [syncError, setSyncError]    = useState<string | null>(null)

  function handleSync() {
    setSyncError(null)
    startTransition(async () => {
      try { await triggerCalendarSync() }
      catch (e) { setSyncError(e instanceof Error ? e.message : 'Sync failed') }
    })
  }

  function handleDisconnect() {
    startTransition(() => disconnectCalendar())
  }

  // Show events that haven't ended yet — this includes in-progress events
  const now = new Date()
  const upcoming = events.filter(e => new Date(e.end_time) >= now)
  const grouped  = groupByDay(upcoming)

  return (
    <aside className="w-64 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
          Calendar
        </span>
        {connected && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleSync}
              disabled={isPending}
              title="Sync now"
              className="p-1 rounded text-slate-400 hover:text-teal-500 disabled:opacity-40 transition-colors text-xs"
            >
              {isPending ? '…' : '↺'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={isPending}
              title="Disconnect"
              className="p-1 rounded text-slate-300 hover:text-red-400 disabled:opacity-40 transition-colors text-xs"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!connected ? (
          <ConnectPrompt />
        ) : grouped.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-400">No upcoming events</p>
            {syncError && <p className="text-xs text-red-400 mt-2">{syncError}</p>}
          </div>
        ) : (
          <div className="py-2">
            {syncError && (
              <p className="text-xs text-red-400 px-4 pb-2">{syncError}</p>
            )}
            {grouped.map(([dateStr, dayEvents]) => (
              <div key={dateStr} className="mb-1">
                {/* Day label */}
                <div className="px-4 py-1.5 sticky top-0 bg-white dark:bg-slate-900 z-10">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {formatDate(dayEvents[0].start_time)}
                  </span>
                </div>
                {/* Events */}
                {dayEvents.map(e => (
                  <div
                    key={e.id}
                    className="mx-3 mb-1 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                  >
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-snug">
                      {e.title}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                      {formatTime(e.start_time, e.all_day)}
                      {!e.all_day && eventDuration(e) && (
                        <span className="ml-1.5 text-slate-300 dark:text-slate-600">
                          · {eventDuration(e)}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
