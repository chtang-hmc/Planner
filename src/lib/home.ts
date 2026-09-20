/**
 * Home / Today — what to do now, and what today actually looks like.
 *
 * Pure. Everything here is arithmetic over a day's events and a list of tasks,
 * so the page can be built without touching the database or Google — see
 * `docs/HOME.md` for why that matters. The I/O lives in the page component.
 *
 * Two rules from the spec are load-bearing and each has a test:
 *
 *   1. **Gaps come from `freeGaps`**, which subtracts every busy span from what
 *      is left of the day. Overlapping events therefore cannot manufacture free
 *      time that does not exist.
 *   2. **A subtask's importance is its parent's.** Subtasks are created at
 *      priority 1 with urgency 0 and no deadline, so ranked on their own rows
 *      the most urgent work in the app sorts to the bottom. Resolution happens
 *      at the edge, in `resolveAgainstParent`, and nothing downstream has to
 *      remember.
 */

import type { EnergyLevel, TaskType } from '@/types'
import {
  slotEnergyLevel,
  type EnergyScheduleEntry,
  type Interval,
  type TaskLocation,
} from '@/lib/scheduler'

const ENERGY_RANK: Record<EnergyLevel, number> = { low: 0, medium: 1, high: 2 }

/** Transition padding when neither the task nor the config names one. */
export const DEFAULT_BUFFER_MINUTES = 15

/** How many things "Do this now" offers: one to do, two to choose instead. */
export const SUGGESTION_COUNT = 3

/** A gap shorter than this is not worth naming — it is the walk between rooms. */
export const MIN_GAP_MINUTES = 15

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * A task as Home sees it: flat, already resolved against its parent, and
 * carrying only what ranking and display need.
 */
export interface HomeTask {
  id:              string
  title:           string
  /** Set on a subtask — the work this is a step of. */
  parentId:        string | null
  parentTitle:     string | null
  type:            TaskType
  priority:        number
  urgencyScore:    number
  energyRequired:  EnergyLevel
  /** adjusted_minutes ?? estimated_minutes. Null means unestimated. */
  minutes:         number | null
  /** Local day of the deadline, YYYY-MM-DD. */
  dueDay:          string | null
  /** Local day before which it cannot start. */
  startDay:        string | null
  location:        TaskLocation
  bufferMinutes:   number | null
  /** Set when it already has a focus block booked. */
  scheduledStartISO: string | null
  /** Creation order within the parent — the running order for a chain. */
  chainIndex:      number
}

/** Something already on the day. */
export interface HomeEvent {
  id:      string
  title:   string
  startMs: number
  endMs:   number
  /** A booked focus block rather than a calendar event. */
  taskId?: string | null
}

