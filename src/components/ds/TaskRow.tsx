/**
 * The task row, and the group header above it.
 *
 * These appear on four screens — Tasks·List, project detail, the project
 * table's expanded rows, and Triage — so they are built once here and applied
 * in step 5. Nothing renders them in the app yet; `/auth/design` does.
 *
 * Two shapes, not one narrowed. At 1440 the right-hand columns are fixed
 * widths so they form real columns down the list; at 390 that is 170px of
 * furniture against a ~343px viewport, leaving about two words of title. So
 * the narrow form deletes the columns cleanly rather than compressing them,
 * and the meta moves to a second line.
 */

import { formatDuration } from '@/lib/duration'
import { capacityVerdict, type Capacity } from '@/lib/capacity'
import { CapacityMeter, VERDICT_CLASS } from '@/components/ds/CapacityMeter'

export interface TaskRowModel {
  id:        string
  title:     string
  /** The project's own colour, from `projects.color`. Null for Inbox. */
  color:     string | null
  project:   string
  minutes:   number | null
  /** 0–100. The meter's fill length; it carries no colour of its own. */
  urgency:   number
  /**
   * What the group header does not already say — `scheduled 4:00pm`,
   * `repeats weekly`, `3 steps`. Never a "TODAY" badge inside a group headed
   * Today, which is the noise this replaces.
   */
  chip?:     string | null
  /** Overdue is the one categorical state that keeps red, carried by the text. */
  lateLabel?: string | null
  done?:     boolean
}

export function TaskRow({ task, narrow = false, onToggle, onOpen }: {
  task:      TaskRowModel
  narrow?:   boolean
  onToggle?: () => void
  onOpen?:   () => void
}) {
  const dot = (
    <span
      aria-hidden
      className="w-[7px] h-[7px] rounded-full shrink-0"
      style={{ background: task.color ?? 'var(--ink-ghost)' }}
    />
  )

  const check = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Complete ${task.title}`}
      className="w-[15px] h-[15px] rounded-full border-2 border-line-strong shrink-0
                 hover:border-accent-500 hover:bg-accent-50 transition-colors"
    />
  )

  if (narrow) {
    // 56px, two lines, no fixed columns. The urgency meter is absent by
    // design: its length duplicates the sort order, which is the same reason
    // its four colours were deleted from the palette.
    return (
      <div className="flex items-start gap-2.5 px-4 py-2 border-t border-line-soft min-h-[56px]">
        <span className="pt-0.5">{check}</span>
        <span className="pt-[7px]">{dot}</span>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-[14px] text-ink truncate leading-snug">{task.title}</p>
          <p className="text-micro text-ink-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="uppercase tracking-wider">{task.project}</span>
            <span aria-hidden>·</span>
            <span className="num">{formatDuration(task.minutes)}</span>
            {task.chip && <><span aria-hidden>·</span><span>{task.chip}</span></>}
            {task.lateLabel && (
              <><span aria-hidden>·</span><span className="text-danger font-medium">{task.lateLabel}</span></>
            )}
          </p>
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-4 h-[44px] border-t border-line-soft group">
      {check}
      {dot}

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="text-[14px] text-ink truncate block">{task.title}</span>
      </button>

      {task.lateLabel && (
        <span className="text-micro font-semibold uppercase tracking-wider text-danger shrink-0">
          {task.lateLabel}
        </span>
      )}
      {task.chip && (
        <span className="text-micro text-ink-muted bg-surface-quiet border border-line-soft
                         rounded-chip px-1.5 py-0.5 shrink-0">
          {task.chip}
        </span>
      )}

      {/* 34×4, neutral. Length is the score — it has no band colour, because
          the list is already sorted by the same number and a third encoding
          of one variable cost two hues that collided with two project dots. */}
      <div className="w-[34px] h-[4px] rounded-full bg-track shrink-0" title={`Urgency ${Math.round(task.urgency)}`}>
        <div
          className="h-full rounded-full bg-ink-faint"
          style={{ width: `${Math.max(0, Math.min(100, task.urgency))}%` }}
        />
      </div>

      <span className="w-[84px] shrink-0 text-right text-micro uppercase tracking-wider text-ink-faint truncate">
        {task.project}
      </span>
      <span className="num w-[52px] shrink-0 text-right text-small text-ink-2">
        {formatDuration(task.minutes)}
      </span>
    </div>
  )
}

/**
 * The header above a run of rows, carrying the capacity for that group.
 *
 * This is where the redesign's one idea lands in a list: the group already
 * knows how much is due, and the day already knows how much time there is, so
 * the header says whether one fits inside the other instead of just counting.
 *
 * A group with no due date gets no meter and no verdict — there is nothing for
 * its work to fit inside.
 */
export function GroupHeader({ label, count, capacity, action, narrow = false }: {
  label:    string
  count:    number
  /** Omitted for an undated group. */
  capacity?: Capacity | null
  action?:  { label: string; onClick: () => void } | null
  narrow?:  boolean
}) {
  const verdict = capacity ? capacityVerdict(capacity) : null

  return (
    <div className="flex items-center gap-3 px-4 pt-4 pb-1.5 flex-wrap">
      <span className="text-[12px] font-bold text-ink-2">{label}</span>
      <span className="num text-micro text-ink-faint">
        {count} {count === 1 ? 'task' : 'tasks'}
        {capacity && <> · {formatDuration(capacity.dueTotal)}</>}
      </span>

      {capacity && !narrow && <CapacityMeter capacity={capacity} className="w-[110px]" />}
      {verdict && verdict.tone !== 'empty' && (
        <span className={`text-micro ${VERDICT_CLASS[verdict.tone]}`}>{verdict.text}</span>
      )}

      {action && (
        <button
          onClick={action.onClick}
          /* A text link, never the filled primary button: the default on a day
             with slack is that you keep it. */
          className="ml-auto text-micro text-accent-600 hover:text-accent-700 hover:underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
      {capacity && narrow && (
        <CapacityMeter capacity={capacity} className="w-full mt-1" />
      )}
    </div>
  )
}
