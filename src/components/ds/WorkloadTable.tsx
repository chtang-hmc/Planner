/**
 * Where the remaining time sits: one stacked bar, then the rows behind it.
 *
 * Replaces seven separate project bars, each scaled to itself, which made the
 * one comparison worth having — how the whole is divided — the one thing you
 * could not read. The bar is the division; the table is the detail.
 */

import { formatMinutes } from '@/lib/task-format'
import type { ProjectRow } from '@/lib/projects'
import { workloadSegments } from '@/lib/insights'

export function WorkloadTable({ rows, total, finding, onOpen }: {
  rows:    ProjectRow[]
  /** Minutes the bar represents, for the heading. */
  total:   number
  finding: string | null
  onOpen?: (id: string | null) => void
}) {
  const segments = workloadSegments(rows)
  if (segments.length === 0) return null

  return (
    <section className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 pt-3.5 pb-3 flex flex-col gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-eyebrow uppercase tracking-wider text-ink-faint">
            {/* The total stays in its own case: `27H 58M` is not a duration,
                and the eyebrow's uppercase would otherwise reach into it. */}
            Where the remaining{' '}
            <span className="num normal-case tracking-normal">{formatMinutes(total)}</span> sits
          </h2>
          {finding && <p className="text-small text-ink-2">{finding}</p>}
        </div>

        <div className="flex h-[10px] rounded-full overflow-hidden bg-track" role="img"
             aria-label={segments.map(s => `${s.name} ${Math.round(s.share * 100)}%`).join(', ')}>
          {segments.map(s => (
            <span
              key={s.id ?? 'inbox'}
              title={`${s.name} · ${Math.round(s.share * 100)}%`}
              /* Floored at two pixels: a project with an hour in it should be
                 visible as a project with an hour in it, not as nothing. */
              style={{
                width: `max(2px, ${(s.share * 100).toFixed(2)}%)`,
                background: s.color ?? 'var(--line-strong)',
              }}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-line-soft">
        <div className="flex items-center gap-3 px-4 h-[28px]">
          <span className="w-[11px] shrink-0" />
          <span className="flex-1 text-eyebrow uppercase tracking-wider text-ink-ghost">Project</span>
          <span className="hidden narrow:block w-[62px] shrink-0 text-right text-eyebrow uppercase tracking-wider text-ink-ghost">Active</span>
          <span className="w-[62px] shrink-0 text-right text-eyebrow uppercase tracking-wider text-ink-ghost">Left</span>
          <span className="w-[48px] shrink-0 text-right text-eyebrow uppercase tracking-wider text-ink-ghost">Done</span>
          <span className="w-[52px] shrink-0 text-right text-eyebrow uppercase tracking-wider text-ink-ghost">Share</span>
        </div>

        <div className="border-t border-line-soft divide-y divide-line-soft">
          {rows.filter(r => r.minutesLeft > 0).map(r => (
            <button
              key={r.id ?? 'inbox'}
              onClick={() => onOpen?.(r.id)}
              className="w-full flex items-center gap-3 px-4 h-[36px] text-left hover:bg-surface-quiet transition-colors"
            >
              <span aria-hidden className="w-[11px] shrink-0 flex">
                <span className="w-2 h-2 rounded-full"
                      style={{ background: r.color ?? 'var(--line-strong)' }} />
              </span>
              <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{r.name}</span>
              <span className="hidden narrow:block w-[62px] shrink-0 num text-micro text-ink-2 text-right">
                {r.activeCount} {r.activeCount === 1 ? 'task' : 'tasks'}
              </span>
              <span className="w-[62px] shrink-0 num text-small text-ink text-right">
                {formatMinutes(r.minutesLeft)}
              </span>
              {/* An inbox has a completion history like anything else — the
                  reference's `—` here was wrong. */}
              <span className="w-[48px] shrink-0 num text-micro text-ink-faint text-right">
                {r.progress === null ? '—' : `${Math.round(r.progress * 100)}%`}
              </span>
              <span className="w-[52px] shrink-0 num text-micro text-ink-2 text-right">
                {Math.round(r.share * 100)}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
