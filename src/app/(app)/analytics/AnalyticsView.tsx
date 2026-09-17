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

// ── Panel ─────────────────────────────────────────────────────────────────────

/**
 * One card shell for every chart.
 *
 * Six components each carried their own copy of the border, radius, padding and
 * heading, which is six places for them to drift — and they had, between
 * `tracking-wide` and `tracking-wider`. The heading is the same micro-label the
 * task list and calendar panel use.
 */
function Panel({ title, sub, children, className = '' }: {
  title: string
  sub?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      <div className={sub ? 'mt-4' : 'mt-3'}>{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-slate-400 text-center py-6">{children}</p>
}

// ── Stat strip ────────────────────────────────────────────────────────────────

/**
 * The four headline numbers, in one panel split by hairlines.
 *
 * They were four separate bordered boxes with 3xl numbers, two of them tinted
 * for no reason other than decoration. Colour now means something — only
 * average urgency keeps it, because a high average is the one number here that
 * is telling you to act.
 */
function StatStrip({ items }: {
  items: { label: string; value: string | number; sub?: string; accent?: string }[]
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100 dark:divide-slate-800">
      {items.map(s => (
        <div key={s.label} className="px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{s.label}</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1.5 ${s.accent ?? 'text-slate-900 dark:text-slate-100'}`}>
            {s.value}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 h-4">{s.sub ?? ''}</p>
        </div>
      ))}
    </div>
  )
}

// ── Urgency distribution bar chart ────────────────────────────────────────────

const BUCKET_LABELS = ['0–20', '20–40', '40–60', '60–80', '80–100']
// One hue deepening across the range, not four unrelated ones. Urgency is a
// single scale, so it should look like a single scale.
const BUCKET_OPACITY = [0.25, 0.4, 0.58, 0.78, 1]

function UrgencyChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((s, v) => s + v, 0)

  return (
    <Panel title="Urgency distribution" sub={`${total} active task${total === 1 ? '' : 's'}`}>
      {total === 0 ? (
        <Empty>No active tasks</Empty>
      ) : (
        <div>
          <div className="flex items-end gap-2 h-28">
            {buckets.map((count, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                  {count || ''}
                </span>
                <div
                  className="w-full max-w-[56px] rounded-sm transition-all bg-red-500"
                  style={{
                    height: `${Math.max((count / max) * 88, count > 0 ? 4 : 0)}px`,
                    opacity: count === 0 ? 0.08 : BUCKET_OPACITY[i],
                  }}
                />
              </div>
            ))}
          </div>
          <div className="h-px bg-slate-200 dark:bg-slate-700 mt-0" />
          <div className="flex gap-2 mt-1.5">
            {BUCKET_LABELS.map(l => (
              <span key={l} className="flex-1 text-center text-[10px] text-slate-400 tabular-nums">{l}</span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── Project workload chart ────────────────────────────────────────────────────

function ProjectWorkload({ stats }: {
  stats: AnalyticsData['projectStats']
}) {
  const maxMin = Math.max(...stats.map(s => s.estimatedMinutes), 1)

  return (
    <Panel title="Project workload" sub="Estimated time remaining, by project">
      {stats.length === 0 ? (
        <Empty>No data yet</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {stats.map(({ project, activeCount, estimatedMinutes, doneCount }) => {
            const pct = estimatedMinutes / maxMin
            const total = activeCount + doneCount
            const donePct = total > 0 ? Math.round((doneCount / total) * 100) : 0
            return (
              // Name, bar and numbers on one line rather than the bar on its
              // own beneath. Stacked, the track ran the full width of the panel
              // — past 1200px that is a very long hairline saying very little,
              // and the name and its numbers ended up at opposite ends of the
              // screen with nothing in between.
              <div key={project.id} className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-40 shrink-0 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: project.color }} />
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">
                    {project.name}
                  </span>
                </div>
                <div className="flex-1 max-w-sm h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct * 100}%`, background: project.color }}
                  />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400 tabular-nums shrink-0 ml-auto">
                  <span>{activeCount} active</span>
                  <span className="font-mono">{formatMinutes(estimatedMinutes)}</span>
                  <span className="text-accent-500 dark:text-accent-400 w-16 text-right">{donePct}% done</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// ── Estimation bias chart ─────────────────────────────────────────────────────

function BiasChart({ stats }: {
  stats: { project: Project; bias: EstimationProfile | null }[]
}) {
  const withBias = stats.filter(s => s.bias && s.bias.sample_count >= 3)

  return (
    <Panel title="Estimation bias" sub="How much longer tasks actually take vs. your estimate (1.0 = perfect)">
      {withBias.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">
          Complete 3+ tasks per project to unlock bias data
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {withBias.map(({ project, bias }) => {
            if (!bias) return null
            const ratio = bias.bias_ratio
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
    </Panel>
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
    <Panel title="Estimate accuracy">
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
    </Panel>
  )
}

// ── Energy level colours (1–5) ────────────────────────────────────────────────

// Energy is one scale, so it reads as one colour getting stronger rather than
// five unrelated hues. Index 0 is unused; levels run 1–5.
const ENERGY_OPACITY = ['', '0.2', '0.36', '0.54', '0.76', '1']

const ENERGY_LABELS = ['', 'Exhausted', 'Low', 'Okay', 'Good', 'Energized']

// ── Rolling 7-day bar chart ───────────────────────────────────────────────────

function EnergyRecentChart({ days }: { days: DailyEnergy[] }) {
  /**
   * `days` arrives as exactly seven local days, oldest first, empty ones
   * included — built server-side where the timezone is known. This component
   * deliberately does no date arithmetic: the version that did built its keys
   * from a local `Date` run through `toISOString()` and silently failed to
   * match the server's east of UTC.
   */
  const filled = days.map(d => (d.count > 0 ? d : null))

  function dayLabel(i: number) {
    if (i === days.length - 1) return 'Today'
    if (i === days.length - 2) return 'Yday'
    // Noon UTC, read back as UTC: a day string formatted without ever becoming
    // a local instant that could land on the day either side.
    return new Date(days[i].date + 'T12:00:00Z')
      .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  }

  const hasAny = filled.some(Boolean)

  return (
    <Panel title="Energy — last 7 days" sub="Average self-reported level per day (1–5)">
      {!hasAny ? (
        <Empty>Log your energy from the sidebar to see trends here</Empty>
      ) : (
        <div>
          <div className="flex items-end gap-2 h-24">
            {filled.map((entry, i) => {
              const avg = entry?.avg ?? 0
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                  title={entry
                    ? `${ENERGY_LABELS[Math.round(avg)]} · ${entry.count} log${entry.count !== 1 ? 's' : ''}`
                    : 'No logs'}
                >
                  <span className="text-[10px] font-medium tabular-nums text-slate-400">
                    {entry ? avg.toFixed(1) : ''}
                  </span>
                  <div
                    className="w-full max-w-[44px] rounded-sm transition-all bg-accent-500"
                    style={{
                      height: `${Math.max((avg / 5) * 72, entry ? 4 : 0)}px`,
                      opacity: entry ? Number(ENERGY_OPACITY[Math.round(avg)] || 1) : 0,
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="h-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex gap-2 mt-1.5">
            {filled.map((_, i) => (
              <span key={i} className="flex-1 text-center text-[10px] text-slate-400">{dayLabel(i)}</span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── Time-of-day heatmap ───────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)   // 6 AM → 11 PM

/**
 * Opacity for an energy level, 0 for an empty cell.
 *
 * The heatmap reads as one colour getting stronger, the same scale the 7-day
 * bars use. It used to be five unrelated hues, which made a cell's colour say
 * "which category" when the thing it encodes is "how much".
 */
function levelOpacity(level: number): number {
  if (level <= 0) return 0
  const idx = Math.round(Math.min(Math.max(level, 1), 5))
  return Number(ENERGY_OPACITY[idx])
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
    <Panel title="Energy by time of day">
      <p className="text-[11px] text-slate-400 -mt-3 mb-4">
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
                      className={`flex-1 h-5 rounded-sm transition-colors ${
                        level > 0 ? 'bg-accent-500' : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                      style={level > 0 ? { opacity: levelOpacity(level) } : undefined}
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
                  <div className="w-3 h-3 rounded-sm bg-accent-500" style={{ opacity: levelOpacity(v) }} />
                  <span className="text-[9px] text-slate-400">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
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

      <div className="px-6 py-5 flex flex-col gap-5">

        {/* Headline numbers */}
        <StatStrip
          items={[
            { label: 'Active tasks',   value: activeCount },
            { label: 'Done',           value: doneCount, sub: 'all time' },
            { label: 'Est. remaining', value: formatMinutes(totalEstMinutes) },
            { label: 'Avg urgency',    value: Math.round(avgUrgency), sub: 'across active tasks', accent: urgencyColor },
          ]}
        />

        {/* Two full-width charts stacked left a lot of empty panel beside them
            once the width cap came off, so they pair up when there is room. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <UrgencyChart buckets={urgencyBuckets} />
          <ProjectWorkload stats={projectStats} />
        </div>

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
