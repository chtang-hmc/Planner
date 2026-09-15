'use client'

import { useState, useTransition } from 'react'
import { confirmSchedule, type ExistingItem } from '@/app/actions/scheduling'
import ScheduleWeekCalendar, { type CalendarBlock } from '@/components/ScheduleWeekCalendar'
import type { SchedulerTask } from '@/lib/scheduler'

export interface PreviewBlock {
  taskId:        string
  taskTitle:     string
  taskPriority:  number
  startISO:      string
  endISO:        string
  segmentIndex:  number
  totalSegments: number
  energyMatch:   boolean
}

interface Props {
  /** True while proposeSchedule is still running — the modal opens immediately. */
  loading?:      boolean
  blocks:        PreviewBlock[]
  unschedulable: SchedulerTask[]
  /** Already on the calendar — shown for context, never modified here. */
  existing:      ExistingItem[]
  onClose:       () => void
  onConfirmed:   () => void
}

/** One row in the merged week view: a proposal, or something already booked. */
type Row =
  | { kind: 'proposed'; key: string; startISO: string; endISO: string; block: PreviewBlock }
  | { kind: 'existing'; key: string; startISO: string; endISO: string; item: ExistingItem }

const PRIORITY_COLORS: Record<number, string> = {
  4: 'bg-red-500',
  3: 'bg-amber-500',
  2: 'bg-sky-500',
  1: 'bg-slate-400',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function formatDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diff  = Math.round((d.setHours(0,0,0,0), d.getTime() - today.setHours(0,0,0,0)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function SchedulePreviewModal({ loading = false, blocks, unschedulable, existing, onClose, onConfirmed }: Props) {
  const [, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [result, setResult]         = useState<{ confirmed: number; failed: number } | null>(null)

  // Everything that isn't a new proposal is selected-out by default? No — the
  // whole proposal starts approved, and unticking rejects individual blocks.
  // Key is stable across drags: the original start, not the current one.
  const blockKey = (b: PreviewBlock) => `${b.taskId}|${b.startISO}`
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  /** Times the user dragged a block to, overriding the proposal. */
  const [moved, setMoved] = useState<Record<string, { startISO: string; endISO: string }>>({})
  const [view, setView] = useState<'calendar' | 'list'>('calendar')

  const effective = (b: PreviewBlock): PreviewBlock => {
    const m = moved[blockKey(b)]
    return m ? { ...b, startISO: m.startISO, endISO: m.endISO } : b
  }

  const approved = blocks.filter(b => !rejected.has(blockKey(b))).map(effective)
  const movedCount = Object.keys(moved).length

  function toggleKey(k: string) {
    setRejected(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  const toggle = (b: PreviewBlock) => toggleKey(blockKey(b))

  // Collapse per title: how many got a block vs how many were left over.
  const leftovers = (() => {
    const placed = new Map<string, number>()
    for (const b of blocks) placed.set(b.taskTitle, (placed.get(b.taskTitle) ?? 0) + 1)
    const missed = new Map<string, number>()
    for (const t of unschedulable) missed.set(t.title, (missed.get(t.title) ?? 0) + 1)
    return [...missed.entries()]
      .map(([title, n]) => ({ title, missed: n, placed: placed.get(title) ?? 0 }))
      .sort((a, b) => (a.placed === 0 ? -1 : 1) - (b.placed === 0 ? -1 : 1) || a.title.localeCompare(b.title))
  })()

  const calendarBlocks: CalendarBlock[] = blocks.map(b => {
    const eff = effective(b)
    return {
      key: blockKey(b),
      block: eff,
      start: new Date(eff.startISO),
      end: new Date(eff.endISO),
      rejected: rejected.has(blockKey(b)),
    }
  })

  // Merge proposals with what's already on the week, then group by day, so the
  // whole horizon is reviewable rather than just the new blocks in isolation.
  const rows: Row[] = [
    ...blocks.map(b => {
      const eff = effective(b)
      return { kind: 'proposed' as const, key: blockKey(b), startISO: eff.startISO, endISO: eff.endISO, block: eff }
    }),
    ...existing.map(e => ({ kind: 'existing' as const, key: `e|${e.id}|${e.startISO}`, startISO: e.startISO, endISO: e.endISO, item: e })),
  ].sort((a, b) => a.startISO.localeCompare(b.startISO))

  const byDay = new Map<string, Row[]>()
  for (const r of rows) {
    const key = new Date(r.startISO).toDateString()
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(r)
  }

  function handleConfirm() {
    setConfirming(true)
    startTransition(async () => {
      const res = await confirmSchedule(
        approved.map(b => ({ taskId: b.taskId, startISO: b.startISO, endISO: b.endISO }))
      )
      setResult(res)
      setConfirming(false)
      if (res.confirmed > 0) onConfirmed()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-5xl max-h-[88vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Your week
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {blocks.length} new block{blocks.length !== 1 ? 's' : ''}
              {existing.length > 0 && ` · ${existing.length} already booked`}
              {leftovers.length > 0 && ` · ${leftovers.length} didn't fully fit`}
              {movedCount > 0 && ` · ${movedCount} moved`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {(['calendar', 'list'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    view === v
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none"
          >
            ×
          </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-6">
              {/* Indeterminate — the work is one server round trip, so there is
                  no real percentage to report. The point is that the modal
                  appears at once instead of the button sitting dead. */}
              <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-6">
                <div className="h-full w-1/3 rounded-full bg-accent-500 animate-schedule-sweep" />
              </div>
              <p className="text-xs text-slate-400 text-center mb-6">
                Reading your calendar and finding free time…
              </p>
              {/* Skeleton week */}
              <div className="flex gap-2">
                {Array.from({ length: 7 }, (_, d) => (
                  <div key={d} className="flex-1 flex flex-col gap-2">
                    <div className="h-3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    {Array.from({ length: (d % 3) + 1 }, (_, i) => (
                      <div
                        key={i}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse"
                        style={{ height: 30 + ((d + i) % 3) * 22, animationDelay: `${(d * 3 + i) * 60}ms` }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-slate-400 text-sm">Nothing scheduled, and nothing on the calendar this week.</p>
              <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">
                Check that tasks have time estimates and working hours are configured.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {view === 'calendar' ? (
                <ScheduleWeekCalendar
                  proposals={calendarBlocks}
                  existing={existing}
                  onToggle={toggleKey}
                  onMove={(key, start, end) =>
                    setMoved(prev => ({ ...prev, [key]: { startISO: start.toISOString(), endISO: end.toISOString() } }))
                  }
                />
              ) : (
                <>
              {Array.from(byDay.entries()).map(([dayKey, dayRows]) => (
                <div key={dayKey}>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    {formatDate(dayRows[0].startISO)}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {dayRows.map(r => {
                      if (r.kind === 'existing') {
                        return (
                          <div
                            key={r.key}
                            className="flex items-center gap-3 px-3 py-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 opacity-70"
                          >
                            <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">
                              {r.item.kind === 'event' ? '📅' : '🎯'}
                            </span>
                            <span className="text-xs font-mono text-slate-400 shrink-0 w-24">
                              {formatTime(r.startISO)} – {formatTime(r.endISO)}
                            </span>
                            <span className="flex-1 text-sm text-slate-500 dark:text-slate-400 truncate">
                              {r.item.title}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {r.item.kind === 'event' ? 'on calendar' : 'already booked'}
                            </span>
                          </div>
                        )
                      }

                      const b = r.block
                      const isRejected = rejected.has(r.key)
                      return (
                        <label
                          key={r.key}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                            isRejected
                              ? 'bg-transparent border-slate-200 dark:border-slate-800 opacity-45'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!isRejected}
                            onChange={() => toggle(b)}
                            className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 accent-accent-500 shrink-0"
                          />
                          <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[b.taskPriority] ?? 'bg-slate-400'}`} />
                          <span className={`text-xs font-mono shrink-0 w-24 ${isRejected ? 'line-through text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
                            {formatTime(b.startISO)} – {formatTime(b.endISO)}
                          </span>
                          <span className={`flex-1 text-sm truncate ${isRejected ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                            {b.taskTitle}
                          </span>
                          {b.totalSegments > 1 && (
                            <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                              {b.segmentIndex + 1}/{b.totalSegments}
                            </span>
                          )}
                          {!b.energyMatch && (
                            <span title="Energy mismatch — scheduled anyway" className="text-[10px] text-amber-400 shrink-0">⚡?</span>
                          )}
                          <span className="text-[10px] text-accent-500 shrink-0 font-medium">new</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
                </>
              )}

              {/* Didn't fit — grouped, with what DID get scheduled.
                  A 7x/week habit into 6 remaining days leaves leftovers every
                  time; listing each one as a separate failure is noise when
                  most of them were placed. */}
              {leftovers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    Didn't fit
                  </p>
                  <div className="flex flex-col gap-1">
                    {leftovers.map(l => (
                      <div
                        key={l.title}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                          l.placed > 0
                            ? 'border-slate-200 dark:border-slate-700'
                            : 'border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20'
                        }`}
                      >
                        <span className={`text-xs ${l.placed > 0 ? 'text-slate-400' : 'text-amber-500'}`}>
                          {l.placed > 0 ? '◐' : '✕'}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{l.title}</span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {l.placed > 0
                            ? `${l.placed} of ${l.placed + l.missed} scheduled`
                            : l.missed > 1 ? `${l.missed} sessions couldn't fit` : "couldn't fit"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
          {result ? (
            <div className="flex-1 text-center">
              <p className={`text-sm font-medium ${result.failed > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                {result.confirmed} blocked on calendar{result.failed > 0 && `, ${result.failed} failed`}
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || confirming || approved.length === 0}
                className="flex-1 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {loading
                  ? 'Working…'
                  : confirming
                  ? 'Scheduling…'
                  : approved.length === blocks.length
                    ? `Confirm ${approved.length} block${approved.length !== 1 ? 's' : ''}`
                    : `Confirm ${approved.length} of ${blocks.length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
