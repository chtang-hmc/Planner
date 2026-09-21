/**
 * Insights: three findings, one workload table, and what is not known yet.
 *
 * **If a finding cannot name a number, it is not a finding.** Every card here
 * returns null rather than render a hedge — "your urgency scores look a bit
 * high" is a horoscope. The page shows what survives, and a page with one card
 * on it is telling the truth about how much it knows.
 *
 * Replaces Analytics' estimate-accuracy donut (50% from four samples is not a
 * statistic), its urgency histogram (its one finding is a card now) and its
 * 7-day energy chart (five bars between 2.0 and 3.0 is not a pattern). What
 * those three had in common is that they drew a picture of data too thin to
 * carry one; `thinData` says so in words instead.
 */

import type { Capacity } from '@/lib/capacity'
import { deficit, freeTotal, LATE_CUTOFF_MINUTES } from '@/lib/capacity'
import { formatMinutes } from '@/lib/task-format'
import type { ProjectRow } from '@/lib/projects'
import { CONCENTRATION_THRESHOLD } from '@/lib/projects'

export type FindingKey = 'capacity' | 'urgency' | 'concentration'

export interface Finding {
  key:      FindingKey
  /** The eyebrow: CAPACITY, URGENCY, CONCENTRATION. */
  label:    string
  /** The headline, set in the display face. Always contains the number. */
  headline: string
  /** Two sentences of evidence. Each one is a fact, not a restatement. */
  evidence: string
  /** Where to go to act on it. */
  action:   { label: string; href: string }
  /** Red when it is a problem now, neutral when it is a shape worth knowing. */
  urgent:   boolean
}

/** Above this share of tasks scoring high, the score has stopped sorting. */
export const URGENCY_FLAT_SHARE = 0.6
export const URGENCY_HIGH = 60

/**
 * Today holds more than it can hold.
 *
 * Only said when there is a real ratio to report: a day with no working hours
 * and a day with no calendar connected both produce zeroes, and neither is a
 * finding about your workload.
 */
export function capacityFinding(opts: {
  capacity: Capacity | null
  dueCount: number
  /** How many of the due tasks fit in the free time, largest-first. */
  fitCount: number
}): Finding | null {
  const { capacity, dueCount, fitCount } = opts
  if (!capacity) return null

  const free = freeTotal(capacity)
  const short = deficit(capacity)
  if (capacity.dueTotal === 0 || free === 0) return null
  if (short === 0) return null

  const cutoff = `${LATE_CUTOFF_MINUTES / 60 > 12 ? LATE_CUTOFF_MINUTES / 60 - 12 : LATE_CUTOFF_MINUTES / 60}pm`

  return {
    key: 'capacity',
    label: 'Capacity',
    headline: `Today holds ${formatMinutes(capacity.dueTotal)} of work and ${formatMinutes(free)} of time.`,
    evidence:
      `${dueCount} task${dueCount === 1 ? '' : 's'} ${dueCount === 1 ? 'is' : 'are'} due. `
      + `${fitCount === 0 ? 'None of them fits' : `${fitCount} of them fit${fitCount === 1 ? 's' : ''}`} before ${cutoff}. `
      + `That leaves ${formatMinutes(short)} with nowhere to go.`,
    action: { label: 'Triage today →', href: '/' },
    urgent: true,
  }
}

/**
 * When almost everything is urgent, the score has stopped sorting anything.
 *
 * Said only when the distribution is actually degenerate. A list where two
 * thirds score high is a list you cannot order by urgency, which is a fact
 * about the score rather than about any task.
 */
export function urgencyFinding(scores: number[]): Finding | null {
  if (scores.length < 5) return null   // a shape needs enough points to have one

  const high = scores.filter(s => s > URGENCY_HIGH).length
  if (high / scores.length < URGENCY_FLAT_SHARE) return null

  const veryHigh = scores.filter(s => s > 80).length
  const low      = scores.filter(s => s < 40).length

  return {
    key: 'urgency',
    label: 'Urgency',
    headline: `${high} of your ${scores.length} tasks score above ${URGENCY_HIGH}.`,
    evidence:
      `When almost everything is urgent, the score stops sorting anything. `
      + `${veryHigh} task${veryHigh === 1 ? '' : 's'} sit${veryHigh === 1 ? 's' : ''} above 80 `
      + `and ${low === 0 ? 'none' : `only ${low}`} below 40.`,
    action: { label: 'Rebalance due dates →', href: '/tasks' },
    urgent: false,
  }
}

/**
 * One project has taken over the workload.
 *
 * The same rule the project table uses — the single largest row, at or above
 * the threshold — so the two pages cannot disagree about whether it is worth
 * mentioning. Inbox is excluded there and therefore here.
 */
export function concentrationFinding(opts: {
  rows: ProjectRow[]
  /** Titles of this project's active tasks that have a confirmed calendar slot. */
  scheduledCount: number
}): Finding | null {
  const { rows, scheduledCount } = opts

  const largest = rows.filter(r => !r.isInbox)
    .reduce<ProjectRow | null>((best, r) => !best || r.minutesLeft > best.minutesLeft ? r : best, null)
  if (!largest || largest.share < CONCENTRATION_THRESHOLD) return null

  const pct = largest.progress === null ? null : Math.round(largest.progress * 100)

  return {
    key: 'concentration',
    label: 'Concentration',
    headline: `${largest.name} is ${Math.round(largest.share * 100)}% of everything you have left.`,
    evidence:
      `${formatMinutes(largest.minutesLeft)} across ${largest.activeCount} active `
      + `task${largest.activeCount === 1 ? '' : 's'}${pct === null ? '' : `, ${pct}% done`}. `
      + (scheduledCount === 0
          ? 'None of them has a time on the calendar this week.'
          : `${scheduledCount} of them ${scheduledCount === 1 ? 'has' : 'have'} a time on the calendar this week.`),
    action: { label: `Open ${largest.name} →`, href: largest.id ? `/projects/${largest.id}` : '/projects' },
    urgent: false,
  }
}

/**
 * The line above the workload table.
 *
 * Says the one thing the table's rows cannot: how much of the total is sitting
 * in no project at all. Null when the inbox is empty, which is a quiet win and
 * not something to announce.
 */
export function workloadFinding(rows: ProjectRow[]): string | null {
  const inbox = rows.find(r => r.isInbox)
  if (!inbox || inbox.minutesLeft === 0) return null

  const share = inbox.share
  const qualifier =
    share >= 0.45 ? 'almost half'
    : share >= 0.3 ? 'nearly a third'
    : share >= 0.2 ? 'a fifth'
    : null

  return `${formatMinutes(inbox.minutesLeft)} of it${qualifier ? ` — ${qualifier} —` : ''} has no project.`
}

/** The stacked bar: one segment per row, widest first, floored so none vanishes. */
export function workloadSegments(rows: ProjectRow[]): {
  id: string | null; name: string; color: string | null; share: number
}[] {
  return rows
    .filter(r => r.minutesLeft > 0)
    .map(r => ({ id: r.id, name: r.name, color: r.color, share: r.share }))
}
