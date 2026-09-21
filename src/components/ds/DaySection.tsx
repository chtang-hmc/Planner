/**
 * One day on Upcoming: what is on it, what is free in it, and whether the two
 * are compatible.
 *
 * **Expanded by proximity, not by preference.** Today and tomorrow are open
 * because they are the days you can still act on; the rest collapse to a
 * summary row you can open. A fortnight of fully expanded days is a scroll,
 * and the week strip above already carries the comparison across them.
 *
 * Free slots appear inline, between the events, because *where* the free time
 * falls is the thing a list of totals cannot tell you — a day with three free
 * hours in one block and a day with three free hours in six pieces are
 * different days.
 */

import { formatDuration } from '@/lib/duration'
import { formatMinutes } from '@/lib/task-format'
import { capacityVerdict, type Capacity } from '@/lib/capacity'
import { CapacityMeter, VERDICT_CLASS } from '@/components/ds/CapacityMeter'
import { formatClock } from '@/lib/home'

export interface DayRowModel {
  key:     string
  startMs: number
  endMs:   number
  title:   string
  /** Project colour for the rail; null for a plain calendar event. */
  color:   string | null
  minutes: number
  chip?:   string | null
  /** Partially overlaps another event on this day — see lib/conflicts. */
  clashes?: boolean
}

/**
 * An event with no time in the day, only the day itself.
 *
 * Drawn above the timeline rather than in it, because it has no place in it: a
 * clock column would have to invent one, and sorting it by its UTC midnight
 * would file it before the first working hour of every day.
 */
export interface DayAllDayModel {
  key:   string
  title: string
  color: string | null
}

export interface DaySlotModel {
  key:     string
  startMs: number
  minutes: number
  /** "4 tasks fit", "Clinic Work Log + Organize Laundry fit exactly". */
  reason:  string | null
}

export function DaySection({
  label, weekday, isToday, capacity, rows, slots, allDay = [], expanded, conflictCount,
  unplacedCount, unplacedMinutes, tz, action, dropActive, children,
  onToggle, onOpen, onAction,
}: {
  label:         string
  weekday:       string
  isToday:       boolean
  /** Omitted on a day with no working hours — there is no ratio to draw. */
  capacity:      Capacity | null
  rows:          DayRowModel[]
  slots:         DaySlotModel[]
  /** Events that belong to the day but not to a time in it. */
  allDay?:       DayAllDayModel[]
  expanded:      boolean
  conflictCount: number
  unplacedCount:   number
  unplacedMinutes: number
  tz:            string
  /** "Move 2h here from today" on a day with slack, "Push work here" on an empty one. */
  action:        string | null
  /** A task is being dragged over this day — see UpcomingView. */
  dropActive?:   boolean
  /**
   * The day's tasks, drawn by the caller.
   *
   * They sit below the timeline rather than inside it because they are a
   * different kind of thing: the timeline is when the day happens, and these
   * are what is owed on it, most of which has no time yet. They are also what
   * you drag between days, which is the reason this view exists.
   */
  children?:     React.ReactNode
  onToggle?:     () => void
  onOpen?:       (key: string) => void
  onAction?:     () => void
}) {
  const verdict = capacity ? capacityVerdict(capacity) : null

  // Interleaved by time, so a free slot sits where it actually falls rather
  // than in a list of its own beneath the day.
  const timeline = [
    ...rows.map(r => ({ at: r.startMs, node: <DayRow key={r.key} row={r} tz={tz} onOpen={onOpen} /> })),
    ...slots.map(s => ({ at: s.startMs, node: <SlotRow key={s.key} slot={s} tz={tz} /> })),
  ].sort((a, b) => a.at - b.at)

  return (
    <section className={`rounded-xl border bg-surface overflow-hidden transition-colors ${
      dropActive ? 'border-accent-400 ring-1 ring-accent-300' : 'border-line'
    }`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-quiet transition-colors flex-wrap"
        style={{ minHeight: 'var(--tap-min)' }}
        aria-expanded={expanded}
      >
        <span className={`text-[13px] font-semibold ${isToday ? 'text-ink' : 'text-ink-2'}`}>{label}</span>
        {isToday && <span className="text-micro text-accent-600">today</span>}
        <span className="text-micro text-ink-ghost">{weekday}</span>

        {capacity && (
          <>
            <span className="num text-micro text-ink-faint">
              {formatMinutes(capacity.dueTotal)} due · {formatMinutes(capacity.freeBeforeCutoff + capacity.freeAfterCutoff)} free
            </span>
            <CapacityMeter capacity={capacity} className="w-[96px]" />
          </>
        )}
        {verdict && verdict.tone !== 'empty' && (
          <span className={`text-micro ${VERDICT_CLASS[verdict.tone]}`}>{verdict.text}</span>
        )}

        {conflictCount > 0 && (
          /* Only partial overlaps reach here. An event nested inside a longer
             one is deliberate and says nothing worth flagging. */
          <span className="text-micro text-danger rounded-chip px-1.5 py-0.5"
                style={{ background: 'var(--danger-tint)' }}>
            {conflictCount} clash{conflictCount === 1 ? '' : 'es'}
          </span>
        )}

        <span className="ml-auto text-micro text-ink-ghost">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="border-t border-line-soft divide-y divide-line-soft">
          {allDay.map(a => <AllDayRow key={a.key} row={a} onOpen={onOpen} />)}
          {timeline.map(t => t.node)}
          {children}
          {timeline.length === 0 && allDay.length === 0 && !children && (
            <p className="px-4 py-5 text-center text-micro text-ink-ghost">Nothing on this day.</p>
          )}
        </div>
      )}

      {expanded && unplacedCount > 0 && (
        /* The footer the spec asks for: a day that cannot hold its own work
           says so at the bottom, where you have just finished reading why. */
        <div className="flex items-center gap-3 px-4 py-2 border-t border-line"
             style={{ background: 'var(--danger-tint)' }}>
          <span className="num text-micro text-ink-2">
            {unplacedCount} task{unplacedCount === 1 ? '' : 's'} still unplaced ·{' '}
            {formatMinutes(unplacedMinutes)} with nowhere to go
          </span>
          {action && (
            <button onClick={onAction}
                    className="ml-auto text-micro text-accent-600 hover:underline underline-offset-2">
              {action}
            </button>
          )}
        </div>
      )}

      {expanded && unplacedCount === 0 && action && (
        <div className="flex px-4 py-2 border-t border-line-soft">
          <button onClick={onAction}
                  className="ml-auto text-micro text-accent-600 hover:underline underline-offset-2">
            {action}
          </button>
        </div>
      )}
    </section>
  )
}

