'use client'

import { useState } from 'react'
import { useTimer } from '@/contexts/TimerContext'
import { logEnergy } from '@/app/actions/energy'
import { EnergyLevelIcon, DoneIcon } from '@/components/icons'

/**
 * Five faces became one glyph at five weights.
 *
 * 😴 😔 😐 😊 ⚡ were five unrelated pictures the reader had to rank from
 * memory, and whether 😔 looks lower than 😐 depends on the platform's font —
 * a poor way to encode a scale whose whole meaning is its order. A single icon
 * getting brighter is ordinal by construction, and it is what Analytics
 * already does with the same values.
 */
const LEVELS = [
  { v: 1 as const, label: 'Exhausted' },
  { v: 2 as const, label: 'Low'       },
  { v: 3 as const, label: 'Okay'      },
  { v: 4 as const, label: 'Good'      },
  { v: 5 as const, label: 'Energized' },
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
        <p className="flex items-center gap-1.5 text-xs text-accent-500 dark:text-accent-400 py-0.5 pl-0.5">
          <DoneIcon size={12} /> Logged
        </p>
      ) : (
        <div className="flex gap-0.5">
          {LEVELS.map(({ v, label }) => (
            <button
              key={v}
              onClick={() => handle(v)}
              disabled={saving}
              title={`${label} (${v})`}
              aria-label={`Log energy: ${label}`}
              className="flex-1 py-1.5 rounded-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-accent-600 dark:hover:text-accent-400 transition-colors disabled:opacity-40"
            >
              <EnergyLevelIcon level={v} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
