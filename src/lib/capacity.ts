/**
 * Capacity — how much work is due against how much time there is.
 *
 * The redesign's one idea: the app already knows both numbers and never says
 * them. This module is the vocabulary for saying them — the shape, the
 * wording, and the segments of the bar. The arithmetic that fills it in from
 * the database arrives with step 3; everything here is pure so the components
 * can be built and looked at first.
 *
 * Three things are deliberate:
 *
 *   1. **Free time after a cutoff is not the same as free time.** Working
 *      hours here run to 01:30, so the largest free block most days begins at
 *      22:00. Counting it flat makes a day that is really full look fine.
 *   2. **A claim is only made when something supports it.** `freeTimeBasis`
 *      in lib/home.ts decides whether the day was observed; with no calendar
 *      there is no capacity, not a capacity of zero.
 *   3. **The segments do not encode state in lightness.** Solid, hatched,
 *      solid. A lightness ramp is the encoding a re-tint destroys.
 */

import { formatDuration } from '@/lib/duration'
import { localMidnight, type Interval } from '@/lib/scheduler'

/** Minutes past local midnight after which free time is second-class. */
export const LATE_CUTOFF_MINUTES = 22 * 60

export interface Capacity {
  /** Minutes of work due on the day. */
  dueTotal:          number
  /** Free minutes that fall before the cutoff. */
  freeBeforeCutoff:  number
  /** Free minutes that fall at or after it. */
  freeAfterCutoff:   number
}

export const NO_CAPACITY: Capacity = { dueTotal: 0, freeBeforeCutoff: 0, freeAfterCutoff: 0 }

/** Total free time, however late it is. */
export function freeTotal(c: Capacity): number {
  return c.freeBeforeCutoff + c.freeAfterCutoff
}

/** Minutes of work with nowhere to go. Never negative — slack is not a deficit. */
export function deficit(c: Capacity): number {
  return Math.max(0, c.dueTotal - freeTotal(c))
}

/** Minutes of free time left over. Never negative, for the same reason. */
export function slack(c: Capacity): number {
  return Math.max(0, freeTotal(c) - c.dueTotal)
}

/**
 * The bar, as three widths of work against a track.
 *
 * Scaled to `max(due, free)` — one model running in both directions:
 *
 * - **due > free.** The bar is the work. The segments fill it and the track
 *   never shows; the red tail is what has nowhere to go.
 * - **free > due.** The bar is the free time. The segments are still the work,
 *   and the track showing through at the end **is the slack**.
 *
 * Scaling to `due` alone was wrong in the second direction: a day with two
 * hours spare rendered as a completely full bar, so the one number worth
 * seeing — the room you have left — was the one the bar could not show.
 *
 * Nothing due and free time known draws an empty track, which reads as "all of
 * this is yours" beside a headline that says nothing is due. Null only when
 * there is no ratio at all to draw.
 */
export interface CapacitySegments {
  /** Fits before the cutoff. Solid. */
  fits:     number
  /** Fits, but only in the late block. Hatched. */
  fitsLate: number
  /** Does not fit at all. Solid. */
  overflow: number
}

/** What the three segments leave: slack, drawn as bare track. 0 when over. */
export function slackWidth(seg: CapacitySegments): number {
  return Math.max(0, 1 - seg.fits - seg.fitsLate - seg.overflow)
}

export function capacitySegments(c: Capacity): CapacitySegments | null {
  // Whichever is larger sets the scale. A day with no work and no time has no
  // ratio to draw; a day off has one but should not draw it, and that is the
  // band's call rather than this function's.
  const scale = Math.max(c.dueTotal, freeTotal(c))
  if (scale <= 0) return null

  const fits     = Math.min(c.dueTotal, c.freeBeforeCutoff)
  const fitsLate = Math.min(c.dueTotal - fits, c.freeAfterCutoff)
  const overflow = c.dueTotal - fits - fitsLate

  return { fits: fits / scale, fitsLate: fitsLate / scale, overflow: overflow / scale }
}

