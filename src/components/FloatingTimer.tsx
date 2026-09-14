'use client'

import { useState, useEffect } from 'react'
import { useTimer } from '@/contexts/TimerContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ── Reflection panel (shown when user taps "Done") ──────────────────────────

function ReflectionPanel({ onBack }: { onBack: () => void }) {
  const { task, elapsedMs, finish } = useTimer()
  const [accurate, setAccurate] = useState<boolean | null>(null)
  const [blocker,  setBlocker]  = useState('')
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    setSaving(true)
    await finish(accurate, blocker.trim() || null)
    setSaving(false)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-0.5">Log session</p>
      <p className="text-xs text-slate-400 mb-4">
        {fmt(elapsedMs)} on &ldquo;{task?.title}&rdquo;
      </p>

      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Estimate accurate?</p>
      <div className="flex gap-2 mb-3">
        {([true, false] as const).map(v => (
          <button
            key={String(v)}
            onClick={() => setAccurate(accurate === v ? null : v)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              accurate === v
                ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {v ? '✓ Yes' : '✗ No'}
          </button>
        ))}
      </div>

      <textarea
        placeholder="Any blockers? (optional)"
        value={blocker}
        onChange={e => setBlocker(e.target.value)}
        rows={2}
        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 rounded-xl bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Save session'}
      </button>
      <button
        onClick={onBack}
        className="w-full mt-1.5 py-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        Back to timer
      </button>
    </div>
  )
}

// ── Main floating chip ────────────────────────────────────────────────────────

export default function FloatingTimer() {
  const { phase, task, elapsedMs, targetMs, pause, resume, abandon } = useTimer()
  const [finishing, setFinishing] = useState(false)

  // Reset reflection UI whenever the timer goes idle (session finished or abandoned)
  // The component stays mounted so this effect runs even across sessions.
  useEffect(() => {
    if (phase === 'idle') setFinishing(false)
  }, [phase])

  if (phase === 'idle') return null

  if (finishing) return <ReflectionPanel onBack={() => setFinishing(false)} />

  // SVG progress ring
  const R    = 22
  const circ = 2 * Math.PI * R
  const pct  = Math.min(elapsedMs / targetMs, 1)
  const over = elapsedMs > targetMs

  const ringColor =
    over          ? '#ef4444' :
    phase === 'paused' ? '#94a3b8' : '#14b8a6'

  return (
    <div className="fixed bottom-6 right-6 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[240px] max-w-xs">

      {/* Progress ring */}
      <div className="relative shrink-0 w-14 h-14">
        <svg width={56} height={56} viewBox="0 0 56 56">
          <circle cx={28} cy={28} r={R} fill="none" strokeWidth={4}
            stroke="currentColor" className="text-slate-100 dark:text-slate-800" />
          <circle cx={28} cy={28} r={R} fill="none" strokeWidth={4}
            stroke={ringColor}
            strokeDasharray={`${pct * circ} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 28 28)" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
            {fmt(elapsedMs)}
          </span>
        </div>
      </div>

      {/* Info + controls */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
          {task?.title}
        </p>
        <p className="text-[11px] text-slate-400 mb-2 leading-tight">
          {phase === 'paused' ? 'Paused' : over ? 'Over estimate' : `of ${fmt(targetMs)}`}
        </p>
        <div className="flex gap-1.5">
          {/* Pause / Resume */}
          {phase === 'running'
            ? (
              <button onClick={pause}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Pause">
                ⏸
              </button>
            ) : (
              <button onClick={resume}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Resume">
                ▶
              </button>
            )
          }

          {/* Done */}
          <button
            onClick={() => setFinishing(true)}
            className="flex-1 py-1 rounded-lg bg-teal-500 text-white text-xs font-medium hover:bg-teal-600 transition-colors"
          >
            Done
          </button>

          {/* Abandon */}
          <button
            onClick={abandon}
            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
            title="Discard session"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
