'use client'

import { useState } from 'react'
import { useTimer } from '@/contexts/TimerContext'
import { logEnergy } from '@/app/actions/energy'

const LEVELS = [
  { v: 1 as const, emoji: '😴', label: 'Exhausted' },
  { v: 2 as const, emoji: '😔', label: 'Low'       },
  { v: 3 as const, emoji: '😐', label: 'Okay'      },
  { v: 4 as const, emoji: '😊', label: 'Good'      },
  { v: 5 as const, emoji: '⚡', label: 'Energized' },
]

export default function EnergyLogger() {
  const [logged,  setLogged]  = useState<number | null>(null)
  const [saving,  setSaving]  = useState(false)
  const { phase, task } = useTimer()

  async function handle(level: 1 | 2 | 3 | 4 | 5) {
    if (saving) return
    setSaving(true)
    // Tag the currently-running task so energy is correlated with the work type
    const taskId = phase === 'running' ? (task?.id ?? null) : null
    await logEnergy(level, taskId).catch(console.error)
    setLogged(level)
    setSaving(false)
    setTimeout(() => setLogged(null), 1500)
  }

  return (
    <div className="px-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600 mb-1.5">
        Energy
      </p>
      {logged !== null ? (
        <p className="text-xs text-accent-500 dark:text-accent-400 py-0.5 pl-0.5">
          Logged ✓
        </p>
      ) : (
        <div className="flex gap-0.5">
          {LEVELS.map(({ v, emoji, label }) => (
            <button
              key={v}
              onClick={() => handle(v)}
              disabled={saving}
              title={`${label} (${v})`}
              className="flex-1 py-1 rounded-md text-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 leading-none"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
