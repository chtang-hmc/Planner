'use client'

import { AnalyticsData, DailyEnergy } from './page'
import { weekDayOrder } from '@/lib/week'
import { Project, EstimationProfile, EnergyPattern } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`
  const h = Math.floor(m / 60), rem = Math.round(m % 60)
  return rem ? `${h}h ${rem}m` : `${h}h`
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string
  value: string | number
  sub?: string
  accent?: string   // tailwind text color class
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${accent ?? 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Urgency distribution bar chart ────────────────────────────────────────────

const BUCKET_LABELS = ['0–20', '20–40', '40–60', '60–80', '80–100']
const BUCKET_COLORS = ['#94a3b8', '#94a3b8', '#f59e0b', '#f97316', '#ef4444']

function UrgencyChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((s, v) => s + v, 0)

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Urgency distribution</h3>
      {total === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">No active tasks</p>
      ) : (
        <div className="flex items-end gap-3 h-32">
          {buckets.map((count, i) => {
            const pct = count / max
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                  {count || ''}
                </span>
                <div className="w-full rounded-t-md transition-all" style={{
                  height: `${Math.max(pct * 96, count > 0 ? 6 : 0)}px`,
                  background: BUCKET_COLORS[i],
                  opacity: count === 0 ? 0.15 : 1,
                }} />
                <span className="text-xs text-slate-400 tabular-nums">{BUCKET_LABELS[i]}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Project workload chart ────────────────────────────────────────────────────

function ProjectWorkload({ stats }: {
  stats: AnalyticsData['projectStats']
}) {
  const maxMin = Math.max(...stats.map(s => s.estimatedMinutes), 1)

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Project workload</h3>
      {stats.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">No data yet</p>
      ) : (
        <div className="flex flex-col gap-3">
          {stats.map(({ project, activeCount, estimatedMinutes, doneCount }) => {
            const pct = estimatedMinutes / maxMin
            const total = activeCount + doneCount
            const donePct = total > 0 ? Math.round((doneCount / total) * 100) : 0
            return (
              <div key={project.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: project.color }} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{project.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 tabular-nums">
                    <span>{activeCount} active</span>
                    <span className="font-mono">{formatMinutes(estimatedMinutes)}</span>
                    <span className="text-accent-500 dark:text-accent-400">{donePct}% done</span>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct * 100}%`, background: project.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Estimation bias chart ─────────────────────────────────────────────────────

