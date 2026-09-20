/**
 * Today's capacity band — which of six things the day is, and what to say.
 *
 * The band is the page's headline, and the reason it has six states rather
 * than one is that the interesting case was designed first and called done. A
 * band that only knows how to say "5h 35m will not fit" has nothing to say on
 * a day that fits, a day off, or a day nobody has looked at — and says the
 * wrong thing rather than nothing.
 *
 * Two of the six are not about capacity at all:
 *
 *   - **unknown** — no calendar has been seen, so no free-time claim is made
 *     anywhere. Zero events is an unknown day, not a free one.
 *   - **dayOff** — working hours are switched off. Free time is known and it
 *     is zero, so there is no ratio to draw and the bar goes.
 *
 * And one is a failure mode of a day rather than of a number:
 *
 *   - **fragmented** — everything fits by volume and nothing fits any single
 *     gap. A day of 45-minute holes against a two-hour task is full in a way
 *     no total can express.
 */

/**
 * Prose, not columns.
 *
 * The band is three sentences and a legend, none of which is a column, so it
 * uses `formatMinutes` — "1h", not "1h 00m". Padding exists so a *column* of
 * durations keeps its minutes place; inside a sentence it just reads wrong,
 * which is what `1h 00m` was doing here against a board that says `1h`. The
 * padded form belongs in the rows and the rail.
 */
import { formatMinutes as dur } from '@/lib/task-format'
import {
  capacityVerdict, deficit, freeTotal, slack, LATE_CUTOFF_MINUTES,
  type Capacity,
} from '@/lib/capacity'
import type { DayReason } from '@/lib/home'
import type { Interval } from '@/lib/scheduler'

export type BandKind =
  | 'unknown' | 'dayOff' | 'overCapacity' | 'fitsWithSlack' | 'fragmented' | 'nothingDue'

export interface BandInput {
  reason:    DayReason
  capacity:  Capacity
  /** Free stretches still ahead, for the fragmented bar. */
  gaps:      Interval[]
  /** Number of tasks behind `capacity.dueTotal`, for the copy. */
  dueCount:  number
  /**
   * The smallest thing still to be placed. `fragmented` is the case where this
   * is larger than every gap, so it cannot be derived from the gaps alone.
   */
  smallestTaskMinutes?: number | null
  /** Next working day, already worded — "Monday". Null when there isn't one. */
  nextWorkingDay?: string | null
  /** Free minutes on that day, for the day-off supporting line. */
  nextWorkingDayFree?: number | null
  /** What to start, when there is something. Supplied by the ranking. */
  start?: { title: string; gapMinutes: number; beforeTitle?: string | null } | null
  /** The next thing due after today, for the nothing-due line. */
  nextDue?: { title: string; when: string; minutes: number } | null
}

/**
 * Which state the day is in.
 *
 * Order matters. Provenance beats configuration beats arithmetic: a day
 * nobody has looked at is unknown even if it would otherwise look empty, and
 * a day off is a day off even with eleven hours due on it.
 */
export function bandKind(input: BandInput): BandKind {
  const { reason, capacity, gaps, smallestTaskMinutes } = input

  if (reason === 'unknown') return 'unknown'
  if (reason === 'dayOff')  return 'dayOff'

  if (capacity.dueTotal <= 0) return 'nothingDue'
  if (deficit(capacity) > 0)  return 'overCapacity'

  // Everything fits by volume. Does it fit anywhere?
  const longest = gaps.reduce((m, [s, e]) => Math.max(m, (e - s) / 60_000), 0)
  if (smallestTaskMinutes != null && smallestTaskMinutes > longest) return 'fragmented'

  return 'fitsWithSlack'
}

