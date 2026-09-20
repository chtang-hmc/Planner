/**
 * Today's capacity band — the page's headline.
 *
 * Six states. The one that was designed first says "5h 35m will not fit"; the
 * other five exist because a band that only knows that has nothing to say on a
 * day that fits, a day off, or a day nobody has looked at, and says the wrong
 * thing rather than nothing.
 *
 * Two bars, not one with a variant. The normal bar is three proportions of
 * `max(due, free)`, where a solid segment means *placed*. In the fragmented
 * state nothing can be placed, so there is no solid segment to draw — the bar
 * becomes the gaps themselves at their true relative widths. Fragmentation is
 * a shape, so the bar draws the shape.
 */

import { CapacityMeter } from '@/components/ds/CapacityMeter'
import { bandCopy, gapShape, type BandInput } from '@/lib/band'

/**
 * The gaps, drawn as they actually are.
 *
 * Widths are the real ratios, so six holes of 45/40/30/30/25/15 look like six
 * holes of 45/40/30/30/25/15. Hatched rather than solid throughout: the hatch
 * already means "time you have but not in a usable block", and here that is
 * every piece.
 */
function GapShapeBar({ gaps, height = 14 }: { gaps: BandInput['gaps']; height?: number }) {
  const shape = gapShape(gaps)
  const total = shape.reduce((a, b) => a + b, 0)
  if (total === 0) return null

  return (
    <div className="flex gap-1" style={{ height }} role="img"
         aria-label={`Free time in ${shape.length} separate pieces, the longest ${shape[0]} minutes`}>
      {shape.map((m, i) => (
        <div
          key={i}
          className="capacity-late rounded-full"
          style={{ width: `${(m / total) * 100}%` }}
          title={`${m}m`}
        />
      ))}
    </div>
  )
}

export function CapacityBand({ input, onPrimary, onSecondary }: {
  input:       BandInput
  onPrimary?:  () => void
  onSecondary?: () => void
}) {
  const copy = bandCopy(input)

  // States 1 and 2 have no ratio worth drawing: unknown has no free time to
  // claim, and a day off would be a 100% red block carrying no information.
  const bar =
    copy.kind === 'unknown' || copy.kind === 'dayOff' ? null
    : copy.kind === 'fragmented' ? <GapShapeBar gaps={input.gaps} />
    : <CapacityMeter capacity={input.capacity} height={14} />

  return (
    <section className="rounded-xl border border-line bg-surface px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow uppercase tracking-wider text-ink-faint mb-1.5">Today’s capacity</p>
          <h2 className="display text-ink" style={{ fontSize: 'var(--text-display-s)', lineHeight: 1.15 }}>
            {copy.headline}
          </h2>
          {copy.supporting && (
            <p className="text-meta text-ink-muted mt-2 leading-relaxed max-w-[46ch]">{copy.supporting}</p>
          )}
        </div>

        {/* A control is rendered only when something can happen. Two of the
            six states lead to Triage, which does not exist yet, and a button
            that does nothing teaches people not to press buttons — the band's
            job is to say what is true, and it does that without them. */}
        <div className="flex items-center gap-3 shrink-0">
          {copy.primary && onPrimary && (
            <button
              onClick={onPrimary}
              className="bg-accent-600 text-white text-[13px] font-medium px-4 rounded-ctrl
                         hover:bg-accent-700 transition-colors"
              style={{ minHeight: 'var(--tap-min)' }}
            >
              {copy.primary}
            </button>
          )}
          {copy.secondary && onSecondary && (
            /* Always a link when there is a primary beside it — an app that
               fills every gap is a machine for burning people out, so the
               default has to be that you keep your slack. Where there is no
               primary it carries the weight of a bordered control instead. */
            <button
              onClick={onSecondary}
              className={copy.primary && onPrimary
                ? 'text-[13px] text-accent-600 hover:text-accent-700 hover:underline underline-offset-2 px-1'
                : 'text-[13px] text-ink-2 border border-line-strong rounded-ctrl px-4 hover:border-accent-400 transition-colors'}
              style={{ minHeight: 'var(--tap-min)', marginLeft: copy.primary && onPrimary ? 'var(--gap-target)' : 0 }}
            >
              {copy.secondary}
            </button>
          )}
        </div>
      </div>

      {bar}

      {copy.legend.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          {copy.legend.map((line, i) => (
            <span key={line} className="text-micro text-ink-muted flex items-center gap-1.5">
              {copy.kind !== 'fragmented' && (
                <span
                  aria-hidden
                  className={`w-2 h-2 rounded-[2px] shrink-0 ${i === 1 ? 'capacity-late' : ''}`}
                  style={i === 1 ? undefined
                    : { background: i === 0 ? 'var(--ok)' : 'var(--danger-fill)' }}
                />
              )}
              {line}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