function DayRow({ row, tz, onOpen }: {
  row: DayRowModel; tz: string; onOpen?: (key: string) => void
}) {
  return (
    <button
      onClick={() => onOpen?.(row.key)}
      className={`w-full flex items-center gap-3 px-4 h-[34px] text-left hover:bg-surface-quiet transition-colors ${
        row.clashes ? 'bg-danger-tint' : ''
      }`}
    >
      <span className="num w-[46px] shrink-0 text-right text-micro text-ink-faint">
        {formatClock(row.startMs, tz)}
      </span>
      <span aria-hidden className="w-[3px] h-[18px] rounded-full shrink-0"
            style={{ background: row.color ?? 'var(--line-strong)' }} />
      <span className="text-[13px] text-ink truncate flex-1">{row.title}</span>
      {row.chip && <span className="text-micro text-ink-faint shrink-0">{row.chip}</span>}
      <span className="num w-[56px] shrink-0 text-right text-micro text-ink-2">
        {formatDuration(row.minutes)}
      </span>
    </button>
  )
}

function AllDayRow({ row, onOpen }: {
  row: DayAllDayModel; onOpen?: (key: string) => void
}) {
  return (
    <button
      onClick={() => onOpen?.(row.key)}
      className="w-full flex items-center gap-3 px-4 h-[34px] text-left hover:bg-surface-quiet transition-colors"
    >
      <span className="w-[46px] shrink-0 text-right text-micro text-ink-ghost">all day</span>
      <span aria-hidden className="w-[3px] h-[18px] rounded-full shrink-0"
            style={{ background: row.color ?? 'var(--line-strong)' }} />
      <span className="text-[13px] text-ink truncate flex-1">{row.title}</span>
    </button>
  )
}

function SlotRow({ slot, tz }: { slot: DaySlotModel; tz: string }) {
  return (
    <div className="flex items-center gap-3 px-4 h-[34px]">
      <span className="num w-[46px] shrink-0 text-right text-micro text-ink-faint">
        {formatClock(slot.startMs, tz)}
      </span>
      {/* Dashed where an event's rail is solid: the difference between time
          that is spoken for and time that is not. */}
      <span aria-hidden className="w-[3px] h-[18px] shrink-0"
            style={{ borderLeft: '3px dashed var(--line-strong)' }} />
      <span className="num text-micro text-accent-600 font-medium">
        {formatDuration(slot.minutes)} free
      </span>
      {slot.reason && <span className="text-micro text-ink-faint truncate">{slot.reason}</span>}
    </div>
  )
}
