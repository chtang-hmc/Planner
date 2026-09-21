/**
 * Every project on the same axes.
 *
 * The card grid it replaces forced a one-task project and a six-task project
 * to the same size, so nothing on the page was comparable — which is the only
 * reason to have an overview at all. A table is comparable by construction:
 * one column, one question, read straight down.
 *
 * **Columns shed by rank, not by shrinking.** Below 1200 share of time goes
 * first, because it is the one column that is only meaningful against the
 * whole table and the whole table stops being visible at once. Then the active
 * count and the progress percentage, then the next due date onto a meta line.
 * Name, time left, progress bar and status survive to 390px.
 */

import { formatMinutes } from '@/lib/task-format'
import { dueShort, type ProjectRow, type StatusTone } from '@/lib/projects'

/**
 * Three tones for the spec's four.
 *
 * The spec asks for orange on `Never started`, concentration and `Stalled`.
 * There is no orange: `--warn` was cut from the palette on purpose, because
 * banding a meter in four colours cost two hues that collided with two project
 * colours. `attention` is neutral ink on a filled chip instead — the same call
 * `VERDICT_CLASS` makes, where `tight` is deliberately not `ok`. The chips
 * carry words; the colour's job is to let you scan a column for red.
 */
const TONE: Record<StatusTone, { bg: string; className: string }> = {
  danger:    { bg: 'var(--danger-tint)',  className: 'text-danger' },
  attention: { bg: 'var(--track)',        className: 'text-ink-2 font-medium' },
  /* `quiet` is quiet, not unreadable: --ink-faint is 2.28:1 on white, and this
     chip is the row's status rather than a decoration. --ink-3 on the soft
     track reads at about 8:1 and still sits well below the other three. */
  quiet:     { bg: 'var(--track-soft)',   className: 'text-ink-3' },
  ok:        { bg: 'var(--ok-tint)',      className: 'text-ok' },
}

