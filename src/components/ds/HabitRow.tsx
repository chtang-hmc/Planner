/**
 * One habit, as a row.
 *
 * Five habits in the space one card used. The card carried a 24px `+` in a
 * corner, three tiles holding the same number, and a 16-week heatmap — 448
 * squares to represent twelve piano sessions. What survives is the part you
 * act on: the log button at the head of the row, four weeks of dots, this
 * week, and the streak.
 */

import { formatMinutes } from '@/lib/task-format'
import {
  dotStrip, type Cadence, type WeekProgress, type Streak, type StripDay,
} from '@/lib/habit-stats'

export interface HabitRowModel {
  id:       string
  title:    string
  cadence:  Cadence
  minutes:  number | null
  /** Wall-clock time this usually happens, if it has one. */
  timeLabel: string | null
  /** Unique local completion days, ascending. */
  days:     string[]
  week:     WeekProgress
  streak:   Streak | null
  doneToday: boolean
  pending:  boolean
}

export function HabitRow({ habit, todayStr, onLog, onOpen }: {
  habit:    HabitRowModel
  todayStr: string
  onLog:    () => void
  onOpen:   () => void
}) {
  const { title, cadence, minutes, timeLabel, week, streak, doneToday, pending } = habit
  const strip = dotStrip(habit.days, todayStr)

  return (
    <div className="flex items-center gap-3 px-4 min-h-[52px] hover:bg-surface-quiet transition-colors">
      {/* The log target is the row's head, at the full tap minimum — not a
          24px glyph in a corner, which is what made logging one feel fiddly. */}
      <button
        onClick={onLog}
        disabled={pending}
        aria-label={doneToday ? `Un-log ${title} for today` : `Log ${title} for today`}
        aria-pressed={doneToday}
        className={`shrink-0 rounded-full border-2 transition-colors disabled:opacity-40 ${
          doneToday
            ? 'border-transparent'
            : 'border-line-strong hover:border-accent-500 hover:bg-accent-50'
        }`}
        style={{
          width: 'var(--tap-min)', height: 'var(--tap-min)',
          background: doneToday ? 'var(--ok)' : undefined,
        }}
      >
        {doneToday && <span className="text-white text-[15px] leading-none">✓</span>}
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left py-1.5">
        <span className="block text-[14px] text-ink truncate">{title}</span>
        <span className="block num text-micro text-ink-faint truncate">
          {cadence.label}
          {minutes != null && <> · {formatMinutes(minutes)}</>}
          {timeLabel && <> · {timeLabel}</>}
        </span>
      </button>

      <span className="hidden mid:flex shrink-0 items-end gap-[2px]" aria-hidden>
        {strip.map(d => <Dot key={d.day} day={d} />)}
      </span>

      <span className="w-[52px] shrink-0 text-right num text-small">
        <WeekCell week={week} />
      </span>

      <span className={`w-[42px] shrink-0 text-right num text-small ${
        streak && streak.value > 0 ? 'text-ink-2' : 'text-ink-ghost'
      }`}>
        {/* The unit lives in the cell, always. `12d` and `2w` mean different
            things and a column headed STREAK cannot say which this is. */}
        {streak === null ? '—' : streak.value === 0 ? '—' : `${streak.value}${streak.unit}`}
      </span>
    </div>
  )
}

function Dot({ day }: { day: StripDay }) {
  return (
    <span
      title={day.day}
      className="w-[6px] rounded-[1px]"
      style={{
        height: day.done ? 14 : 6,
        background: day.done ? 'var(--ok)' : day.weekend ? 'var(--track)' : 'var(--track-soft)',
      }}
    />
  )
}

/**
 * `6/7`, `3/2`, or a plain `1`.
 *
 * Over-target keeps the true numerator and colours it: `3/2` reads oddly as a
 * fraction, but capping it at the target would be lying about the week. A
 * habit with no target gets a count, never `1/—` — a fraction with an empty
 * denominator is not a number.
 */
function WeekCell({ week }: { week: WeekProgress }) {
  if (week.target === null) {
    return <span className={week.count > 0 ? 'text-ok' : 'text-ink-ghost'}>{week.count}</span>
  }
  return (
    <>
      <span className={week.met ? 'text-ok font-medium' : 'text-ink-2'}>{week.count}</span>
      <span className="text-ink-faint">/{week.target}</span>
    </>
  )
}

export function HabitTableHeader() {
  const cell = 'text-eyebrow uppercase tracking-wider text-ink-ghost'
  return (
    <div className="flex items-center gap-3 px-4 h-[30px]">
      <span className="shrink-0" style={{ width: 'var(--tap-min)' }} />
      <span className="flex-1" />
      <span className={`hidden mid:block ${cell}`} style={{ width: 28 * 8 - 2 }}>Last 4 weeks</span>
      <span className={`w-[52px] shrink-0 text-right ${cell}`}>Week</span>
      <span className={`w-[42px] shrink-0 text-right ${cell}`}>Streak</span>
    </div>
  )
}