/** Gap lengths in minutes, longest first — the fragmented bar draws these. */
export function gapShape(gaps: Interval[]): number[] {
  return gaps.map(([s, e]) => Math.round((s < e ? e - s : 0) / 60_000))
             .filter(m => m > 0)
             .sort((a, b) => b - a)
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const count = (n: number) => (n <= 10 ? WORDS[n] : String(n))

/** The cutoff as the copy says it: "10pm". */
function cutoffLabel(minutes = LATE_CUTOFF_MINUTES): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  const suffix = h < 12 ? 'am' : 'pm'
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

export interface BandCopy {
  kind:       BandKind
  headline:   string
  supporting: string | null
  /** Under the bar. Empty when there is no bar. */
  legend:     string[]
  /** The filled button, when the day has one thing you should do. */
  primary:    string | null
  /** Always a link, never filled — see I4: the default is that you keep your slack. */
  secondary:  string | null
}

/**
 * What the band says.
 *
 * Separated from the component so the copy is pinned by tests. Every clause
 * here is a decision — whether an unopened day counts as free, whether a
 * fragmented day has failed, whether an app should offer to fill your slack —
 * and a string inside a component drifts without anyone choosing.
 */
export function bandCopy(input: BandInput): BandCopy {
  const { capacity, gaps, dueCount, nextWorkingDay, nextWorkingDayFree, start, nextDue } = input
  const kind = bandKind(input)
  const due  = dur(capacity.dueTotal)
  const free = dur(freeTotal(capacity))
  const late = cutoffLabel()

  switch (kind) {
    case 'unknown':
      return {
        kind,
        headline: 'Planner can’t see your day yet.',
        supporting: `${dueCount} task${dueCount === 1 ? '' : 's'} · ${due} due today. `
          + 'How much of it fits is unknown until something says when you are free.',
        legend: [],
        primary: 'Connect calendar',
        secondary: 'Set working hours instead',
      }

    case 'dayOff':
      return {
        kind,
        headline: 'Today is a day off.',
        supporting: capacity.dueTotal > 0
          ? `${due} is still due today.`
            + (nextWorkingDay && nextWorkingDayFree != null
                ? ` ${nextWorkingDay} has ${dur(nextWorkingDayFree)} free.` : '')
          : null,
        legend: [],
        // Never invent a day. With none enabled in the next week, the choice
        // itself becomes the action.
        primary: nextWorkingDay ? `Move it all to ${nextWorkingDay}` : 'Find a day',
        secondary: 'Work anyway',
      }

    case 'overCapacity': {
      const short = deficit(capacity)
      return {
        kind,
        headline: `${dur(short)} of today’s work will not fit.`,
        supporting: `${due} due across ${dueCount} task${dueCount === 1 ? '' : 's'} · ${free} free`
          + (capacity.freeAfterCutoff > 0
              ? ` · and ${dur(capacity.freeAfterCutoff)} of that free time starts at ${late}.`
              : '.'),
        legend: [
          `${dur(capacity.freeBeforeCutoff)} fits before ${late}`,
          `${dur(capacity.freeAfterCutoff)} fits only after ${late}`,
          `${dur(short)} has nowhere to go`,
        ],
        primary: `Triage ${dur(short)}`,
        secondary: 'Push to tomorrow',
      }
    }

    case 'fragmented': {
      const shape = gapShape(gaps)
      const longest = shape[0] ?? 0
      return {
        kind,
        headline: 'Everything fits, but not in any one sitting.',
        supporting: `${due} due · ${free} free, broken into ${count(shape.length)} pieces · `
          + `your longest gap is ${dur(longest)} and the smallest task left is `
          + `${dur(input.smallestTaskMinutes ?? 0)}.`,
        legend: [
          `${free} free, in ${count(shape.length)} pieces — ${shape.map(dur).join(', ')}`,
          'No solid segment, because nothing can be placed.',
        ],
        // No primary: there is nothing to start. Triage demotes to a link.
        primary: null,
        secondary: 'Triage',
      }
    }

    case 'fitsWithSlack': {
      const spare = slack(capacity)
      return {
        kind,
        headline: spare > 0
          ? `Everything due today fits, with ${dur(spare)} spare.`
          // `formatMinutes(0)` is an em dash, and "fits, with — spare" is not
          // a sentence. Landing exactly is its own thing to say.
          : 'Everything due today fits, exactly.',
        supporting: start
          ? `Start with ${start.title} in the ${dur(start.gapMinutes)}`
            + (start.beforeTitle ? ` before ${start.beforeTitle}` : '')
            + '. It is the most urgent thing that fits there.'
          : capacityVerdict(capacity).text,
        legend: [
          `${dur(capacity.freeBeforeCutoff)} of work before ${late}`,
          `${dur(Math.max(0, capacity.dueTotal - capacity.freeBeforeCutoff))} of it after ${late}`,
          `${dur(spare)} spare, and yours to keep`,
        ],
        primary: start ? `Start ${start.title}` : null,
        secondary: `Pull forward ${dur(spare)}`,
      }
    }

    case 'nothingDue':
      return {
        kind,
        headline: 'Nothing is due today.',
        supporting: `${free} free.`
          + (nextDue
              ? ` The next thing due is ${nextDue.title} ${nextDue.when} at `
                + `${dur(nextDue.minutes)}.`
              : ''),
        legend: [`${free} free, none of it spoken for`],
        // No primary, because there is nothing you have to do.
        primary: null,
        secondary: 'Pull work forward',
      }
  }
}
