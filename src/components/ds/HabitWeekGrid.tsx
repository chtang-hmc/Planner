/**
 * This week: habits down, days across, every square a control.
 *
 * The useful part of the 16-week heatmap at the resolution people act on. The
 * heatmap could only be read; this can be corrected — the common case is
 * having done the thing and forgotten to log it, and there was nowhere on the
 * page to say so.
 *
 * The first column is the configured first day of the week, and the letters
 * derive from it. Monday was an accident of the reference drawing.
 */

import { weekGrid, weekRangeLabel, type GridDay } from '@/lib/habit-stats'

export interface GridRow {
  id:    string
  title: string
  days:  string[]
}

export function HabitWeekGrid({ rows, weekStartStr, todayStr, pending, onToggle }: {
  rows:         GridRow[]
  weekStartStr: string
  todayStr:     string
  /** `title|day` keys currently being written. */
  pending:      Set<string>
  onToggle:     (title: string, day: string, next: boolean) => void
}) {
  if (rows.length === 0) return null
  const header = weekGrid([], weekStartStr, todayStr)

  return (
    <section className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-baseline gap-3 px-4 py-2.5">
        <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">This week</h2>
        <span className="num text-micro text-ink-2">{weekRangeLabel(weekStartStr)}</span>
      </div>

      <div className="px-4 pb-1 flex items-center gap-3">
        <span className="flex-1 min-w-0" />
        {header.map(d => (
          <span key={d.day}
                className={`w-[30px] shrink-0 text-center text-eyebrow ${
                  d.today ? 'text-accent-600 font-semibold' : 'text-ink-ghost'
                }`}>
            {d.letter}
          </span>
        ))}
      </div>

      <div className="border-t border-line-soft divide-y divide-line-soft">
        {rows.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-1">
            <span className="flex-1 min-w-0 text-[13px] text-ink-2 truncate">{r.title}</span>
            {weekGrid(r.days, weekStartStr, todayStr).map(d => (
              <Square
                key={d.day}
                day={d}
                title={r.title}
                busy={pending.has(`${r.title}|${d.day}`)}
                onToggle={onToggle}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="px-4 py-2 text-micro text-ink-ghost border-t border-line-soft">
        Click any square to log or unlog that day.
      </p>
    </section>
  )
}

function Square({ day, title, busy, onToggle }: {
  day: GridDay; title: string; busy: boolean
  onToggle: (title: string, day: string, next: boolean) => void
}) {
  /* A future square is drawn, because the week has a shape, but it is not a
     control: `setHabitCompletion` refuses a future date and a button that is
     always rejected is a button that lies. */
  if (day.future) {
    return (
      <span aria-hidden className="w-[30px] h-[30px] shrink-0 rounded-ctrl"
            style={{ border: '1px dashed var(--line-soft)' }} />
    )
  }

  return (
    <button
      onClick={() => onToggle(title, day.day, !day.done)}
      disabled={busy}
      aria-label={`${day.done ? 'Unlog' : 'Log'} ${title} on ${day.day}`}
      aria-pressed={day.done}
      className="w-[30px] h-[30px] shrink-0 rounded-ctrl transition-colors disabled:opacity-40
                 flex items-center justify-center"
      style={{
        background: day.done ? 'var(--ok)' : 'var(--track-soft)',
        border: day.today ? '1px solid var(--today-edge)' : '1px solid transparent',
      }}
    >
      {day.done && <span className="text-white text-[13px] leading-none">✓</span>}
    </button>
  )
}
