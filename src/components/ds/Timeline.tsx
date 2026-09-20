/**
 * The day, top to bottom — events in time order with free slots as their own
 * rows, each saying what fits in it.
 *
 * A drawn hour column was considered and rejected: working hours here run
 * 10:00 to 01:30, so a full axis is fifteen and a half hours, which is a
 * scroll rather than a glance. Heights are compressed but keep their ordering,
 * so a three-hour block still reads as longer than a one-hour one.
 *
 * **This is where the recommendation lives.** There is no "do this now" card;
 * each free slot names what fits in *it*, which is the same answer with the
 * context that makes it good.
 */

import { formatDuration } from '@/lib/duration'
import { formatClock, type ShapeRow } from '@/lib/home'

/** Roughly proportional, compressed: 1h ≈ 48px, 2h ≈ 62px, 3h ≈ 84px. */
function heightFor(minutes: number): number {
  return Math.round(Math.min(96, 34 + Math.sqrt(Math.max(minutes, 10)) * 2.4))
}

function Time({ ms, tz }: { ms: number; tz: string }) {
  return (
    <span className="num w-[52px] shrink-0 text-right text-micro text-ink-faint pt-[3px]">
      {formatClock(ms, tz)}
    </span>
  )
}

export function Timeline({ rows, tz, windowLabel, onOpen, onFill, onDecideLink }: {
  rows:        ShapeRow[]
  tz:          string
  /** "10:00am — 1:30am", the working window, beside the heading. */
  windowLabel: string | null
  onOpen?:     (taskId: string) => void
  onFill?:     (startMs: number) => void
  onDecideLink?: (taskId: string, eventId: string, confirm: boolean) => void
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">The day</h2>
        {windowLabel && <span className="num text-micro text-ink-ghost ml-auto">{windowLabel}</span>}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line-soft">
        {rows.map(row => row.kind === 'event'
          ? <EventRow key={row.key} row={row} tz={tz} onDecideLink={onDecideLink} />
          : <SlotRow key={row.key} row={row} tz={tz} onOpen={onOpen} onFill={onFill} />)}
      </div>
    </section>
  )
}

function EventRow({ row, tz, onDecideLink }: {
  row: Extract<ShapeRow, { kind: 'event' }>
  tz:  string
  onDecideLink?: (taskId: string, eventId: string, confirm: boolean) => void
}) {
  const past = row.position === 'past'
  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 ${past ? 'opacity-45' : ''}`}
      style={{ minHeight: heightFor(Math.round((row.endMs - row.startMs) / 60_000)) }}
    >
      <Time ms={row.startMs} tz={tz} />
      {/* A continuous coloured bar, not a card border: the rail is the thing
          that makes a run of rows read as one day. */}
      <span
        aria-hidden
        className="w-[3px] self-stretch rounded-full shrink-0"
        style={{ background: row.color ?? 'var(--line-strong)' }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-ink truncate">{row.title}</p>
        {row.meta && <p className="text-micro text-ink-faint mt-0.5">{row.meta}</p>}
        {row.suggestion && onDecideLink && (
          /**
           * The one question the day asks.
           *
           * Its own block rather than an inline chip, which is the same markup
           * at both widths: beside the title on a wide screen, a full-width
           * strip under it on a narrow one.
           *
           * The two buttons are not equal. Accepting changes `capacity()`;
           * rejecting is reversible. So accept is filled and they are spaced —
           * two flush, equal-weight targets, one of which means no, is a
           * mis-tap generator.
           */
          <div
            className="mt-1.5 rounded-ctrl px-2.5 py-2 flex items-center gap-2 flex-wrap"
            style={{ background: 'var(--accent-tint)' }}
          >
            <p className="text-micro text-accent-ink flex-1 min-w-[12rem]">
              Covers “{row.suggestion.taskTitle}”?
            </p>
            <div className="flex items-center" style={{ gap: 'var(--gap-target)' }}>
              <button
                onClick={() => onDecideLink(row.suggestion!.taskId, row.key.replace(/^e:/, ''), true)}
                className="bg-accent-600 text-white rounded-chip px-3 text-micro font-medium
                           hover:bg-accent-700 transition-colors"
                style={{ minHeight: 'var(--tap-min)' }}
              >
                Yes, it covers it
              </button>
              <button
                onClick={() => onDecideLink(row.suggestion!.taskId, row.key.replace(/^e:/, ''), false)}
                className="text-ink-muted rounded-chip px-3 text-micro border border-line-strong
                           hover:border-ink-faint transition-colors"
                style={{ minHeight: 'var(--tap-min)' }}
              >
                No
              </button>
            </div>
          </div>
        )}

        {row.coversTitle && (
          /* A confirmed link, stated where the double-counting used to happen.
             Its hour is out of `dueTotal` because this event is already
             doing it. */
          <p className="text-micro text-ok mt-1 inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5"
             style={{ background: 'var(--ok-tint)' }}>
            covers task “{row.coversTitle}”
          </p>
        )}
      </div>
    </div>
  )
}

function SlotRow({ row, tz, onOpen, onFill }: {
  row:     Extract<ShapeRow, { kind: 'gap' }>
  tz:      string
  onOpen?: (taskId: string) => void
  onFill?: (startMs: number) => void
}) {
  const expanded = row.position === 'current' || row.position === 'next'
  const past     = row.position === 'past'

  // Past slots hold nothing you can act on, so they collapse to a line. Later
  // ones say how much and how many, which is enough to decide to tap.
  if (past || !expanded) {
    return (
      <div className={`flex items-baseline gap-3 px-4 py-1.5 ${past ? 'opacity-40' : ''}`}>
        <Time ms={row.startMs} tz={tz} />
        <span className="num text-micro text-accent-600">{formatDuration(row.minutes)} free</span>
        {!past && row.fits.length > 0 && (
          <span className="text-micro text-ink-faint">· {row.fits.length} fit</span>
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 ${row.late ? 'bg-surface-quiet' : ''}`}
      style={{ minHeight: heightFor(row.minutes) }}
    >
      <Time ms={row.startMs} tz={tz} />
      <span
        aria-hidden
        className="w-[3px] self-stretch shrink-0 rounded-full"
        style={{ borderLeft: '3px dashed var(--line-strong)' }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="num text-accent-600 font-medium">{formatDuration(row.minutes)} free</span>
          <span className="text-ink-faint"> until {formatClock(row.endMs, tz)}</span>
        </p>

        {row.late && (
          /* The same threshold that splits the capacity bar. A long block
             after ten at night is time you have, not time you will use well,
             and saying so is the difference between a plan and a total. */
          <p className="text-micro text-ink-muted mt-0.5">
            your longest block today — and it is after {formatClock(row.startMs, tz)}
          </p>
        )}

        {row.fits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {row.fits.map(f => (
              <button
                key={f.key}
                onClick={() => onOpen?.(f.taskIds[0])}
                className="inline-flex items-center gap-1.5 rounded-chip border border-line-soft
                           bg-surface px-2 py-1 text-micro text-ink-2 hover:border-accent-400 transition-colors"
              >
                {f.title}
                <span className="num text-ink-faint">{formatDuration(f.minutes)}</span>
              </button>
            ))}
            {onFill && (
              <button
                onClick={() => onFill(row.startMs)}
                className="text-micro text-accent-600 hover:underline underline-offset-2 px-1"
              >
                Fill automatically
              </button>
            )}
          </div>
        ) : (
          <p className="text-micro text-ink-ghost mt-1">Nothing left fits here.</p>
        )}
      </div>
    </div>
  )
}