export type CapacityTone = 'over' | 'tight' | 'ok' | 'empty'

/**
 * The verdict, in words, and how loudly to say it.
 *
 * `tight` is its own tone because "it fits, but only after ten at night" is a
 * different answer from "it fits". Colouring it like `ok` would hide the one
 * thing this whole page exists to surface.
 */
export function capacityVerdict(c: Capacity): { text: string; tone: CapacityTone } {
  if (c.dueTotal <= 0) return { text: 'Nothing due', tone: 'empty' }

  const short = deficit(c)
  if (short > 0) return { text: `${formatDuration(short)} over capacity`, tone: 'over' }

  const needsLate = c.dueTotal > c.freeBeforeCutoff
  if (needsLate) {
    const late = c.dueTotal - c.freeBeforeCutoff
    return { text: `fits, ${formatDuration(late)} of it after 10pm`, tone: 'tight' }
  }

  const spare = slack(c)
  return {
    text: spare > 0 ? `fits, ${formatDuration(spare)} to spare` : 'fits exactly',
    tone: 'ok',
  }
}

// ── Computing it ─────────────────────────────────────────────────────────────

/**
 * Split the day's free gaps around the cutoff.
 *
 * A gap straddling 22:00 contributes to both halves, and a gap running past
 * midnight is entirely late — which is the normal case here, where the working
 * window ends at 01:30 and the largest free stretch most days is 22:00–01:30.
 *
 * `gaps` comes from `freeGaps`, so the overlap arithmetic and the working
 * window are already handled and this only has to divide what is left.
 */
export function capacityFromGaps(opts: {
  gaps:           Interval[]
  dayStr:         string
  tz:             string
  /** Minutes of work due. The caller owns which tasks count — see `dueMinutesFor`. */
  dueMinutes:     number
  cutoffMinutes?: number
}): Capacity {
  const { gaps, dayStr, tz, dueMinutes, cutoffMinutes = LATE_CUTOFF_MINUTES } = opts
  const cutoffMs = localMidnight(dayStr, tz) + cutoffMinutes * 60_000

  let before = 0
  let after  = 0
  for (const [start, end] of gaps) {
    before += Math.max(0, Math.min(end, cutoffMs) - start)
    after  += Math.max(0, end - Math.max(start, cutoffMs))
  }

  return {
    dueTotal:         Math.max(0, Math.round(dueMinutes)),
    freeBeforeCutoff: Math.round(before / 60_000),
    freeAfterCutoff:  Math.round(after  / 60_000),
  }
}

/**
 * Minutes of work due on or before `dayStr`.
 *
 * Overdue counts. Work that was due on Friday and is still open is work this
 * day has to absorb, and a capacity number that ignores it is describing a
 * lighter day than the one you are in.
 *
 * Unestimated tasks contribute nothing, which understates the total — every
 * open task here has an estimate, so it is not currently a lie, but it would
 * become one quietly. A task with no estimate is a gap in the input, not a
 * task that takes no time.
 *
 * Work a calendar event is already doing is excluded — see `coveredTaskIds`.
 */
export function dueMinutesFor(
  tasks: { id?: string; dueDay: string | null; minutes: number | null }[],
  dayStr: string,
  /**
   * Tasks a calendar event is already doing, from a **confirmed** link
   * (migration 0019). Their time is on the calendar, so it is already out of
   * the free total; counting it again as work due makes the day look worse
   * than it is by exactly the size of the block.
   *
   * Only confirmed links. A title-similarity guess never moves a number — see
   * `suggestTaskEventLinks`.
   */
  coveredTaskIds: ReadonlySet<string> = new Set<string>(),
): number {
  return tasks.reduce((sum, t) => {
    if (t.dueDay == null || t.dueDay > dayStr) return sum
    if (t.id != null && coveredTaskIds.has(t.id)) return sum
    return sum + (t.minutes ?? 0)
  }, 0)
}