export function ProjectTable({ rows, todayStr, expanded, onToggle, onOpen, children }: {
  rows:     ProjectRow[]
  /** Today, for the narrow row's `due Tue 22`. */
  todayStr: string
  /** Which row is open. One at a time — two open rows stop being a table. */
  expanded: string | null
  onToggle: (id: string | null) => void
  onOpen:   (id: string | null) => void
  /** The open row's tasks, drawn by the caller. */
  children?: (row: ProjectRow) => React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <HeaderRow />
      {rows.map(r => {
        const key = r.id ?? 'inbox'
        const isOpen = expanded === (r.id ?? 'inbox')
        return (
          <div key={key} className="border-t border-line-soft">
            <Row row={r} open={isOpen} todayStr={todayStr} onToggle={() => onToggle(isOpen ? null : (r.id ?? 'inbox'))} onOpen={onOpen} />
            {isOpen && children && (
              <div className="bg-surface-quiet border-t border-line-soft">{children(r)}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HeaderRow() {
  const cell = 'text-eyebrow uppercase tracking-wider text-ink-ghost'
  return (
    // Column headers for a row that is no longer a row would name nothing.
    <div className="hidden narrow:flex items-center gap-3 px-4 h-[34px]">
      <span className="w-3 shrink-0" />
      <span className="w-[11px] shrink-0" />
      <span className={`flex-1 min-w-0 ${cell}`}>Project</span>
      <span className={`hidden mid:block w-[62px] shrink-0 text-right ${cell}`}>Active</span>
      <span className={`w-[64px] mid:w-[96px] shrink-0 text-right ${cell}`}>Progress</span>
      <span className={`w-[62px] shrink-0 text-right ${cell}`}>Left</span>
      <span className={`hidden wide:block w-[124px] shrink-0 ${cell}`}>Share of time</span>
      <span className={`w-[80px] shrink-0 ${cell}`}>Next due</span>
      <span className={`w-[150px] shrink-0 ${cell}`}>Status</span>
    </div>
  )
}

function Chevron({ open, name, onToggle }: {
  open: boolean; name: string; onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
      className="w-3 shrink-0 flex items-center justify-center text-ink-ghost hover:text-ink-2"
      style={{ minHeight: 'var(--tap-min)' }}
    >
      <span className="text-[10px] leading-none">{open ? '▾' : '▸'}</span>
    </button>
  )
}

function Dot({ color }: { color: string | null }) {
  return (
    <span aria-hidden className="w-[11px] shrink-0 flex">
      {/* Inbox gets the neutral line colour rather than a borrowed hue: it is
          the absence of a project, and a dot that looks like the others would
          say it is one more of them. */}
      <span className="w-2 h-2 rounded-full" style={{ background: color ?? 'var(--line-strong)' }} />
    </span>
  )
}

function Row(props: {
  row: ProjectRow; open: boolean; todayStr: string
  onToggle: () => void; onOpen: (id: string | null) => void
}) {
  return (
    <>
      <WideRow {...props} />
      <NarrowRow row={props.row} todayStr={props.todayStr} onOpen={props.onOpen} />
    </>
  )
}

function WideRow({ row, open, onToggle, onOpen }: {
  row: ProjectRow; open: boolean; onToggle: () => void; onOpen: (id: string | null) => void
}) {
  const { name, color, progress, minutesLeft, share, activeCount, status } = row

  return (
    <div className="hidden narrow:flex items-center gap-3 px-4 h-[54px] hover:bg-surface-quiet transition-colors">
      <Chevron open={open} name={name} onToggle={onToggle} />
      <Dot color={color} />

      <span className="flex-1 min-w-0 flex">
        <button onClick={() => onOpen(row.id)}
                className="text-[14px] font-medium text-ink truncate text-left hover:text-accent-600 transition-colors">
          {name}
        </button>
      </span>

      <span className="hidden mid:block w-[62px] shrink-0 num text-small text-ink-2 text-right">
        {activeCount} {activeCount === 1 ? 'task' : 'tasks'}
      </span>

      <span className="w-[64px] mid:w-[96px] shrink-0 flex items-center justify-end gap-2">
        <ProgressBar value={progress} color={color} />
        <span className={`hidden mid:block num text-micro w-8 text-right ${
          progress === 0 ? 'text-danger' : 'text-ink-2'
        }`}>
          {progress === null ? '—' : `${Math.round(progress * 100)}%`}
        </span>
      </span>

      <span className="w-[62px] shrink-0 num text-small text-ink text-right">
        {minutesLeft > 0 ? formatMinutes(minutesLeft) : '—'}
      </span>

      <span className="hidden wide:flex w-[124px] shrink-0 items-center">
        <ShareBar share={share} color={color} />
      </span>

      <span className="w-[80px] shrink-0 num text-micro">
        <DueText row={row} />
      </span>

      <span className="w-[150px] shrink-0 flex">
        <StatusChip status={status} />
      </span>
    </div>
  )
}

/**
 * Two shapes, not one narrowed — and this one is the designer's, not mine.
 *
 * `ui/narrow-projects.html`: no chevron, because the whole row is the link and
 * the columns that vanished are reached by opening the project rather than by
 * expanding it in place. Name over a meta line carrying the total and the
 * deadline as one sentence, chip and a 64px bar stacked at the right.
 *
 * The deadline is absolute here (`due Tue 22`) where the wide column is
 * relative (`3d`): the narrow form is read as prose, and "· due 3d" is not a
 * sentence. Overdue is said by the line being red, not by the words.
 */
function NarrowRow({ row, todayStr, onOpen }: {
  row: ProjectRow; todayStr: string; onOpen: (id: string | null) => void
}) {
  const { name, color, progress, minutesLeft, nextDue, nextDueIn, status } = row
  const late = nextDueIn !== null && nextDueIn <= 0

  return (
    <button
      onClick={() => onOpen(row.id)}
      className="narrow:hidden w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface-quiet transition-colors"
      style={{ minHeight: 'var(--tap-min)' }}
    >
      <Dot color={color} />

      <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
        <span className="text-[13.5px] font-medium text-ink truncate">{name}</span>
        {/* One sentence. A project with no work left has no deadline worth
            stating either, so it says that instead of "nothing · due no date". */}
        <span className={`text-micro ${late ? 'text-danger' : 'text-ink-muted'}`}>
          {minutesLeft > 0 ? (
            <><span className="num">{formatMinutes(minutesLeft)}</span>{' · due '}{dueShort(nextDue, todayStr)}</>
          ) : 'nothing left'}
        </span>
      </span>

      <span className="shrink-0 flex flex-col items-end gap-1.5">
        <StatusChip status={status} />
        <span className="w-[64px] flex"><ProgressBar value={progress} color={color} /></span>
      </span>
    </button>
  )
}

/** Relative to today, and red only when it is already behind or is today. */
function DueText({ row }: { row: ProjectRow }) {
  const { nextDueIn } = row
  if (nextDueIn === null) return <span className="text-ink-ghost">—</span>
  // "1d overdue", never "Yesterday": one of these is a date and the other is a
  // state, and a column that switches between them at n=1 reads as two columns.
  if (nextDueIn < 0)  return <span className="text-danger">{-nextDueIn}d overdue</span>
  if (nextDueIn === 0) return <span className="text-danger">Today</span>
  if (nextDueIn === 1) return <span className="text-ink-2">Tomorrow</span>
  return <span className="text-ink-faint">{nextDueIn}d</span>
}

function ProgressBar({ value, color }: { value: number | null; color: string | null }) {
  return (
    <span className="flex-1 mid:flex-none mid:w-[52px] h-[5px] rounded-full bg-track overflow-hidden flex">
      {value !== null && value > 0 && (
        <span style={{ width: `${value * 100}%`, background: color ?? 'var(--ink-faint)' }} />
      )}
    </span>
  )
}

/**
 * Share of the table's whole remaining time — not of the largest row.
 *
 * The handoff drew this scaled to the biggest project, so the top row ran full
 * width. A full bar beside a chip reading "35% of all time left" contradicts
 * itself, and the column is called *share of time*. Scaled to the total, three
 * projects visibly holding most of the bar-width *is* the finding.
 */
function ShareBar({ share, color }: { share: number; color: string | null }) {
  return (
    <span className="w-[112px] h-1.5 rounded-full bg-track overflow-hidden flex"
          role="img" aria-label={`${Math.round(share * 100)}% of all remaining time`}>
      {share > 0 && (
        /* Floored at 2px: a project with an hour in it should not look like a
           project with nothing. */
        <span style={{ width: `max(2px, ${(share * 100).toFixed(2)}%)`,
                       background: color ?? 'var(--line-strong)' }} />
      )}
    </span>
  )
}

function StatusChip({ status }: { status: ProjectRow['status'] }) {
  const tone = TONE[status.tone]
  return (
    <span className={`rounded-chip px-2 py-0.5 text-micro truncate shrink-0 ${tone.className}`}
          style={{ background: tone.bg }}
          title={status.text}>
      {status.text}
    </span>
  )
}
