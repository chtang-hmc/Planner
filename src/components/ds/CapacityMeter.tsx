/**
 * The capacity bar: how much of what is due actually fits.
 *
 * Three segments, three *different* encodings — solid, hatched, solid. The
 * design's first revision ran them as one lightness ramp (L=33 → 64 → 83),
 * which is the encoding a re-tint destroys: on a dark ground the "fits"
 * segment fell to 2.85:1 and became the quietest thing on the most important
 * graphic on the page. A hatch survives any palette.
 *
 * Used at two sizes and nowhere else: 110×6 in a group header, and full-width
 * at 14px in Today's capacity band.
 */

import { capacitySegments, type Capacity } from '@/lib/capacity'

export function CapacityMeter({ capacity, height = 6, className = '' }: {
  capacity: Capacity
  height?: number
  className?: string
}) {
  const seg = capacitySegments(capacity)

  // A group with nothing due gets no meter. An empty track would read as a
  // finding, and there is not one.
  if (!seg) return null

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`

  return (
    <div
      className={`flex rounded-full overflow-hidden bg-track ${className}`}
      style={{ height }}
      role="img"
      aria-label={
        seg.overflow > 0
          ? `${Math.round((seg.fits + seg.fitsLate) * 100)}% of today's work fits`
          : 'all of today’s work fits'
      }
    >
      {seg.fits     > 0 && <div style={{ width: pct(seg.fits), background: 'var(--ok)' }} />}
      {seg.fitsLate > 0 && <div className="capacity-late" style={{ width: pct(seg.fitsLate) }} />}
      {seg.overflow > 0 && <div style={{ width: pct(seg.overflow), background: 'var(--danger-fill)' }} />}
    </div>
  )
}

/** The colour a verdict is said in. `tight` is not `ok`, which is the point. */
export const VERDICT_CLASS = {
  over:  'text-danger',
  tight: 'text-ink-2',
  ok:    'text-ok',
  empty: 'text-ink-faint',
} as const
