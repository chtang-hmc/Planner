'use client'

import { useState, useTransition, useEffect } from 'react'
import { completeTask } from '@/app/actions/tasks'
import { Task } from '@/types'

function formatMinutes(m: number | null): string {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

interface Props {
  task: Task
  onClose: () => void
  onDone: () => void
}

export default function MicroReflection({ task, onClose, onDone }: Props) {
  const estimate = task.adjusted_minutes ?? task.estimated_minutes
  const [actualMinutes, setActualMinutes] = useState<string>(estimate ? String(estimate) : '')
  const [accurate, setAccurate] = useState<boolean | null>(null)
  const [blocker, setBlocker] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function handleSubmit() {
    startTransition(async () => {
      await completeTask(
        task.id,
        actualMinutes ? parseInt(actualMinutes) : null,
        accurate,
        blocker || null
      )
      onDone()
    })
  }

  function handleSkip() {
    startTransition(async () => {
      await completeTask(task.id, null, null, null)
      onDone()
    })
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      {/* Modal */}
      <div
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1">Done ✓</p>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug line-clamp-2">{task.title}</p>
        </div>

        {/* Actual time */}
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            How long did it actually take?
            {estimate && <span className="text-slate-400 font-normal"> (estimated {formatMinutes(estimate)})</span>}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={actualMinutes}
              onChange={e => setActualMinutes(e.target.value)}
              placeholder="minutes"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
            />
            <span className="text-xs text-slate-400 shrink-0">min</span>
          </div>
          {estimate && actualMinutes && (
            <p className="text-xs text-slate-400 mt-1">
              {Math.round((parseInt(actualMinutes) / estimate) * 100)}% of estimate
              {parseInt(actualMinutes) > estimate ? ' — took longer' : parseInt(actualMinutes) < estimate ? ' — faster than expected' : ' — spot on'}
            </p>
          )}
        </div>

        {/* Accurate? */}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Was the original estimate about right?</p>
          <div className="flex gap-2">
            {([true, false] as const).map(val => (
              <button
                key={String(val)}
                onClick={() => setAccurate(accurate === val ? null : val)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  accurate === val
                    ? val
                      ? 'bg-teal-50 dark:bg-teal-950 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                      : 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                {val ? '👍 Yes' : '👎 Off'}
              </button>
            ))}
          </div>
        </div>

        {/* Blocker (optional) */}
        {accurate === false && (
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              What made it take longer? <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={blocker}
              onChange={e => setBlocker(e.target.value)}
              placeholder="e.g. waiting on teammate, scope grew..."
              rows={2}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSkip}
            disabled={isPending}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg py-2 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Log & close'}
          </button>
        </div>
      </div>
    </div>
  )
}
