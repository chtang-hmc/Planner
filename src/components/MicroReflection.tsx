'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
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
  const [permanent, setPermanent] = useState(false)
  const [isPending, startTransition] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)

  function handleSubmit() {
    startTransition(async () => {
      await completeTask(
        task.id,
        actualMinutes ? parseInt(actualMinutes) : null,
        accurate,
        blocker || null,
        permanent
      )
      onDone()
    })
  }

  const handleSkip = useCallback(() => {
    startTransition(async () => {
      await completeTask(task.id, null, null, null, permanent)
      onDone()
    })
  }, [task.id, permanent, onDone])

  /**
   * Take the keyboard on open. Focus is still on whatever row control marked
   * the task done, so without this the first keypress goes to the list behind
   * the modal — and space would re-fire the button that opened it.
   */
  useEffect(() => { panelRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }

      // Space closes the task without logging anything — the common case is
      // "done, nothing to report", and it shouldn't cost a click.
      if (e.key !== ' ' && e.code !== 'Space') return
      if (isPending) return

      // Unless a control is focused that owns the space bar itself: the
      // blocker textarea needs to type one, the permanent checkbox toggles on
      // it, and a focused button already treats it as a click. Clicking into
      // the minutes field is also a statement of intent — you are logging,
      // not skipping — so the field keeps the key while it has focus.
      const el  = e.target as HTMLElement | null
      const tag = el?.tagName
      if (el?.isContentEditable) return
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return

      e.preventDefault()   // otherwise the page behind scrolls
      handleSkip()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, handleSkip, isPending])

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      {/* Modal */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-600 dark:text-accent-400 mb-1">Done ✓</p>
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
              className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
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
                      ? 'bg-accent-50 dark:bg-accent-950 border-accent-300 dark:border-accent-700 text-accent-700 dark:text-accent-300'
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
              className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
            />
          </div>
        )}

        {/* Permanent completion — only for recurring tasks */}
        {task.type === 'recurring' && (
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={permanent}
              onChange={e => setPermanent(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-violet-600 cursor-pointer"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
              Stop repeating — complete permanently
            </span>
          </label>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSkip}
            disabled={isPending}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
          >
            Skip
            {/* The shortcut is the point of the button; say so rather than
                leaving it to be discovered. */}
            <kbd className="hidden sm:inline px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] font-sans leading-none text-slate-400">
              space
            </kbd>
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg py-2 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {isPending ? 'Saving…' : permanent ? 'Complete permanently' : 'Log & close'}
          </button>
        </div>
      </div>
    </div>
  )
}
