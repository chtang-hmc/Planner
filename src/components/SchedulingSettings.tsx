'use client'

import { useState, useTransition } from 'react'
import {
  saveWorkingHours,
  saveEnergyLevel,
  saveSchedulingConfig,
} from '@/app/actions/scheduling'
import { TIME_BLOCK_DEFS, type TimeBlockId, type WorkingHours, type EnergyScheduleEntry } from '@/lib/scheduler'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ENERGY_LEVELS = ['low', 'medium', 'high'] as const

type EnergyLevel = 'low' | 'medium' | 'high'

const ENERGY_COLORS: Record<EnergyLevel, string> = {
  low:    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  high:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800',
}

const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low:    '🌿 Low',
  medium: '⚡ Med',
  high:   '🔥 High',
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function toTimeStr(h: number, m: number) { return `${pad2(h)}:${pad2(m)}` }
function parseTime(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number)
  return [h ?? 0, m ?? 0]
}

// ── Working hours ─────────────────────────────────────────────────────────────

function WorkingHoursSection({ initial }: { initial: WorkingHours[] }) {
  const [rows, setRows] = useState<WorkingHours[]>(() => {
    const map = new Map(initial.map(r => [r.day_of_week, r]))
    return Array.from({ length: 7 }, (_, i) => map.get(i) ?? {
      day_of_week: i, start_hour: 9, start_minute: 0, end_hour: 18, end_minute: 0, enabled: i >= 1 && i <= 5,
    })
  })
  const [mode, setMode] = useState<'simple' | 'custom'>('simple')
  const [, startTransition] = useTransition()

  function update(dow: number, patch: Partial<WorkingHours>) {
    setRows(prev => prev.map(r => r.day_of_week === dow ? { ...r, ...patch } : r))
    const row = { ...rows.find(r => r.day_of_week === dow)!, ...patch }
    startTransition(() => saveWorkingHours(
      row.day_of_week, row.start_hour, row.start_minute,
      row.end_hour, row.end_minute, row.enabled,
    ))
  }

  function applyToWeekdays(startH: number, startM: number, endH: number, endM: number) {
    setRows(prev => prev.map(r =>
      r.day_of_week >= 1 && r.day_of_week <= 5
        ? { ...r, start_hour: startH, start_minute: startM, end_hour: endH, end_minute: endM, enabled: true }
        : r
    ))
    for (let d = 1; d <= 5; d++) {
      startTransition(() => saveWorkingHours(d, startH, startM, endH, endM, true))
    }
  }

  const weekdayRow = rows.find(r => r.day_of_week === 1)!
  const weekendRow = rows.find(r => r.day_of_week === 0)!

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Working hours</label>
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          {(['simple', 'custom'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {m === 'simple' ? 'Simple' : 'Per day'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'simple' ? (
        <div className="flex flex-col gap-2">
          {/* Weekdays row */}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 w-20 shrink-0">Mon – Fri</span>
            <input
              type="time"
              value={toTimeStr(weekdayRow.start_hour, weekdayRow.start_minute)}
              onChange={e => {
                const [h, m] = parseTime(e.target.value)
                applyToWeekdays(h, m, weekdayRow.end_hour, weekdayRow.end_minute)
              }}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="time"
              value={toTimeStr(weekdayRow.end_hour, weekdayRow.end_minute)}
              onChange={e => {
                const [h, m] = parseTime(e.target.value)
                applyToWeekdays(weekdayRow.start_hour, weekdayRow.start_minute, h, m)
              }}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>
          {/* Weekend row */}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 w-20 shrink-0">Sat – Sun</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={weekendRow.enabled || rows.find(r => r.day_of_week === 6)!.enabled}
                onChange={e => {
                  [0, 6].forEach(d => update(d, { enabled: e.target.checked }))
                }}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-accent-500"
              />
              <span className="text-xs text-slate-500">Enabled</span>
            </label>
            <input
              type="time"
              disabled={!weekendRow.enabled}
              value={toTimeStr(weekendRow.start_hour, weekendRow.start_minute)}
              onChange={e => {
                const [h, m] = parseTime(e.target.value)
                ;[0, 6].forEach(d => update(d, { start_hour: h, start_minute: m }))
              }}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-40"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="time"
              disabled={!weekendRow.enabled}
              value={toTimeStr(weekendRow.end_hour, weekendRow.end_minute)}
              onChange={e => {
                const [h, m] = parseTime(e.target.value)
                ;[0, 6].forEach(d => update(d, { end_hour: h, end_minute: m }))
              }}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-40"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map(row => (
            <div key={row.day_of_week} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 w-8 shrink-0">{DAYS[row.day_of_week]}</span>
              <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={e => update(row.day_of_week, { enabled: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 accent-accent-500"
                />
              </label>
              <input
                type="time"
                disabled={!row.enabled}
                value={toTimeStr(row.start_hour, row.start_minute)}
                onChange={e => {
                  const [h, m] = parseTime(e.target.value)
                  update(row.day_of_week, { start_hour: h, start_minute: m })
                }}
                className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-40"
              />
              <span className="text-xs text-slate-400">–</span>
              <input
                type="time"
                disabled={!row.enabled}
                value={toTimeStr(row.end_hour, row.end_minute)}
                onChange={e => {
                  const [h, m] = parseTime(e.target.value)
                  update(row.day_of_week, { end_hour: h, end_minute: m })
                }}
                className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Energy grid ───────────────────────────────────────────────────────────────

function EnergyGrid({ initial }: { initial: EnergyScheduleEntry[] }) {
  // energy[dow][timeBlockId] → level
  const [energy, setEnergy] = useState<Record<number, Record<TimeBlockId, EnergyLevel>>>(() => {
    const map: Record<number, Record<TimeBlockId, EnergyLevel>> = {}
    for (let d = 0; d < 7; d++) {
      map[d] = {} as Record<TimeBlockId, EnergyLevel>
      for (const b of TIME_BLOCK_DEFS) map[d][b.id] = 'medium'
    }
    for (const e of initial) {
      if (!map[e.day_of_week]) map[e.day_of_week] = {} as Record<TimeBlockId, EnergyLevel>
      map[e.day_of_week][e.time_block] = e.energy_level as EnergyLevel
    }
    return map
  })
  const [, startTransition] = useTransition()

  function cycle(dow: number, block: TimeBlockId) {
    setEnergy(prev => {
      const cur = prev[dow]?.[block] ?? 'medium'
      const idx = ENERGY_LEVELS.indexOf(cur)
      const next = ENERGY_LEVELS[(idx + 1) % ENERGY_LEVELS.length]
      return { ...prev, [dow]: { ...prev[dow], [block]: next } }
    })
    const cur = energy[dow]?.[block] ?? 'medium'
    const idx = ENERGY_LEVELS.indexOf(cur)
    const next = ENERGY_LEVELS[(idx + 1) % ENERGY_LEVELS.length]
    startTransition(() => saveEnergyLevel(dow, block, next))
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
        Energy by time of day
        <span className="ml-2 normal-case text-slate-300 dark:text-slate-600 font-normal">click to cycle Low → Medium → High</span>
      </label>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left py-1 pr-3 text-slate-400 font-medium w-28">Time</th>
              {DAYS.map(d => (
                <th key={d} className="text-center py-1 px-1 text-slate-400 font-medium">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIME_BLOCK_DEFS.map(block => (
              <tr key={block.id}>
                <td className="py-0.5 pr-3 text-slate-500 font-medium whitespace-nowrap">{block.label}</td>
                {DAYS.map((_, dow) => {
                  const level = energy[dow]?.[block.id] ?? 'medium'
                  return (
                    <td key={dow} className="py-0.5 px-0.5 text-center">
                      <button
                        onClick={() => cycle(dow, block.id)}
                        className={`w-full px-1 py-1 rounded border text-[10px] font-medium transition-colors ${ENERGY_COLORS[level]}`}
                        title={`${DAYS[dow]} ${block.label}: ${level}`}
                      >
                        {level === 'low' ? '🌿' : level === 'medium' ? '⚡' : '🔥'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        The algorithm prefers slots whose energy matches the task's requirement. Lower-energy slots are used as fallback.
      </p>
    </div>
  )
}

// ── Session config ────────────────────────────────────────────────────────────

function SessionConfig({
  initialMax,
  initialBuffer,
}: {
  initialMax:    number
  initialBuffer: number
}) {
  const [maxSession, setMaxSession] = useState(initialMax)
  const [buffer,     setBuffer]     = useState(initialBuffer)
  const [saved,      setSaved]      = useState(false)
  const [, startTransition]         = useTransition()

  function handleSave() {
    startTransition(async () => {
      await saveSchedulingConfig(maxSession, buffer)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Session settings</label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">Max focus block (min)</label>
          <input
            type="number"
            min={15}
            max={480}
            value={maxSession}
            onChange={e => setMaxSession(Number(e.target.value))}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">Long tasks split into chunks this size</p>
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">Buffer between blocks (min)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={buffer}
            onChange={e => setBuffer(Number(e.target.value))}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">Break time enforced between scheduled blocks</p>
        </div>
      </div>
      <button
        onClick={handleSave}
        className="mt-3 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:opacity-80 transition-opacity"
      >
        {saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  workingHours:   WorkingHours[]
  energySchedule: EnergyScheduleEntry[]
  maxSession:     number
  bufferMinutes:  number
}

export default function SchedulingSettings({
  workingHours,
  energySchedule,
  maxSession,
  bufferMinutes,
}: Props) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Smart scheduling</h2>
      <p className="text-xs text-slate-400 mb-6">
        Configure when you work and your energy levels throughout the week. The scheduler uses this to find the best time slots for your tasks.
      </p>

      <div className="flex flex-col gap-8">
        <WorkingHoursSection initial={workingHours} />
        <EnergyGrid initial={energySchedule} />
        <SessionConfig initialMax={maxSession} initialBuffer={bufferMinutes} />
      </div>
    </section>
  )
}
