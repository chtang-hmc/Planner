/**
 * Everything with nowhere to go, and what Triage will read from.
 *
 * Two rules from round 3 shape it:
 *
 *   - **Overdue is pinned, not sorted.** Something two days late sorting by
 *     size among things due today is nonsense — *how big is it* is not the
 *     question for work that is already late. It sits above the sort tabs and
 *     is unaffected by them, so the late thing is always the first decision.
 *   - **The numeric column is whichever one you sorted by.** Sorting by a
 *     number you cannot see is what the old Projects page did with urgency,
 *     and the column carries a label so the unit is never inferred.
 */

import { formatDuration } from '@/lib/duration'
import type { AttentionRow } from '@/lib/home'

export type RailSort = 'size' | 'urgency' | 'project'

export const RAIL_SORTS: { id: RailSort; label: string; column: string }[] = [
  { id: 'size',    label: 'Largest first', column: 'Minutes' },
  { id: 'urgency', label: 'Urgency',       column: 'Urgency' },
  { id: 'project', label: 'Project',       column: 'Minutes' },
]

export interface RailItem {
  key:      string
  taskId:   string
  title:    string
  /** "3 steps", "2 days late". */
  note:     string | null
  minutes:  number | null
  urgency:  number
  project:  string
  color:    string | null
}

/** Ordered by the chosen column. Overdue is not passed through here. */
export function sortRail(items: RailItem[], sort: RailSort): RailItem[] {
  const by = [...items]
  switch (sort) {
    case 'size':    return by.sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
    case 'urgency': return by.sort((a, b) => b.urgency - a.urgency)
    case 'project': return by.sort((a, b) =>
      a.project.localeCompare(b.project) || (b.minutes ?? 0) - (a.minutes ?? 0))
  }
}

export function UnplacedRail({
  items, overdue, sort, totalMinutes, onSort, onOpen,
}: {
  items:        RailItem[]
  /** Pinned above the tabs, in their own container, never re-sorted. */
  overdue:      AttentionRow[]
  sort:         RailSort
  totalMinutes: number
  onSort?:      (s: RailSort) => void
  onOpen?:      (taskId: string) => void
}) {
  const column = RAIL_SORTS.find(s => s.id === sort)!.column
  const ordered = sortRail(items, sort)

  return (
    <section className="min-w-0">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">Unplaced</h2>
        <span className="num text-micro text-ink-faint ml-auto">
          {items.length + overdue.length} · {formatDuration(totalMinutes)}
        </span>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {overdue.length > 0 && (
          <div className="border-b border-line" style={{ background: 'var(--danger-tint)' }}>
            <div className="flex items-baseline gap-2 px-4 pt-2.5 pb-1">
              <span className="text-eyebrow uppercase tracking-wider text-danger">Overdue</span>
              <span className="num text-micro text-ink-faint">
                {overdue.length} · {formatDuration(overdue.reduce((s, r) => s + (r.minutes ?? 0), 0))}
              </span>
              {/* Said out loud, because pinning you can only discover by
                  sorting is pinning nobody knows about. */}
              <span className="text-micro text-ink-ghost ml-auto">always first</span>
            </div>
            {overdue.map(r => (
              <button
                key={r.key}
                onClick={() => onOpen?.(r.openId)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-surface-quiet transition-colors"
              >
                <span className="text-[13px] text-ink truncate flex-1">{r.title}</span>
                {r.stepsLabel && <span className="text-micro text-ink-faint shrink-0">{r.stepsLabel}</span>}
                <span className="num text-micro text-ink-2 shrink-0 w-[52px] text-right">
                  {formatDuration(r.minutes)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5 flex-wrap">
          {RAIL_SORTS.map(s => (
            <button
              key={s.id}
              onClick={() => onSort?.(s.id)}
              className={`text-micro px-2 py-1 rounded-chip transition-colors ${
                s.id === sort
                  ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink-2'
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="text-eyebrow uppercase tracking-wider text-ink-ghost ml-auto pr-1">
            {column}
          </span>
        </div>

        <div className="divide-y divide-line-soft border-t border-line-soft">
          {ordered.map(i => (
            <button
              key={i.key}
              onClick={() => onOpen?.(i.taskId)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-quiet transition-colors"
            >
              <span aria-hidden className="w-[7px] h-[7px] rounded-full shrink-0"
                    style={{ background: i.color ?? 'var(--ink-ghost)' }} />
              <span className="text-[13px] text-ink truncate flex-1">{i.title}</span>
              {i.note && <span className="text-micro text-ink-faint shrink-0">{i.note}</span>}
              {sort === 'urgency' ? (
                <span className="w-[34px] h-[4px] rounded-full bg-track shrink-0"
                      title={`Urgency ${Math.round(i.urgency)}`}>
                  <span className="block h-full rounded-full bg-ink-faint"
                        style={{ width: `${Math.max(0, Math.min(100, i.urgency))}%` }} />
                </span>
              ) : (
                <span className="num text-micro text-ink-2 shrink-0 w-[52px] text-right">
                  {formatDuration(i.minutes)}
                </span>
              )}
            </button>
          ))}
          {ordered.length === 0 && (
            <p className="px-4 py-4 text-micro text-ink-ghost text-center">
              Everything due is on the day.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
