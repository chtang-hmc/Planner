/**
 * Fourteen days, due against free, on one scale.
 *
 * The comparison across columns *is* the component. A strip whose bars carry
 * no scale is decoration; this one makes a due-date problem visible at a
 * glance — on the reference data, everything owed sits in the next three days
 * and the other eleven are empty.
 *
 * Narrow (A2): seven columns with a pager rather than a scroll. Horizontal
 * scroll hides half the argument behind an invisible affordance, and the
 * argument is the comparison.
 */

import { formatMinutes } from '@/lib/task-format'
import { barHeight, STRIP_BAR_HEIGHT, type StripColumn, type WeekStrip as Strip } from '@/lib/week-strip'

export function WeekStrip({ strip, finding, onPick, selected }: {
  strip:     Strip
  finding:   string | null
  onPick?:   (day: string) => void
  selected?: string | null
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">Due against free, by day</h2>
        {finding && <p className="text-micro text-ink-muted">{finding}</p>}
      </div>

      <div className="rounded-xl border border-line bg-surface px-3 py-3">
        <div className="flex gap-1">
          {strip.columns.map(c => (
            <Column
              key={c.day}
              column={c}
              scale={strip.scaleMinutes}
              selected={c.day === selected}
              onPick={onPick}
            />
          ))}
        </div>

        <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-line-soft flex-wrap">
          <Key swatch="var(--bar-free)" label="free calendar" />
          <Key swatch="var(--ok)" label="work due, fits" />
          <Key swatch="var(--danger)" label="work due, does not fit" />
        </div>
      </div>
    </section>
  )
}

function Key({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="text-micro text-ink-muted flex items-center gap-1.5">
      <span aria-hidden className="w-2 h-2 rounded-[2px]" style={{ background: swatch }} />
      {label}
    </span>
  )
}

function Column({ column, scale, selected, onPick }: {
  column:   StripColumn
  scale:    number
  selected: boolean
  onPick?:  (day: string) => void
}) {
  const { letter, date, freeMinutes, dueMinutes, deficit, isToday, dayOff } = column

  return (
    <button
      onClick={() => onPick?.(column.day)}
      className={`flex-1 min-w-0 flex flex-col items-center gap-1 rounded-ctrl py-1.5 transition-colors ${
        selected ? 'ring-1 ring-accent-400' : 'hover:bg-surface-quiet'
      }`}
      style={isToday
        ? { background: 'var(--today-fill)', border: '1px solid var(--today-edge)' }
        : { border: '1px solid transparent' }}
      title={`${formatMinutes(dueMinutes)} due · ${formatMinutes(freeMinutes)} free`}
    >
      <span className="num text-ink-ghost" style={{ fontSize: 9.5 }}>{letter}</span>
      <span className={`num ${isToday ? 'text-ink font-medium' : 'text-ink-2'}`} style={{ fontSize: 14 }}>
        {date}
      </span>

      {/* Bottom-aligned, so the tops of the bars carry the comparison. */}
      <div className="flex items-end justify-center gap-[3px]" style={{ height: STRIP_BAR_HEIGHT }}>
        {dayOff ? (
          /* No working hours is not zero free time to be drawn as a flat bar —
             it is a day with no ratio at all. A dash says so. */
          <span className="text-micro text-ink-ghost self-center">—</span>
        ) : (
          <>
            <span
              className="w-[11px] rounded-[2px]"
              style={{ height: barHeight(freeMinutes, scale), background: 'var(--bar-free)' }}
            />
            <span
              className="w-[11px] rounded-[2px]"
              style={{
                height: barHeight(dueMinutes, scale),
                background: deficit > 0 ? 'var(--danger)' : 'var(--ok)',
              }}
            />
          </>
        )}
      </div>

      <span className="num text-danger" style={{ fontSize: 9.5, minHeight: 12 }}>
        {deficit > 0 ? `−${formatMinutes(deficit)}` : ''}
      </span>
    </button>
  )
}
