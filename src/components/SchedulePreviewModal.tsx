'use client'

import { useState, useTransition } from 'react'
import { confirmSchedule } from '@/app/actions/scheduling'
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
  blocks:        PreviewBlock[]
  unschedulable: SchedulerTask[]
  onClose:       () => void
  onConfirmed:   () => void
}

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

export default function SchedulePreviewModal({ blocks, unschedulable, onClose, onConfirmed }: Props) {
  const [, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [result, setResult]         = useState<{ confirmed: number; failed: number } | null>(null)

  // Group blocks by day. Built from a chronologically sorted copy so the day
  // sections come out in date order — a Map preserves insertion order, and the
  // scheduler places spread-group sessions out of sequence while hunting for
  // the widest gap.
  const byDay = new Map<string, PreviewBlock[]>()
  for (const b of [...blocks].sort((a, b) => a.startISO.localeCompare(b.startISO))) {
    const key = new Date(b.startISO).toDateString()
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(b)
  }

  function handleConfirm() {
    setConfirming(true)
    startTransition(async () => {
      const res = await confirmSchedule(
        blocks.map(b => ({ taskId: b.taskId, startISO: b.startISO, endISO: b.endISO }))
      )
      setResult(res)
      setConfirming(false)
      if (res.confirmed > 0) {
        setTimeout(onConfirmed, 1200)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg max-h-[80vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Schedule preview
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {blocks.length} block{blocks.length !== 1 ? 's' : ''} across {byDay.size} day{byDay.size !== 1 ? 's' : ''}
              {unschedulable.length > 0 && ` · ${unschedulable.length} couldn't fit`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {blocks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-slate-400 text-sm">No tasks could be scheduled.</p>
              <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">
                Check that tasks have time estimates and working hours are configured.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Array.from(byDay.entries()).map(([dayKey, dayBlocks]) => (
                <div key={dayKey}>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    {formatDate(dayBlocks[0].startISO)}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {dayBlocks.map((b, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                      >
                        {/* Priority dot */}
                        <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[b.taskPriority] ?? 'bg-slate-400'}`} />

                        {/* Time */}
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0 w-24">
                          {formatTime(b.startISO)} – {formatTime(b.endISO)}
                        </span>

                        {/* Title */}
                        <span className="flex-1 text-sm text-slate-800 dark:text-slate-200 truncate">
                          {b.taskTitle}
                        </span>

                        {/* Segment indicator */}
                        {b.totalSegments > 1 && (
                          <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                            {b.segmentIndex + 1}/{b.totalSegments}
                          </span>
                        )}

                        {/* Energy match */}
                        {!b.energyMatch && (
                          <span title="Energy mismatch — scheduled anyway" className="text-[10px] text-amber-400 shrink-0">⚡?</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Unschedulable */}
              {unschedulable.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
                    Couldn't schedule ({unschedulable.length})
                  </p>
                  <div className="flex flex-col gap-1">
                    {unschedulable.map(t => (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
                        <span className="text-xs text-red-400">✕</span>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{t.title}</span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {t.due_date ? `due ${new Date(t.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'no due date'}
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
                disabled={confirming || blocks.length === 0}
                className="flex-1 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {confirming ? 'Scheduling…' : `Confirm ${blocks.length} block${blocks.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