export interface HomeInput {
  nowMs:          number
  todayStr:       string
  tz:             string
  /** Free stretches of the working day, from `freeGaps`. */
  gaps:           Interval[]
  /**
   * The working window itself, from `workWindowFor`. Null on a day that is
   * switched off. Needed only to tell "the day has not started" from "you are
   * between things", which the gaps alone cannot say.
   */
  workWindow?:    Interval | null
  events:         HomeEvent[]
  tasks:          HomeTask[]
  energySchedule: EnergyScheduleEntry[]
  bufferMinutes:  number
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/** One thing to do, with the reasons it was picked. */
export interface Suggestion {
  /** Stable across renders: the ids it covers. */
  key:         string
  taskIds:     string[]
  title:       string
  parentTitle: string | null
  minutes:     number
  /** Why this, in the order it should be read. */
  reasons:     string[]
  score:       number
}

export type ShapeRow =
  | { kind: 'event'; key: string; startMs: number; endMs: number; title: string; taskId: string | null }
  | { kind: 'gap';   key: string; startMs: number; endMs: number; minutes: number; fits: Suggestion[] }

/**
 * The one-sentence answer at the top, as parts rather than prose — the view
 * decides the wording, and a test can read the parts.
 */
export interface RightNow {
  /** The event you are inside, if any. Overlaps resolve to the one ending last. */
  inEvent:   { title: string; endMs: number } | null
  /**
   * The free stretch you are in, or the next one today.
   *
   * `hasStarted` is the difference between "you have an hour" and "you will
   * have an hour". Without it the header announced the first gap of the day as
   * though it were current: at 08:00 against a 10:00 start it read "1h free
   * until ENTR 179A at 11:00am", offering time that had not arrived.
   *
   * `minutes` is what is left of it either way — the remainder for a gap in
   * progress, the whole of it for one still to come.
   */
  gap:       { startMs: number; endMs: number; minutes: number; hasStarted: boolean } | null
  /** What closes that gap. Null when nothing follows it today. */
  nextEvent: { title: string; startMs: number } | null
  /**
   * When the working day opens, if it has not yet.
   *
   * Distinguishes the two ways a gap can be in the future: the day has not
   * begun, or it has and you are inside something carved out of it — a meal
   * break, which is not an event and so leaves no `inEvent` behind.
   */
  dayStartsMs: number | null
  /** True when the working day has no free time left — or never had any. */
  doneForToday: boolean
}

/**
 * A line in "Needs attention".
 *
 * A chain collapses to one line. Three readings under one parent are three
 * rows of the same reminder, and the section is meant to be short enough to
 * read without deciding anything.
 */
export interface AttentionRow {
  key:         string
  taskIds:     string[]
  /** The parent for a collapsed chain, the task itself otherwise. */
  openId:      string
  title:       string
  /** "3 steps" for a chain; null for a single task. */
  stepsLabel:  string | null
  minutes:     number | null
  urgency:     number
}

export interface HomeData {
  rightNow:    RightNow
  /** For the current gap (or the next one, if you are in a meeting). */
  suggestions: Suggestion[]
  shape:       ShapeRow[]
  overdue:     AttentionRow[]
  dueToday:    AttentionRow[]
}

// ── Parent resolution ────────────────────────────────────────────────────────

/**
 * Give a subtask its parent's importance and deadline.
 *
 * Exactly the rule `proposeSchedule` applies on every run, for exactly the same
 * reason: the numbers copied onto a subtask at creation say it does not matter,
 * and the five Public Policy readings — the most urgent work on the list —
 * would sort below everything else. Home is the fourth reader of this rule, so
 * it is applied once here rather than remembered in three ranking functions.
 *
 * `own` wins only where the parent has nothing to say.
 */
export function resolveAgainstParent(
  own: HomeTask,
  parent: Pick<HomeTask, 'title' | 'priority' | 'urgencyScore' | 'dueDay' | 'startDay' | 'location'> | null,
): HomeTask {
  if (!parent) return own
  return {
    ...own,
    parentTitle:  parent.title,
    priority:     parent.priority,
    urgencyScore: parent.urgencyScore,
    dueDay:       parent.dueDay   ?? own.dueDay,
    startDay:     parent.startDay ?? own.startDay,
    location:     own.location !== 'anywhere' ? own.location : parent.location,
  }
}

// ── Fit ──────────────────────────────────────────────────────────────────────

/**
 * Clear space this task needs at each end of its block, in minutes.
 *
 * Away work costs the trip out *and* the trip back, so each edge pays the
 * transition twice. With the default 15 minutes that makes an errand need a
 * full hour of clear space — which is what keeps it out of the half-hour
 * between two classes, the case the spec calls out by name.
 */
export function edgeBuffer(t: Pick<HomeTask, 'bufferMinutes' | 'location'>, fallback: number): number {
  const base = t.bufferMinutes ?? fallback
  return t.location === 'away' ? base * 2 : base
}

/** Minutes of gap a task consumes end to end, buffers included. */
export function costOf(t: HomeTask, fallback: number): number {
  return (t.minutes ?? 0) + 2 * edgeBuffer(t, fallback)
}

/**
 * Can this be picked up at all today?
 *
 * Deliberately not a deadline test: work due next month is a perfectly good
 * thing to do in a free hour, and ranking — not filtering — is what keeps it
 * below what is due tonight.
 */
export function isCandidate(t: HomeTask, todayStr: string): boolean {
  if (t.type === 'someday') return false
  if (t.type === 'habit')   return false   // habits have their own section
  if (t.minutes == null)    return false   // nothing to fit
  if (t.scheduledStartISO)  return false   // already has a block
  if (t.startDay && t.startDay > todayStr) return false
  return true
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

/**
 * Clock time in the user's zone, e.g. "1:15pm".
 *
 * The meridiem is not decoration here. Working hours in this app can run past
 * midnight — 10:00 to 01:30 is a normal day — so a bare "10:00" is two
 * different hours twelve hours apart, and a real day has had both: an event at
 * 10:00am and a free stretch beginning at 10:00pm, printed identically.
 * Lowercase and unspaced so it stays a time rather than a sentence.
 */
export function formatClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(ms)).replace(/\s?([AP])M$/i, (_, p: string) => p.toLowerCase() + 'm')
}

