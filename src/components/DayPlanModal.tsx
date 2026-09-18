'use client'

import { useState, useTransition } from 'react'
import ScheduleWeekCalendar, { type CalendarBlock } from '@/components/ScheduleWeekCalendar'
import { confirmSchedule, type ExistingItem } from '@/app/actions/scheduling'
import type { SchedulerTask } from '@/lib/scheduler'
import type { PreviewBlock } from './SchedulePreviewModal'

const ENERGY_ICON: Record<string, string> = { low: '🌿', medium: '⚡', high: '🔥' }
const PRIORITY_DOT: Record<number, string> = {
  4: 'bg-red-500', 3: 'bg-amber-500', 2: 'bg-sky-500', 1: 'bg-slate-400',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function fmtDur(mins: number | null) {
  if (!mins) return ''
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

interface SerializedAttackItem {
  taskId:           string
  taskTitle:        string
  priority:         number
  urgencyScore:     number
  durationMinutes:  number | null
  energyRequired:   string
  scheduledStartISO: string | null
  isScheduled:      boolean
  energyMatchNow:   boolean
  rank:             number
}

interface Props {
  existing:       ExistingItem[]
  attackList:     SerializedAttackItem[]
  proposedBlocks: PreviewBlock[]
  unschedulable:  SchedulerTask[]
  dateStr:        string   // YYYY-MM-DD local date being planned
  onClose:        () => void
  onConfirmed:    () => void
}

export default function DayPlanModal({
  existing,
  attackList,
  proposedBlocks,
  unschedulable,
  dateStr,
  onClose,
  onConfirmed,
}: Props) {
  const [, startTransition] = useTransition()
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const blockKey = (b: PreviewBlock) => `${b.taskId}|${b.startISO}`
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [moved, setMoved] = useState<Record<string, { startISO: string; endISO: string }>>({})

  const effective = (b: PreviewBlock): PreviewBlock => {
    const m = moved[blockKey(b)]
    return m ? { ...b, startISO: m.startISO, endISO: m.endISO } : b
  }
  const approved = proposedBlocks.filter(b => !rejected.has(blockKey(b))).map(effective)
  const calendarBlocks: CalendarBlock[] = proposedBlocks.map(b => {
    const eff = effective(b)
    return { key: blockKey(b), block: eff, start: new Date(eff.startISO), end: new Date(eff.endISO),
             rejected: rejected.has(blockKey(b)) }
  })

  const [confirming, setConfirming] = useState(false)
  const [confirmed,  setConfirmed]  = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  function handleConfirm() {
    if (approved.length === 0) return
    setConfirming(true)
    setConfirmError(null)
    startTransition(async () => {
      try {
        const result = await confirmSchedule(
          approved.map(b => ({ taskId: b.taskId, startISO: b.startISO, endISO: b.endISO }))
        )
        if (result.confirmed === 0 && result.failed > 0) {
          setConfirmError(result.error ?? `Failed to create ${result.failed} calendar event${result.failed !== 1 ? 's' : ''}`)
          setConfirming(false)
          return
        }
        setConfirmed(true)
        setConfirming(false)
        setTimeout(onConfirmed, 1000)
      } catch (err) {
        setConfirmError(err instanceof Error ? err.message : 'Unexpected error')
        setConfirming(false)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {new Date(dateStr + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — attack plan
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {attackList.length} task{attackList.length !== 1 ? 's' : ''}
              {proposedBlocks.length > 0 && ` · ${proposedBlocks.length} new block${proposedBlocks.length !== 1 ? 's' : ''} to schedule`}
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
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === 'calendar' ? (
            calendarBlocks.length === 0 && existing.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-10">Nothing on this day yet.</p>
            ) : (
              <ScheduleWeekCalendar
                proposals={calendarBlocks}
                existing={existing}
                onToggle={k => setRejected(prev => {
                  const next = new Set(prev)
                  if (next.has(k)) next.delete(k); else next.add(k)
                  return next
                })}
                onMove={(key, start, end) =>
                  setMoved(prev => ({ ...prev, [key]: { startISO: start.toISOString(), endISO: end.toISOString() } }))
                }
              />
            )
          ) : attackList.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">No tasks due on this day.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {attackList.map(item => (
                <div
                  key={item.taskId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                    item.isScheduled
                      ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30'
                      : item.energyMatchNow
                      ? 'border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-950/30'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
                  }`}
                >
                  {/* Rank */}
                  <span className="text-xs font-mono text-slate-400 w-5 shrink-0 text-right tabular-nums">
                    {item.rank}.
                  </span>

                  {/* Priority dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[item.priority] ?? 'bg-slate-400'}`} />

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium truncate">
                      {item.taskTitle}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {item.scheduledStartISO && (
                        <span className="text-[10px] text-sky-500 font-medium">
                          📅 {formatTime(item.scheduledStartISO)}
                        </span>
                      )}
                      {item.durationMinutes && (
                        <span className="text-[10px] text-slate-400 font-mono">{fmtDur(item.durationMinutes)}</span>
                      )}
                      <span className="text-[10px] text-slate-400">{ENERGY_ICON[item.energyRequired]}</span>
                      {item.energyMatchNow && !item.isScheduled && (
                        <span className="text-[10px] text-accent-500 font-medium">✓ Good energy now</span>
                      )}
                    </div>
                  </div>

                  {/* Urgency score */}
                  <span className={`text-xs font-mono tabular-nums shrink-0 ${
                    item.urgencyScore >= 70 ? 'text-red-500' :
                    item.urgencyScore >= 40 ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'
                  }`}>
                    {Math.round(item.urgencyScore)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Couldn't schedule */}
          {unschedulable.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-medium text-red-400 mb-2">Couldn't find a slot ({unschedulable.length})</p>
              {unschedulable.map(t => (
                <p key={t.id} className="text-xs text-slate-500 py-0.5">• {t.title}</p>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          {proposedBlocks.length === 0 && attackList.length > 0 && (
            <p className="text-xs text-slate-400 text-center mb-3">
              No open slots found for this day —{' '}
              <a href="/settings" className="underline hover:text-accent-500">check your working hours in Settings</a>
              {' '}or pick a different day.
            </p>
          )}
          {confirmError && (
            <p className="text-xs text-red-500 text-center mb-3">{confirmError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:border-slate-300 transition-colors"
            >
              Dismiss
            </button>
            {proposedBlocks.length > 0 && (
              <button
                onClick={handleConfirm}
                disabled={confirming || confirmed || approved.length === 0}
                className="flex-1 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {confirmed
                  ? 'Scheduled ✓'
                  : confirming
                    ? 'Scheduling…'
                    : approved.length === proposedBlocks.length
                      ? `Block ${approved.length} on calendar`
                      : `Block ${approved.length} of ${proposedBlocks.length}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
