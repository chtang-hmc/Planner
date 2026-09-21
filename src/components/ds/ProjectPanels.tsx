/**
 * The right-hand column of a project: about, estimate accuracy, repeating.
 *
 * These are the three things the old detail page never said, and the reason it
 * felt hollow while also being too loud — a quarter of the viewport went to
 * four billboard numbers and none of it to what the project *is*.
 */

import { formatMinutes } from '@/lib/task-format'
import { formatDuration } from '@/lib/duration'
import { nextLanding, type RepeatingTask, type LinkedEvent, type ProjectStats } from '@/lib/project-detail'

/**
 * One stat line, not four billboards.
 *
 * The page it replaces gave a quarter of the viewport to four cards that
 * between them said "2 tasks". Every number they carried is here, in one 74px
 * card, plus the one thing they never had: a sentence saying what the numbers
 * mean today.
 */
export function StatLine({ stats, context, color }: {
  stats: ProjectStats
  context: string | null
  color: string
}) {
  const { activeCount, doneCount, minutesLeft, progress } = stats

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-meta text-ink-2">
          <span className="num text-ink font-semibold">{activeCount}</span> active ·{' '}
          <span className="num text-ink font-semibold">{doneCount}</span> done ·{' '}
          <span className="num text-ink font-semibold">{formatMinutes(minutesLeft)}</span> left
        </span>
        <span className="flex-1 min-w-[80px]" />
        <span className="flex items-center gap-2 shrink-0">
          <span className="w-[96px] h-[5px] rounded-full bg-track overflow-hidden flex">
            {progress !== null && progress > 0 && (
              <span style={{ width: `${progress * 100}%`, background: color }} />
            )}
          </span>
          <span className="num text-micro text-ink-2 w-8 text-right">
            {progress === null ? '—' : `${Math.round(progress * 100)}%`}
          </span>
        </span>
      </div>
      {/* Null on an ordinary project, and that is the common case. A line that
          always renders has to invent something. */}
      {context && <p className="text-micro text-ink-muted">{context}</p>}
    </div>
  )
}

export function AboutPanel({ description, onEdit }: {
  description: string | null | undefined
  onEdit: () => void
}) {
  const text = description?.trim()

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-eyebrow uppercase tracking-wider text-ink-faint">About</h3>
      {text ? (
        <button onClick={onEdit}
                className="text-left text-meta text-ink-2 leading-relaxed hover:text-ink transition-colors">
          {text}
        </button>
      ) : (
        /* Dashed, and it asks a question. An empty bordered box would read as
           a field that failed to load; this one reads as a thing to do. */
        <button
          onClick={onEdit}
          className="rounded-ctrl px-3 py-3 text-left text-meta text-ink-faint
                     hover:text-accent-600 hover:border-accent-300 transition-colors"
          style={{ border: '1px dashed var(--line-strong)' }}
        >
          No description yet · <span className="text-accent-600">Say what this project is for →</span>
        </button>
      )}
    </section>
  )
}

export function RepeatingPanel({ items, todayStr, onOpen }: {
  items: RepeatingTask[]
  todayStr: string
  onOpen?: (id: string) => void
}) {
  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-eyebrow uppercase tracking-wider text-ink-faint">Repeating</h3>
      <div className="flex flex-col gap-3">
        {items.map(r => (
          <div key={r.id} className="flex flex-col gap-0.5">
            <button onClick={() => onOpen?.(r.id)}
                    className="text-left text-meta text-ink font-medium hover:text-accent-600 transition-colors">
              {r.title}
            </button>
            <span className="num text-micro text-ink-faint">
              {r.cadence}{r.minutes != null && <> · {formatMinutes(r.minutes)}</>}
            </span>
            <p className="text-micro text-ink-muted">
              {nextLanding(r.nextDue, todayStr)}
              {/* Only when there is a history to read. "It has never been late"
                  about a task that has never run is a claim about nothing. */}
              {r.history && <> {r.history}</>}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * What this project has on the calendar.
 *
 * The old page showed none of this: Clinic had two meetings that week and the
 * project page mentioned neither. The link is the user's own confirmation that
 * an event covers a task here — never a guess.
 */
export function CalendarPanel({ events, total, tz, onOpen }: {
  events: LinkedEvent[]
  total:  string
  tz:     string
  onOpen?: (id: string) => void
}) {
  return (
    <section className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-baseline gap-3 px-4 py-2.5">
        <h3 className="text-eyebrow uppercase tracking-wider text-ink-faint">On the calendar</h3>
        <span className="flex-1" />
        {events.length > 0 && <span className="num text-micro text-ink-2">{total} this week</span>}
      </div>

      {events.length === 0 ? (
        <p className="px-4 pb-3 text-micro text-ink-ghost">
          Nothing on the calendar is linked to this project yet.
        </p>
      ) : (
        <div className="border-t border-line-soft divide-y divide-line-soft">
          {events.map(e => (
            <button key={e.id} onClick={() => onOpen?.(e.id)}
                    className="w-full flex items-center gap-3 px-4 h-[34px] text-left hover:bg-surface-quiet transition-colors">
              <span className="text-[13px] text-ink truncate flex-1">{e.title}</span>
              <span className="num text-micro text-ink-faint shrink-0">
                {dayAndTime(e.startMs, e.allDay, tz)}
                {!e.allDay && <> · {formatDuration(e.minutes)}</>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** `Mon 12:00`, or `Mon` for an all-day event. */
function dayAndTime(ms: number, allDay: boolean, tz: string): string {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(ms)
  if (allDay) return day
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(ms).toLowerCase().replace(' ', '')
  return `${day} ${time}`
}