function BiasChart({ stats }: {
  stats: { project: Project; bias: EstimationProfile | null }[]
}) {
  const withBias = stats.filter(s => s.bias && s.bias.sample_count >= 3)

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Estimation bias</h3>
      <p className="text-xs text-slate-400 mb-4">
        How much longer tasks actually take vs. your estimate (1.0 = perfect)
      </p>
      {withBias.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">
          Complete 3+ tasks per project to unlock bias data
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {withBias.map(({ project, bias }) => {
            if (!bias) return null
            const ratio = bias.bias_ratio
            const pct = ratio * 100  // 100 = 1× estimate
            // Bar: center at 100 (1.0), extend left if under, right if over
            // We'll show 50% → 200% range, centered at 100%
            const clampedRatio = Math.min(Math.max(ratio, 0.5), 2.0)
            const barWidth = ((clampedRatio - 0.5) / 1.5) * 100   // 0 at 0.5×, 100 at 2×
            const perfectPos = ((1.0 - 0.5) / 1.5) * 100           // 33.3%

            const color = Math.abs(ratio - 1) < 0.12 ? '#14b8a6'
              : Math.abs(ratio - 1) < 0.35 ? '#f59e0b' : '#ef4444'

            return (
              <div key={project.id}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: project.color }} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{project.name}</span>
                  </div>
                  <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    <span style={{ color }}>
                      {ratio < 0.95 ? `${Math.round((1 - ratio) * 100)}% under` :
                       ratio > 1.05 ? `${Math.round((ratio - 1) * 100)}% over` : 'On target'}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600 ml-1">· {bias.sample_count} samples</span>
                  </div>
                </div>
                {/* Bar with center marker */}
                <div className="relative h-2 bg-slate-100 dark:bg-slate-800 rounded-full">
                  {/* Perfect line */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600 z-10"
                    style={{ left: `${perfectPos}%` }}
                  />
                  {/* Bias bar — starts at perfectPos, extends right if over, left if under */}
                  {ratio >= 1 ? (
                    <div
                      className="absolute top-0 bottom-0 rounded-r-full"
                      style={{
                        left: `${perfectPos}%`,
                        width: `${barWidth - perfectPos}%`,
                        background: color,
                      }}
                    />
                  ) : (
                    <div
                      className="absolute top-0 bottom-0 rounded-l-full"
                      style={{
                        left: `${barWidth}%`,
                        width: `${perfectPos - barWidth}%`,
                        background: color,
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-xs text-slate-300 dark:text-slate-700 mt-0.5">
                  <span>0.5×</span>
                  <span>1×</span>
                  <span>2×</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Accuracy donut ────────────────────────────────────────────────────────────

function AccuracyDonut({ accurate, inaccurate }: { accurate: number; inaccurate: number }) {
  const total = accurate + inaccurate
  const pct = total > 0 ? Math.round((accurate / total) * 100) : null

  // SVG donut — simple arc
  const r = 36, cx = 44, cy = 44, stroke = 10
  const circumference = 2 * Math.PI * r
  const dashArr = pct !== null ? (pct / 100) * circumference : 0

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Estimate accuracy</h3>
      {total === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">
          Complete tasks with reflections to see accuracy
        </p>
      ) : (
        <div className="flex items-center gap-6">
          <svg width={88} height={88} className="shrink-0">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor"
              className="text-slate-100 dark:text-slate-800" strokeWidth={stroke} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#14b8a6" strokeWidth={stroke}
              strokeDasharray={`${dashArr} ${circumference}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${cx} ${cy})`} />
            <text x={cx} y={cy + 6} textAnchor="middle"
              className="fill-slate-900 dark:fill-slate-100"
              style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fill: 'currentColor' }}>
              {pct}%
            </text>
          </svg>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-accent-500 shrink-0" />
              <span className="text-slate-600 dark:text-slate-400">{accurate} accurate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
              <span className="text-slate-600 dark:text-slate-400">{inaccurate} off</span>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-snug">
              from {total} completed task{total !== 1 ? 's' : ''} with reflections
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Energy level colours (1–5) ────────────────────────────────────────────────

const ENERGY_COLORS = [
  '',           // unused index 0
  '#94a3b8',   // 1 — exhausted, slate
  '#fb923c',   // 2 — low, orange
  '#fbbf24',   // 3 — okay, amber
  '#34d399',   // 4 — good, emerald
  '#14b8a6',   // 5 — energized, teal
]

const ENERGY_LABELS = ['', '😴 Exhausted', '😔 Low', '😐 Okay', '😊 Good', '⚡ Energized']

// ── Rolling 7-day bar chart ───────────────────────────────────────────────────

function EnergyRecentChart({ days }: { days: DailyEnergy[] }) {
  // Fill in missing days so we always show 7 bars
  const filled: (DailyEnergy | null)[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const key = d.toISOString().slice(0, 10)
    return days.find(e => e.date === key) ?? null
  })

  function dayLabel(offset: number) {
    if (offset === 6) return 'Today'
    if (offset === 5) return 'Yday'
    const d = new Date(); d.setDate(d.getDate() - (6 - offset))
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }

  const hasAny = filled.some(Boolean)

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Energy — last 7 days</h3>
      <p className="text-xs text-slate-400 mb-4">Average self-reported level per day (1–5)</p>
      {!hasAny ? (
        <p className="text-sm text-slate-400 italic text-center py-6">
          Log your energy from the sidebar to see trends here
        </p>
      ) : (
        <div className="flex items-end gap-2 h-28">
          {filled.map((entry, i) => {
            const avg = entry?.avg ?? 0
            const pct = avg / 5
            const color = avg > 0 ? ENERGY_COLORS[Math.round(avg)] : undefined
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5" title={entry ? `${ENERGY_LABELS[Math.round(avg)]} · ${entry.count} log${entry.count !== 1 ? 's' : ''}` : 'No logs'}>
                <span className="text-[10px] font-semibold tabular-nums text-slate-400">
                  {entry ? avg.toFixed(1) : ''}
                </span>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max(pct * 80, entry ? 4 : 0)}px`,
                    background: color ?? 'transparent',
                    border: !entry ? '1px dashed #cbd5e1' : undefined,
                  }}
                />
                <span className="text-[10px] text-slate-400">{dayLabel(i)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Time-of-day heatmap ───────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)   // 6 AM → 11 PM

function levelColor(level: number, dark = false): string {
  if (level <= 0) return dark ? '#1e293b' : '#f1f5f9'    // empty cell
  const idx = Math.round(Math.min(Math.max(level, 1), 5))
  return ENERGY_COLORS[idx]
}

function EnergyHeatmap({ patterns, weekStartDay }: { patterns: EnergyPattern[]; weekStartDay: number }) {
  // Build a lookup: patternMap[day][hour] = pattern
  const map: Record<number, Record<number, EnergyPattern>> = {}
  for (const p of patterns) {
    if (!map[p.day_of_week]) map[p.day_of_week] = {}
    map[p.day_of_week][p.hour_of_day] = p
  }

  const hasData = patterns.length > 0

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Energy by time of day</h3>
      <p className="text-xs text-slate-400 mb-4">
        {hasData
          ? 'Average energy level by hour and day (based on 90-day rolling window)'
          : 'Computed nightly — check back tomorrow after logging today'}
      </p>
      {!hasData ? (
        <p className="text-sm text-slate-400 italic text-center py-6">
          No patterns yet — keep logging to build your heatmap
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            {/* Hour labels */}
            <div className="flex gap-px ml-8 mb-1">
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[9px] text-slate-400 tabular-nums">
                  {h % 3 === 0 ? `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}` : ''}
                </div>
              ))}
            </div>
            {/* Grid */}
            {weekDayOrder(weekStartDay).map(dow => {
              const day = DAYS[dow]
              return (
              <div key={dow} className="flex items-center gap-px mb-px">
                <span className="w-8 text-[10px] text-slate-400 shrink-0">{day}</span>
                {HOURS.map(h => {
                  const p = map[dow]?.[h]
                  const level = p?.avg_level ?? 0
                  return (
                    <div
                      key={h}
                      className="flex-1 h-5 rounded-sm transition-colors"
                      style={{ background: levelColor(level) }}
                      title={p
                        ? `${day} ${h}:00 — ${ENERGY_LABELS[Math.round(level)]} (avg ${level.toFixed(1)}, ${p.sample_count} samples)`
                        : `${day} ${h}:00 — no data`}
                    />
                  )
                })}
              </div>
              )
            })}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 justify-end">
              {[1, 2, 3, 4, 5].map(v => (
                <div key={v} className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ background: ENERGY_COLORS[v] }} />
                  <span className="text-[9px] text-slate-400">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function AnalyticsView({ data }: { data: AnalyticsData }) {
  const {
    activeCount, doneCount, totalEstMinutes, avgUrgency,
    urgencyBuckets, projectStats, accurateSessions, inaccurateSessions,
    recentEnergy, energyPatterns,
  } = data

  const urgencyColor =
    avgUrgency >= 70 ? 'text-red-500' :
    avgUrgency >= 40 ? 'text-amber-500' : 'text-slate-900 dark:text-slate-100'

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="px-6 py-3">
          <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Analytics</h1>
        </div>
      </header>

      <div className="px-6 py-5 flex flex-col gap-5 max-w-2xl">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Active tasks" value={activeCount} />
          <StatCard label="Done" value={doneCount} sub="all time" accent="text-accent-500 dark:text-accent-400" />
          <StatCard label="Est. remaining" value={formatMinutes(totalEstMinutes)} />
          <StatCard
            label="Avg urgency"
            value={Math.round(avgUrgency)}
            sub="across active tasks"
            accent={urgencyColor}
          />
        </div>

        {/* Urgency distribution */}
        <UrgencyChart buckets={urgencyBuckets} />

        {/* Project workload */}
        <ProjectWorkload stats={projectStats} />

        {/* Bias + accuracy side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <AccuracyDonut accurate={accurateSessions} inaccurate={inaccurateSessions} />
          <BiasChart stats={projectStats} />
        </div>

        {/* Energy */}
        <EnergyRecentChart days={recentEnergy} />
        <EnergyHeatmap patterns={energyPatterns} weekStartDay={data.weekStartDay} />

      </div>
    </div>
  )
}