/**
 * How long ago an instant was, worded — "2h ago". Null when there is nothing
 * to describe, which is not the same claim as "never".
 *
 * `nowMs` is a parameter rather than a call to the clock so this is pure, and
 * so the one place that reads the clock is the server component that renders
 * the page. The boundaries are why: a duration measured twice, once during SSR
 * and once at hydration, crosses "just now" into "2m ago" for any sync made
 * about two minutes before the request, and the markup then differs.
 */
export function describeAge(iso: string | null, nowMs: number): string | null {
  if (!iso) return null
  const mins = Math.round((nowMs - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins) || mins < 0) return null
  if (mins < 2)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export { fmtMinutes as formatGapMinutes }

// ── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Why a task was picked, most convincing first.
 *
 * A suggestion without a reason is an oracle, and an oracle that is wrong once
 * stops being trusted. Every line here is a fact about the task, not a
 * restatement of the score.
 */
function reasonsFor(
  t: HomeTask,
  opts: { gapMinutes: number; usedMinutes: number; todayStr: string; energyMatch: boolean },
): string[] {
  const out: string[] = [`fits your ${fmtMinutes(opts.gapMinutes)}`]

  if (t.dueDay) {
    const days = daysBetween(opts.todayStr, t.dueDay)
    out.push(
      days < 0  ? `overdue by ${-days} day${days === -1 ? '' : 's'}`
      : days === 0 ? 'due today'
      : days === 1 ? 'due tomorrow'
      : `due in ${days} days`
    )
  } else if (t.priority >= 3) {
    // With no deadline the priority is the only thing making it urgent — say so
    // rather than leaving the pick unexplained.
    out.push(t.priority === 4 ? 'critical, no deadline' : 'high priority')
  }

  if (opts.energyMatch) out.push('good energy window')
  if (t.parentTitle)    out.push(`part of ${t.parentTitle}`)

  return out
}

/** Whole days from `a` to `b`, both local day strings. Negative means b is past. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

/**
 * Rank what fits in one gap.
 *
 * Order is the spec's: urgency first, energy match second, fit third. They are
 * added rather than compared in sequence so that a two-point urgency difference
 * cannot outweigh working against your energy — urgency spans 0–100, the other
 * two are worth ten and six.
 *
 * Subtasks of one parent are offered as a **run**: as many consecutive steps as
 * fit in the gap, as one suggestion. Reading Dahl then Rawls needs no
 * transition in between, and "2 readings" is a better offer than the same
 * reading suggested three times.
 */
export function rankForGap(
  tasks: HomeTask[],
  gap: Interval,
  input: Pick<HomeInput, 'todayStr' | 'tz' | 'energySchedule' | 'bufferMinutes'>,
  limit = SUGGESTION_COUNT,
  /** Ids already spoken for by an earlier gap — see `buildHome`. */
  exclude: ReadonlySet<string> = new Set(),
): Suggestion[] {
  const [gapStart, gapEnd] = gap
  const gapMinutes = Math.round((gapEnd - gapStart) / 60_000)
  const slotEnergy = slotEnergyLevel(gapStart, input.energySchedule, input.tz)

  const eligible = tasks.filter(t => isCandidate(t, input.todayStr) && !exclude.has(t.id))

  // Group chain members by parent; everything else stands alone.
  const chains = new Map<string, HomeTask[]>()
  const singles: HomeTask[] = []
  for (const t of eligible) {
    if (t.parentId) chains.set(t.parentId, [...(chains.get(t.parentId) ?? []), t])
    else singles.push(t)
  }

  const out: Suggestion[] = []

  const make = (run: HomeTask[], usedMinutes: number): Suggestion => {
    const head = run[0]
    const energyMatch = ENERGY_RANK[slotEnergy] >= ENERGY_RANK[head.energyRequired]
    const fitBonus = Math.round(6 * Math.min(1, usedMinutes / Math.max(1, gapMinutes)))
    return {
      key:         run.map(r => r.id).join('+'),
      taskIds:     run.map(r => r.id),
      title:       run.length > 1 ? `${head.title} + ${run.length - 1} more` : head.title,
      parentTitle: head.parentTitle,
      minutes:     usedMinutes,
      reasons:     reasonsFor(head, { gapMinutes, usedMinutes, todayStr: input.todayStr, energyMatch }),
      score:       head.urgencyScore + (energyMatch ? 10 : 0) + fitBonus,
    }
  }

  for (const t of singles) {
    if (costOf(t, input.bufferMinutes) > gapMinutes) continue
    out.push(make([t], t.minutes!))
  }

  for (const members of chains.values()) {
    const ordered = [...members].sort((a, b) => a.chainIndex - b.chainIndex)
    // One buffer pair around the whole run, none between the steps.
    const edge = 2 * edgeBuffer(ordered[0], input.bufferMinutes)
    const run: HomeTask[] = []
    let used = 0
    for (const m of ordered) {
      if (edge + used + m.minutes! > gapMinutes) break
      run.push(m)
      used += m.minutes!
    }
    if (run.length > 0) out.push(make(run, used))
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ── The page ─────────────────────────────────────────────────────────────────

/** Where you are in the day, from the gaps and what bounds them. */
export function rightNowFrom(input: Pick<HomeInput, 'nowMs' | 'gaps' | 'events' | 'workWindow'>): RightNow {
  const { nowMs, gaps, events, workWindow } = input

  // Overlaps resolve to the event that ends last: with Fall Fest 11:00–13:15
  // running under ENTR 179A 11:00–12:15, you are not free at 12:15.
  const current = events
    .filter(e => e.startMs <= nowMs && e.endMs > nowMs)
    .sort((a, b) => b.endMs - a.endMs)[0] ?? null

  const gap = gaps.find(([, gapEnd]) => gapEnd > nowMs) ?? null
  const from = gap ? Math.max(gap[0], nowMs) : 0
  const gapPart = gap
    ? {
        startMs:    from,
        endMs:      gap[1],
        minutes:    Math.round((gap[1] - from) / 60_000),
        hasStarted: gap[0] <= nowMs,
      }
    : null

  const nextEvent = gap
    ? (events.filter(e => e.startMs >= gap[1] - 60_000).sort((a, b) => a.startMs - b.startMs)[0] ?? null)
    : null

  return {
    inEvent:      current ? { title: current.title, endMs: current.endMs } : null,
    gap:          gapPart,
    nextEvent:    nextEvent ? { title: nextEvent.title, startMs: nextEvent.startMs } : null,
    dayStartsMs:  workWindow && nowMs < workWindow[0] ? workWindow[0] : null,
    doneForToday: gapPart === null,
  }
}

/**
 * The one sentence at the top of Home, as words.
 *
 * Here rather than in the view because it is the page's whole thesis in a
 * single line, and every clause of it is a decision: whether a gap that has
 * not opened counts as time you have, whether a break is worth naming, what to
 * say when the day is over. Those are pinned by tests now, so the copy cannot
 * drift without someone choosing to change it.
 */
export function rightNowSentence(rn: RightNow, tz: string): string {
  const clock = (ms: number) => formatClock(ms, tz)
  const { inEvent, gap, nextEvent, dayStartsMs, doneForToday } = rn

  if (inEvent) {
    return gap
      ? `In ${inEvent.title} until ${clock(inEvent.endMs)}. Next free: ${fmtMinutes(gap.minutes)} at ${clock(gap.startMs)}.`
      : `In ${inEvent.title} until ${clock(inEvent.endMs)}. Nothing free after it today.`
  }

  if (doneForToday) return 'No working time left today.'
  if (!gap) return 'Nothing on today.'

  // A gap that has not opened yet is not time you have. Two ways to be here:
  // the working day has not begun, or it has and you are inside something
  // carved out of it — a meal break leaves no event behind to report.
  if (!gap.hasStarted) {
    return dayStartsMs != null
      ? `Your day starts at ${clock(dayStartsMs)} — ${fmtMinutes(gap.minutes)} free then.`
      : `Nothing free until ${clock(gap.startMs)}, then ${fmtMinutes(gap.minutes)}.`
  }

  return nextEvent
    ? `${fmtMinutes(gap.minutes)} free until ${nextEvent.title} at ${clock(nextEvent.startMs)}.`
    : `${fmtMinutes(gap.minutes)} free until ${clock(gap.endMs)}.`
}

/**
 * Everything the page draws.
 *
 * Suggestions are made for the gap you are in — or, when you are in a meeting,
 * the one you are about to get, since "what should I do now" during a lecture
 * means "what should I line up for when it ends".
 */
export function buildHome(input: HomeInput): HomeData {
  const { nowMs, todayStr, gaps, events, tasks } = input

  const rightNow = rightNowFrom(input)

  // Gaps that are over are not offers. Neither are slivers.
  const liveGaps = gaps
    .map(([gS, gE]): Interval => [Math.max(gS, nowMs), gE])
    .filter(([gS, gE]) => gE - gS >= MIN_GAP_MINUTES * 60_000)

  const suggestions = liveGaps.length > 0
    ? rankForGap(tasks, liveGaps[0], input)
    : []

  // ── Today's shape ──────────────────────────────────────────────────────────
  // Events keep their own rows even when they overlap — a real day has them,
  // and flattening two into one is how a page starts lying about the day.
  const eventRows: ShapeRow[] = [...events]
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs)
    .map(e => ({
      kind: 'event' as const,
      key: `e:${e.id}`,
      startMs: e.startMs, endMs: e.endMs,
      title: e.title, taskId: e.taskId ?? null,
    }))

  /**
   * Each gap gets work the earlier gaps did not take.
   *
   * Ranked independently, every gap offers the same most-urgent task, and the
   * column becomes one answer printed five times. Walking the day in order and
   * spending each suggestion once turns it into something closer to a plan:
   * the readings in the afternoon, the errand in the evening.
   *
   * The first gap is exempt from nothing — it is the one you are in, and it
   * should agree with "Do this now" above it.
   */
  const spent = new Set<string>()
  const gapRows: ShapeRow[] = []
  for (const raw of gaps) {
    // The gap you are standing in starts now, not when it opened. Showing its
    // original start would offer an hour and a half that is already an hour —
    // and would rank against time that no longer exists.
    const g: Interval = [Math.max(raw[0], nowMs), raw[1]]
    if (g[1] - g[0] < MIN_GAP_MINUTES * 60_000) continue
    const fits = rankForGap(tasks, g, input, 2, spent)
    for (const s of fits) for (const id of s.taskIds) spent.add(id)
    gapRows.push({
      kind: 'gap', key: `g:${g[0]}`,
      startMs: g[0], endMs: g[1],
      minutes: Math.round((g[1] - g[0]) / 60_000),
      fits,
    })
  }

  const shape = [...eventRows, ...gapRows]
    .filter(r => r.endMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs)

  // ── Needs attention ────────────────────────────────────────────────────────
  // Overdue and due today only. Short by design, and empty on a good day.
  const attention = tasks.filter(t =>
    t.type !== 'habit' && t.type !== 'someday' && t.dueDay != null && t.dueDay <= todayStr
  )

  return {
    rightNow,
    suggestions,
    shape,
    overdue:  collapseChains(attention.filter(t => t.dueDay! <  todayStr)),
    dueToday: collapseChains(attention.filter(t => t.dueDay! === todayStr)),
  }
}

/** One line per piece of work: a chain becomes "Readings · 3 steps". */
export function collapseChains(tasks: HomeTask[]): AttentionRow[] {
  const groups = new Map<string, HomeTask[]>()
  for (const t of tasks) {
    const key = t.parentId ?? t.id
    groups.set(key, [...(groups.get(key) ?? []), t])
  }

  const rows: AttentionRow[] = []
  for (const [key, members] of groups) {
    const ordered = [...members].sort((a, b) => a.chainIndex - b.chainIndex)
    const head = ordered[0]
    const chain = head.parentId != null
    const minutes = ordered.reduce<number | null>(
      (sum, m) => (sum == null || m.minutes == null ? null : sum + m.minutes), 0,
    )
    rows.push({
      key,
      taskIds:    ordered.map(m => m.id),
      // A collapsed chain opens the work it belongs to, not one step of it.
      openId:     chain ? head.parentId! : head.id,
      title:      chain ? (head.parentTitle ?? head.title) : head.title,
      stepsLabel: ordered.length > 1 ? `${ordered.length} steps` : null,
      minutes,
      urgency:    Math.max(...ordered.map(m => m.urgencyScore)),
    })
  }

  return rows.sort((a, b) => b.urgency - a.urgency)
}
