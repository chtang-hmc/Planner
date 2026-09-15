'use client'

import { PRESETS, RecurrencePreset, rruleToPreset, rruleToLabel } from '@/lib/rrule-utils'

interface Props {
  /** Current rrule string (or null = no recurrence) */
  value: string | null
  onChange: (rrule: string | null) => void
}

/**
 * Compact recurrence selector.
 * Shows the most-used presets as a grid of buttons.  A "custom" value from
 * the DB is displayed read-only (we don't support free-form editing yet).
 */
export default function RecurrencePicker({ value, onChange }: Props) {
  const current = rruleToPreset(value)
  const isCustom = current === 'custom'

  const mainPresets = PRESETS.filter(p =>
    ['none', 'daily', 'weekdays', 'monthly'].includes(p.id)
  )
  const weeklyPresets = PRESETS.filter(p => p.id.startsWith('weekly_'))

  function handleSelect(preset: RecurrencePreset, rrule: string | null) {
    onChange(rrule)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Main presets */}
      <div className="flex gap-1.5 flex-wrap">
        {mainPresets.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleSelect(p.id, p.rrule)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              current === p.id && !isCustom
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Weekly day presets */}
      <div className="flex gap-1 flex-wrap">
        {weeklyPresets.map(p => {
          const dayLabel = p.label.replace('Every ', '')
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id, p.rrule)}
              className={`w-10 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                current === p.id && !isCustom
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {dayLabel}
            </button>
          )
        })}
      </div>

      {/* Custom value (read-only) */}
      {isCustom && (
        <p className="text-xs text-violet-500 dark:text-violet-400 mt-0.5">
          ↻ {rruleToLabel(value)} — edit rrule string directly in the DB to change
        </p>
      )}
    </div>
  )
}
