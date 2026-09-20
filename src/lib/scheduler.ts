// ─────────────────────────────────────────────────────────────────────────────
// Scheduling algorithm — pure TypeScript, no DB/API calls.
// All I/O is handled by the server action (src/app/actions/scheduling.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { EnergyLevel } from '@/types'
import { addDays } from '@/lib/day'

// ── Time blocks ───────────────────────────────────────────────────────────────

export type TimeBlockId =
  | 'past_midnight'
  | 'early_morning'
  | 'morning'
  | 'post_lunch'
  | 'afternoon'
  | 'post_dinner'
  | 'evening'
  | 'late_night'

export const TIME_BLOCK_DEFS: {
  id: TimeBlockId
  label: string
  startH: number  // inclusive
  endH: number    // exclusive
}[] = [
  { id: 'past_midnight',  label: 'Past midnight',  startH: 0,  endH: 5  },
  { id: 'early_morning',  label: 'Early morning',  startH: 5,  endH: 8  },
  { id: 'morning',        label: 'Morning',         startH: 8,  endH: 12 },
  { id: 'post_lunch',     label: 'Post-lunch',      startH: 12, endH: 14 },
  { id: 'afternoon',      label: 'Afternoon',       startH: 14, endH: 17 },
  { id: 'post_dinner',    label: 'Post-dinner',     startH: 17, endH: 20 },
  { id: 'evening',        label: 'Evening',         startH: 20, endH: 22 },
  { id: 'late_night',     label: 'Late night',      startH: 22, endH: 24 },
]

export function getTimeBlockId(hour: number): TimeBlockId {
  for (const b of TIME_BLOCK_DEFS) {
    if (hour >= b.startH && hour < b.endH) return b.id
  }
  return 'past_midnight'
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface WorkingHours {
  day_of_week:  number   // 0=Sun … 6=Sat
  start_hour:   number
  start_minute: number
  end_hour:     number
  end_minute:   number
  enabled:      boolean
}

export interface EnergyScheduleEntry {
  day_of_week:  number
  time_block:   TimeBlockId
  energy_level: EnergyLevel
}

/**
 * A recurring daily break that must fit somewhere inside a window — a meal,
 * not a fixed appointment. The scheduler picks the actual time each day.
 */
export interface BreakWindow {
  label:            string
  durationMinutes:  number
  startHour:        number   // window opens (local)
  startMinute:      number
  endHour:          number   // window closes (local)
  endMinute:        number
  /**
   * Minutes after the break ends during which tasks marked `avoidAfterBreaks`
   * cannot be scheduled — "no running for an hour after eating".
   */
  cooldownMinutes:  number
}

export interface SchedulerConfig {
  maxSessionMinutes: number  // default 90
  bufferMinutes:     number  // default 15
  timezone:          string  // IANA tz, e.g. "America/Los_Angeles"
  startDateStr?:     string  // YYYY-MM-DD local date to start horizon from; defaults to today
  breaks?:           BreakWindow[]
}

export interface SchedulerTask {
  id:                string
  title:             string
  priority:          number
  urgency_score:     number
  energy_required:   EnergyLevel
  duration_minutes:  number   // adjusted_minutes ?? estimated_minutes, caller picks
  due_date:          string | null  // ISO
  /**
   * Minutes from local midnight on the due day, when the deadline is an hour
   * rather than a date. "Due at 5pm" means finished by five, not started then —
   * so this tightens the deadline within the day; it does not pin a start.
   */
  dueTimeMinutes?:   number | null
  /**
   * Tasks sharing a spreadGroup are placed on distinct days. Used for habit
   * sessions: "gym 4×/week" expands into 4 candidates with one group, so they
   * land on four different days instead of stacking into a single afternoon.
   */
  spreadGroup?:      string
  /**
   * Work that cannot be split across sittings — it occupies one unbroken block
   * however long it is, instead of being chunked by maxSessionMinutes.
   *
   * Habit sessions are atomic: a 120-minute gym session is one 120-minute
   * block, not 90 minutes on Monday and 30 on Tuesday. Without this a habit
   * whose session exceeds maxSessionMinutes gets one block per segment, so a
   * 2×/week target silently produces four scheduled blocks.
   */
  atomic?:           boolean
  /**
   * Keep this off the cooldown period after a break (see BreakWindow). Set on
   * physical habits so a gym session isn't scheduled straight after lunch.
   */
  avoidAfterBreaks?: boolean
  /**
   * Transition padding around this task, overriding config.bufferMinutes.
   * 0 lets a small chore slot into any gap — a 5-minute job shouldn't need 35
   * minutes of clear space just to satisfy the global buffer.
   */
  bufferMinutes?:    number
  /**
   * Where the task has to happen. Used with `spanMinutes` to keep incompatible
   * work apart: you can't be at the gym while the washing machine needs you
   * at home.
   */
  location?:         TaskLocation
  /**
   * Total time the task ties you up, when that is longer than the work itself.
   *
   * Washing sheets is ten minutes of attention across a two-hour cycle: the
   * scheduled block is `duration_minutes` (the attention), while `spanMinutes`
   * pins your location for the whole cycle. Other work can be scheduled inside
   * the span — that's the point — as long as its location is compatible.
   */
  spanMinutes?:      number
  /**
   * Work that runs back-to-back. Subtasks of one parent share a chainGroup:
   * reading Dahl then Rawls needs no transition between them, only a buffer
   * either side of the run. The scheduler packs as many as fit per sitting.
   */
  chainGroup?:       string
  /**
   * Fixed wait between this chain member and the next — machine time, rising
   * time, a coat of paint drying. The gap is not reserved (you're free during
   * it), but the next stage must land exactly that far after this one ends.
   */
  gapAfterMinutes?:  number
  /**
   * Position within the chain. Stages run in this order — you can't fold the
   * sheets before they've been in the dryer — and the urgency sort that orders
   * everything else would scramble them.
   */
  chainIndex?:       number
  /**
   * Earliest this may be scheduled. The deadline says when work must be
   * finished; this says when it may begin — next week's grading can't start
   * before next week's homework exists, however much free time today has.
   */
  notBefore?:        string   // ISO
}

/** Where a task happens. 'anywhere' is compatible with everything. */
export type TaskLocation = 'home' | 'away' | 'anywhere'

/** True when two locations can't be occupied at the same time. */
function locationsClash(a: TaskLocation, b: TaskLocation): boolean {
  return a !== 'anywhere' && b !== 'anywhere' && a !== b
}

/** Busy interval as [startMs, endMs] */
export type Interval = [number, number]

// ── Output types ──────────────────────────────────────────────────────────────

export interface ProposedBlock {
  taskId:         string
  taskTitle:      string
  taskPriority:   number
  start:          Date
  end:            Date
  segmentIndex:   number   // 0-based — which chunk of a multi-segment task
  totalSegments:  number
  energyMatch:    boolean  // true if slot energy >= task.energy_required
}

export interface SchedulerResult {
  scheduled:     ProposedBlock[]
  unschedulable: SchedulerTask[]   // no slot found within deadline
}

/**
 * Label for a scheduled block.
 *
 * A subtask title alone is meaningless on a calendar — "Dahl" says nothing
 * three days from now. Prefixing the parent gives the block its context:
 * "Philosophy Readings - Dahl". Lives here rather than in the actions file
 * because a 'use server' module may only export async functions, and both the
 * preview and the Google Calendar event need it so the two always read alike.
 */
export function blockLabel(title: string, parentTitle?: string | null): string {
  return parentTitle ? `${parentTitle} - ${title}` : title
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENERGY_RANK: Record<EnergyLevel, number> = { low: 0, medium: 1, high: 2 }

/**
 * Returns the UTC timestamp (ms) for midnight at the start of `dateStr`
 * (e.g. "2026-09-14") in the given IANA timezone.
 *
 * Strategy: start from UTC midnight on that date, then measure what local hour
 * it currently shows in the target tz and shift accordingly.
 */
export function localMidnight(dateStr: string, tz: string): number {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(utcMidnight)
  const h = parseInt(parts.find(p => p.type === 'hour')!.value)
  const m = parseInt(parts.find(p => p.type === 'minute')!.value)
  const totalMins = h * 60 + m
  // If totalMins <= 720 (noon): tz is ahead of UTC, so local midnight was earlier (subtract)
  // If totalMins > 720: tz is behind UTC, so local midnight is later (add 24h - totalMins)
  const offsetMins = totalMins <= 720 ? -totalMins : (24 * 60 - totalMins)
  return utcMidnight.getTime() + offsetMins * 60_000
}

/**
 * Returns the UTC ms for the END of `dueISO`'s date in the given timezone.
 *
 * due_date is stored as YYYY-MM-DDT00:00:00Z (UTC midnight). The user's
 * intended deadline is end-of-day in their local timezone, i.e. the local
 * midnight of the following day.
 *
 * Example: due_date "2026-09-15T00:00:00Z" for a UTC-7 user → deadline is
 * "2026-09-16T07:00:00Z" (midnight Sep 16 PDT), NOT "2026-09-15T00:00:00Z"
 * (which is 5pm Sep 14 PDT — already in the past on the due day!).
 */
function deadlineMs(
  dueISO: string,
  dueTimeMinutes: number | null | undefined,
  tz: string,
): number {
  // Extract the UTC date string from the stored ISO (e.g. "2026-09-15")
  const dateStr = dueISO.slice(0, 10)

  /**
   * An hour on the due day (tasks.due_time_minutes, migration 0015) tightens the
   * deadline: a report due at 5pm should not be placed in the 7pm slot and
   * called on time.
   *
   * Deliberately a deadline and not a pin. "Due at 5pm" says when the work must
   * be *finished*; treating it as an appointment would stop the scheduler
   * putting the work anywhere earlier, which is usually exactly where it wants
   * to go.
   */
  if (dueTimeMinutes != null) {
    return localMidnight(dateStr, tz) + dueTimeMinutes * 60_000
  }

  // Midnight of the next local day = end of the due day.
  //
  // Stepped with addDays rather than `new Date(dateStr).setDate(+1)`: that
  // round trip parses to UTC midnight, adds one *local* day — 23 or 25 hours
  // across a DST change — and reads the result back as UTC, so on the two
  // transition days a year it lands on the wrong date. addDays steps in UTC,
  // where every day is 24 hours.
  return localMidnight(addDays(dateStr, 1), tz)
}

/** Returns local {dayOfWeek, hour} for a UTC timestamp in the given IANA timezone. */
function localPartsAt(ms: number, tz: string): { dow: number; hour: number } {
  const d = new Date(ms)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(d)
  const weekdayStr = parts.find(p => p.type === 'weekday')!.value
  const hour       = parseInt(parts.find(p => p.type === 'hour')!.value)
  const DOW_MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return { dow: DOW_MAP[weekdayStr] ?? 0, hour }
}

export function slotEnergyLevel(
  slotStartMs: number,
  energySchedule: EnergyScheduleEntry[],
  tz: string,
): EnergyLevel {
  const { dow, hour } = localPartsAt(slotStartMs, tz)
  const block = getTimeBlockId(hour)
  const entry = energySchedule.find(e => e.day_of_week === dow && e.time_block === block)
  return entry?.energy_level ?? 'medium'
}

/**
 * Subtract busy intervals from free intervals.
 * All values are ms timestamps. Returns sorted, non-overlapping result.
 */
export function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
  let result: Interval[] = [...free]
  for (const [bS, bE] of busy) {
    const next: Interval[] = []
    for (const [fS, fE] of result) {
      if (bE <= fS || bS >= fE) {
        next.push([fS, fE])
      } else {
        if (fS < bS) next.push([fS, bS])
        if (fE > bE) next.push([bE, fE])
      }
    }
    result = next
  }
  return result.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])
}

// ── Day shape: working window, breaks, free gaps ─────────────────────────────
//
// Lifted out of runScheduler so a page can ask what a day looks like without
// running the scheduler — and, more to the point, without the Google round trip
// that comes with it. runScheduler calls exactly these, so the Home page and a
// proposed schedule can never disagree about where the free time is.

/**
 * The working window for the day beginning at `dayMs`, as [start, end].
 *
 * An end at or before the start means the window runs past midnight —
 * "10:00 to 01:30" is a fifteen-and-a-half hour day ending next morning, not
 * a negative one. Returns null when the day is switched off.
 */
export function workWindowFor(
  dayMs: number,
  workingHours: WorkingHours[],
  tz: string,
): Interval | null {
  const { dow } = localPartsAt(dayMs + 60_000, tz)  // +1min: avoid DST edge at midnight
  const wh = workingHours.find(w => w.day_of_week === dow)
  if (!wh || !wh.enabled) return null

  const startOff = (wh.start_hour * 60 + wh.start_minute) * 60_000
  let   endOff   = (wh.end_hour   * 60 + wh.end_minute)   * 60_000
  if (endOff <= startOff) endOff += 24 * 60 * 60_000      // spills into the next day
  return [dayMs + startOff, dayMs + endOff]
}

/**
 * Where each break lands on the day beginning at `dayMs`.
 *
 * A break is a duration that must fit somewhere inside a window, not a fixed
 * appointment: it takes the earliest free slot in its window that it fits in.
 * Only real calendar events compete — this runs before anything is placed.
 */
export function placeBreaks(
  dayMs: number,
  breaks: BreakWindow[],
  busy: Interval[],
): { reserved: Interval[]; cooldowns: Interval[] } {
  const reserved:  Interval[] = []
  const cooldowns: Interval[] = []

  for (const br of breaks) {
    const winStart = dayMs + (br.startHour * 60 + br.startMinute) * 60_000
    const winEnd   = dayMs + (br.endHour   * 60 + br.endMinute)   * 60_000
    const needMs   = br.durationMinutes * 60_000
    if (winEnd - winStart < needMs) continue

    const free = subtractIntervals(
      [[winStart, winEnd]],
      busy.filter(([s, e]) => s < winEnd && e > winStart),
    )
    const slot = free.find(([fS, fE]) => fE - fS >= needMs)
    if (!slot) continue          // window fully booked that day — skip it

    const start = slot[0]
    const end   = start + needMs
    reserved.push([start, end])
    if (br.cooldownMinutes > 0) {
      cooldowns.push([end, end + br.cooldownMinutes * 60_000])
    }
  }

  return { reserved, cooldowns }
}

/**
 * The free stretches of one local day: the working window, minus everything
 * already on it.
 *
 * **Overlapping events must not be flattened.** A real day has them — Fall Fest
 * 11:00–13:15 runs under ENTR 179A 11:00–12:15 — and the free time after that
 * pair starts at 13:15, not 12:15. `subtractIntervals` removes each busy span
 * from what is left of the day rather than walking events pairwise, so a span
 * nested inside a longer one takes nothing away that the longer one had not
 * already taken. That is the whole correctness trap in this file, and
 * `freeGaps` is where it is pinned by a test.
 */
/**
 * Why a day has no free time — because absence of data and data showing
 * absence are different facts, and an empty list cannot tell them apart.
 *
 * `No working time left today` is true of exactly one of these, and it used to
 * be said for all of them: a disabled weekday returns the same empty list as a
 * day booked solid.
 *
 * `unknown` is deliberately not here. Whether the calendar has been seen at
 * all is a question about data provenance, not about intervals — this function
 * is given working hours and busy spans and could only ever guess. It lives
 * beside the thing that does know; see `dayReason` in lib/home.ts.
 */
export type GapReason =
  /** Working hours are switched off for this weekday. Genuinely none. */
  | 'dayOff'
  /** There were hours and something else is in all of them. None left. */
  | 'consumed'
  /** There is free time. */
  | 'available'

export interface DayGaps {
  reason: GapReason
  gaps:   Interval[]
}

export function freeGaps(opts: {
  dayStr:       string
  tz:           string
  workingHours: WorkingHours[]
  busy:         Interval[]
  breaks?:      BreakWindow[]
  /** Drop gaps shorter than this. 0 keeps every sliver. */
  minMinutes?:  number
}): DayGaps {
  const { dayStr, tz, workingHours, busy, breaks = [], minMinutes = 0 } = opts
  const dayMs = localMidnight(dayStr, tz)
  const win   = workWindowFor(dayMs, workingHours, tz)
  if (!win) return { reason: 'dayOff', gaps: [] }

  const [winStart, winEnd] = win
  const relevant = busy.filter(([s, e]) => s < winEnd && e > winStart)
  const { reserved } = placeBreaks(dayMs, breaks, busy)

  const gaps = subtractIntervals([[winStart, winEnd]], [...relevant, ...reserved])
    .filter(([s, e]) => e - s >= minMinutes * 60_000)

  return { reason: gaps.length > 0 ? 'available' : 'consumed', gaps }
}

// ── Main algorithm ────────────────────────────────────────────────────────────

/**
 * Energy-aware greedy scheduler with best-fit slot selection.
 *
 * Sort order: urgency_score + 8 bonus for multi-segment tasks (protects large
 * tasks from being starved by small-task fragmentation).
 *
 * Slot selection: among energy-matched slots (or all slots on fallback), pick
 * the tightest fit (smallest excess capacity). This naturally leaves large
 * windows available for large tasks.
 */
export function runScheduler(
  candidates:     SchedulerTask[],
  workingHours:   WorkingHours[],
  energySchedule: EnergyScheduleEntry[],
  busyIntervals:  Interval[],   // raw GCal busy intervals (no buffer)
  horizonDays:    number,
  config:         SchedulerConfig,
): SchedulerResult {
  const nowMs    = Date.now()
  const tz       = config.timezone

  // Build day boundaries for the horizon (as UTC ms of local midnight in user's tz)
  const startStr = config.startDateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const days: number[] = []   // each value = UTC ms of local midnight for that day
  for (let i = 0; i < horizonDays; i++) {
    // Same reason as deadlineMs: pure calendar arithmetic, so a DST day cannot
    // shift the horizon by one.
    days.push(localMidnight(addDays(startStr, i), tz))
  }

  // Occupied intervals grow as we place blocks (stored raw, buffer applied on use)
  const placedBlocks: Interval[] = []

  // Sort: urgency + multi-segment bonus
  // Spans, not segments: an atomic task is one segment but still needs a large
  // window, so it earns the same anti-fragmentation bonus as a split one.
  const spans = (t: SchedulerTask) => Math.ceil(t.duration_minutes / config.maxSessionMinutes)
  const sorted = [...candidates].sort((a, b) => {
    const aScore = a.urgency_score + (spans(a) > 1 ? 8 : 0)
    const bScore = b.urgency_score + (spans(b) > 1 ? 8 : 0)
    return bScore - aScore
  })

  // ── Daily breaks ──────────────────────────────────────────────────────────
  // Placed before any task, so a meal gets first claim on its window rather
  // than losing it to whatever work happened to sort first. Each break takes
  // the earliest free slot inside its window that fits.
  const breakIntervals:    Interval[] = []   // reserved — busy for everything
  const cooldownIntervals: Interval[] = []   // busy only for avoidAfterBreaks tasks

  for (const dayMs of days) {
    const { reserved, cooldowns } = placeBreaks(dayMs, config.breaks ?? [], busyIntervals)
    breakIntervals.push(...reserved)
    cooldownIntervals.push(...cooldowns)
  }

  const scheduled:     ProposedBlock[] = []
  const unschedulable: SchedulerTask[] = []

  // spreadGroup → day-midnight ms values already used by that group
  const groupDays = new Map<string, Set<number>>()

  // Windows where a long-running task pins the user somewhere. Unlike a placed
  // block these do NOT consume the time — other work is welcome inside them,
  // provided its location is compatible.
  const tethers:   { start: number; end: number; loc: TaskLocation }[] = []
  // Every placed block with its location, so a task that would tether cannot
  // start when work that must happen elsewhere is already booked inside its span.
  const placedLoc: { start: number; end: number; loc: TaskLocation }[] = []

  /** This run's working hours and timezone, bound to the shared helper. */
  const workWindow = (dayMs: number) => workWindowFor(dayMs, workingHours, tz)

  /**
   * Free intervals across the horizon for work with these constraints.
   * Shared by single tasks and subtask chains so both see the same day
   * boundaries, buffers, breaks and tethers.
   */
  function freeSlots(opts: {
    bufferMs: number
    loc: TaskLocation
    avoidAfterBreaks?: boolean
    dueMs: number
  }): { dayMs: number; fS: number; fE: number }[] {
    const { bufferMs, loc, avoidAfterBreaks, dueMs } = opts
    const allBusy: Interval[] = [
      ...busyIntervals.map(([s, e]): Interval => [s - bufferMs, e + bufferMs]),
      ...placedBlocks.map(([s, e]):  Interval  => [s - bufferMs, e + bufferMs]),
      ...breakIntervals.map(([s, e]): Interval => [s - bufferMs, e + bufferMs]),
      // Cooldowns are not buffered: the window is already an explicit
      // "not for this long", and padding it would quietly extend the rule.
      ...(avoidAfterBreaks ? cooldownIntervals : []),
    ]

    const out: { dayMs: number; fS: number; fE: number }[] = []
    for (const dayMs of days) {
      if (dayMs > dueMs) break

      const win = workWindow(dayMs)
      if (!win) continue
      const [workStartMs, workEndMs] = win

      const dayBusy = allBusy.filter(([s, e]) => s < workEndMs && e > workStartMs)

      // Tethers that pin the user somewhere incompatible are carved out of the
      // free time rather than rejected per-slot: a slot beginning inside a
      // tether should slide to just after it, not disappear.
      const blocking: Interval[] = tethers
        .filter(t => locationsClash(t.loc, loc) && t.start < workEndMs && t.end > workStartMs)
        .map(t => [t.start, t.end])

      for (const [fS, fE] of subtractIntervals([[workStartMs, workEndMs]], [...dayBusy, ...blocking])) {
        out.push({ dayMs, fS, fE })
      }
    }
    return out
  }

  // Chains already dealt with, so the remaining members are skipped
  const handledChains = new Set<string>()

  /**
   * Place a run of chained work — subtasks of one parent.
   *
   * They sit back-to-back with no buffer between them; the buffer wraps the run
   * as a whole. Each sitting takes the slot that fits the MOST of them, so the
   * chain is grouped as tightly as the week allows rather than scattered one
   * subtask at a time into whatever gap happens to be tightest.
   *
   * Each member still gets its own block, so it keeps its own calendar event
   * and its own row — they're merely adjacent.
   */
  /**
   * Is [start, end) usable for work with these constraints?
   * Used when fitting a fixed-offset sequence, where a stage's time is dictated
   * by the stage before it rather than chosen from a list of free slots.
   */
  function intervalFree(
    start: number, end: number,
    opts: { bufferMs: number; loc: TaskLocation; avoidAfterBreaks?: boolean },
  ): boolean {
    const { bufferMs, loc, avoidAfterBreaks } = opts
    if (start < nowMs) return false

    // Must sit inside some day's working window. Checked against every day
    // rather than the one containing `start`, because a window that runs past
    // midnight puts 00:30 inside the PREVIOUS day's hours.
    const insideHours = days.some(d => {
      const win = workWindow(d)
      return win !== null && start >= win[0] && end <= win[1]
    })
    if (!insideHours) return false

    const hits = (iv: Interval, pad: number) => start < iv[1] + pad && end > iv[0] - pad
    if (busyIntervals.some(iv => hits(iv, bufferMs))) return false
    if (placedBlocks.some(iv  => hits(iv, bufferMs))) return false
    if (breakIntervals.some(iv => hits(iv, bufferMs))) return false
    if (avoidAfterBreaks && cooldownIntervals.some(iv => hits(iv, 0))) return false
    if (tethers.some(t => locationsClash(t.loc, loc) && start < t.end && end > t.start)) return false
    return true
  }

  /**
   * Place a chain whose members are separated by fixed waits.
   *
   * Unlike a packed run, the offsets are not negotiable: if loading the washer
   * is at 10:00 then moving to the dryer is at 11:05, wherever that lands. So
   * rather than choosing a slot per stage, we look for a single start time that
   * makes *every* stage land on free time, and step forward until one does.
   *
   * The waits themselves are left free — that's the point, you can do other
   * things — while each active stage is reserved like any other block.
   */
  function placeFixedSequence(
    members: SchedulerTask[],
    opts: { bufferMs: number; loc: TaskLocation; avoidAfterBreaks: boolean; dueMs: number; notBeforeMs: number },
  ): boolean {
    const { bufferMs, loc, avoidAfterBreaks, dueMs, notBeforeMs } = opts

    // Offset of each stage from the start of the sequence
    const offsets: number[] = []
    let cursor = 0
    for (const m of members) {
      offsets.push(cursor)
      cursor += (m.duration_minutes + (m.gapAfterMinutes ?? 0)) * 60_000
    }
    const totalMs = cursor - (members[members.length - 1].gapAfterMinutes ?? 0) * 60_000

    const STEP = 15 * 60_000
    for (const { fS, fE } of freeSlots({ bufferMs, loc, avoidAfterBreaks, dueMs })) {
      // Only the FIRST stage has to start inside this slot; later stages are
      // checked wherever their offset puts them, which may be hours later.
      for (let t = Math.max(fS, nowMs, notBeforeMs); t + members[0].duration_minutes * 60_000 <= fE; t += STEP) {
        // The last stage has to land before the deadline, not the first.
        if (t + totalMs > dueMs) break
        const startAligned = Math.ceil(t / STEP) * STEP
        const ok = members.every((m, i) => intervalFree(
          startAligned + offsets[i],
          startAligned + offsets[i] + m.duration_minutes * 60_000,
          { bufferMs, loc, avoidAfterBreaks },
        ))
        if (!ok) continue

        members.forEach((m, i) => {
          const s = startAligned + offsets[i]
          const e = s + m.duration_minutes * 60_000
          const energy = slotEnergyLevel(s, energySchedule, tz)
          scheduled.push({
            taskId: m.id, taskTitle: m.title, taskPriority: m.priority,
            start: new Date(s), end: new Date(e),
            segmentIndex: i, totalSegments: members.length,
            energyMatch: ENERGY_RANK[energy] >= ENERGY_RANK[m.energy_required],
          })
          placedBlocks.push([s, e])       // each stage is reserved; the waits are not
          placedLoc.push({ start: s, end: e, loc })
        })

        // The sequence pins you for its whole length, waits included — that's
        // what makes it a laundry cycle rather than three unrelated errands.
        if (loc !== 'anywhere') {
          tethers.push({ start: startAligned, end: startAligned + totalMs, loc })
        }
        return true
      }
    }
    return false
  }

  function placeChain(members: SchedulerTask[]) {
    // The run is constrained by the strictest member: the widest buffer, the
    // earliest deadline, and any location that isn't 'anywhere'.
    const bufferMs = Math.max(...members.map(m => (m.bufferMinutes ?? config.bufferMinutes))) * 60_000
    const loc      = members.find(m => (m.location ?? 'anywhere') !== 'anywhere')?.location ?? 'anywhere'
    // A chain is bound by its strictest member, hour included.
    const dueMs    = Math.min(...members.map(m =>
      m.due_date ? deadlineMs(m.due_date, m.dueTimeMinutes, tz) : Infinity))
    const avoidAfterBreaks = members.some(m => m.avoidAfterBreaks)
    const notBeforeMs = Math.max(0, ...members.map(m => m.notBefore ? new Date(m.notBefore).getTime() : 0))
    const maxRunMs = config.maxSessionMinutes * 60_000

    // Fixed waits between stages make this a sequence, not a packing problem.
    if (members.some(m => (m.gapAfterMinutes ?? 0) > 0)) {
      if (!placeFixedSequence(members, { bufferMs, loc, avoidAfterBreaks, dueMs, notBeforeMs })) {
        unschedulable.push(...members)   // the whole cycle has to fit or none of it does
      }
      return
    }

    let remaining = [...members]

    while (remaining.length > 0) {
      let best: { start: number; count: number; energyMatch: boolean } | null = null

      for (const { fS, fE } of freeSlots({ bufferMs, loc, avoidAfterBreaks, dueMs })) {
        const start = Math.max(fS, nowMs, notBeforeMs)
        if (start >= fE) continue
        if (start >= dueMs) continue

        // How many consecutive members fit here, capped by the sitting length
        // and by the deadline — a run may not spill past it.
        const room = Math.min(fE - start, maxRunMs, dueMs - start)
        let used = 0, count = 0
        for (const m of remaining) {
          const need = m.duration_minutes * 60_000
          if (used + need > room) break
          used += need
          count++
        }
        if (count === 0) continue

        const energy      = slotEnergyLevel(start, energySchedule, tz)
        const energyMatch = remaining.slice(0, count)
          .every(m => ENERGY_RANK[energy] >= ENERGY_RANK[m.energy_required])

        // Most packed wins; an energy-matched slot breaks a tie, then earliest.
        if (!best
            || count > best.count
            || (count === best.count && energyMatch && !best.energyMatch)
            || (count === best.count && energyMatch === best.energyMatch && start < best.start)) {
          best = { start, count, energyMatch }
        }
      }

      if (!best) {
        // Chaining is a preference, not a requirement. A run needs contiguous
        // space, which is strictly harder to find than five separate gaps — so
        // rather than report the whole chain as unschedulable, fall back to
        // placing what's left independently. Better grouped-if-possible than
        // all-or-nothing.
        for (const m of remaining) placeSingle({ ...m, chainGroup: undefined })
        return
      }

      const run = remaining.slice(0, best.count)
      let cursor = best.start
      run.forEach((m, i) => {
        const end = cursor + m.duration_minutes * 60_000
        scheduled.push({
          taskId:        m.id,
          taskTitle:     m.title,
          taskPriority:  m.priority,
          start:         new Date(cursor),
          end:           new Date(end),
          segmentIndex:  i,
          totalSegments: run.length,
          energyMatch:   best!.energyMatch,
        })
        cursor = end
      })

      // One interval for the whole run, so the buffer wraps it rather than
      // appearing between its members.
      placedBlocks.push([best.start, cursor])
      placedLoc.push({ start: best.start, end: cursor, loc })

      remaining = remaining.slice(best.count)
    }
  }

  /** Place one task on its own — the ordinary path, and the chain's fallback. */
  function placeSingle(task: SchedulerTask) {
    // Per-task, not global: the buffer is transition time this task needs, so
    // a zero-buffer chore can sit flush against its neighbours. Blocks placed
    // later still apply their own buffer against it.
    const bufferMs     = (task.bufferMinutes ?? config.bufferMinutes) * 60_000
    const notBeforeMs  = task.notBefore ? new Date(task.notBefore).getTime() : 0
    const loc          = task.location ?? 'anywhere'
    const spanMs       = (task.spanMinutes ?? 0) * 60_000
    const totalSegs    = task.atomic ? 1 : Math.ceil(task.duration_minutes / config.maxSessionMinutes)
    const dueMs        = task.due_date ? deadlineMs(task.due_date, task.dueTimeMinutes, tz) : Infinity
    const blocksBefore = scheduled.length
    let remaining      = task.duration_minutes
    let allPlaced      = true

    for (let seg = 0; seg < totalSegs; seg++) {
      const segMins = task.atomic ? remaining : Math.min(remaining, config.maxSessionMinutes)
      const segMs   = segMins * 60_000
      remaining    -= segMins

      interface Candidate { start: number; end: number; excess: number; energyMatch: boolean; dayMs: number }
      const candidates: Candidate[] = []

      // Days already taken by a sibling session of the same habit
      const usedDays = task.spreadGroup ? groupDays.get(task.spreadGroup) : undefined

      for (const { dayMs, fS, fE } of freeSlots({ bufferMs, loc, avoidAfterBreaks: task.avoidAfterBreaks, dueMs })) {
        if (usedDays?.has(dayMs)) continue   // one session per day per habit

        const slotStart = Math.max(fS, nowMs, notBeforeMs)
        if (slotStart + segMs > fE) continue      // slot too small
        // The work must *finish* by the deadline, not merely begin before it.
        // While dueMs was always end-of-day this was the same test — a day
        // boundary sits well past working hours, so nothing could start inside
        // the day and end after it. A time of day (migration 0015) makes the
        // two differ: a 90-minute session starting at 9 against an 11am
        // deadline begins in time and finishes half an hour late.
        if (slotStart + segMs > dueMs) continue

        // If THIS task would pin you, nothing already booked inside its span
        // may need you somewhere else.
        if (spanMs > 0 && seg === 0) {
          const spanEnd = slotStart + spanMs
          if (placedLoc.some(p => locationsClash(p.loc, loc) && slotStart < p.end && spanEnd > p.start)) return
        }

        const energy      = slotEnergyLevel(slotStart, energySchedule, tz)
        const energyMatch = ENERGY_RANK[energy] >= ENERGY_RANK[task.energy_required]
        const excess      = (fE - fS) - segMs

        candidates.push({ start: slotStart, end: slotStart + segMs, excess, energyMatch, dayMs })
      }

      if (candidates.length === 0) {
        allPlaced = false
        break
      }

      // Prefer energy-matched; fall back to any. Within group: tightest fit, then earliest.
      const matched = candidates.filter(c => c.energyMatch)
      const pool    = matched.length > 0 ? matched : candidates

      if (task.spreadGroup) {
        // Spread across the week rather than filling from the front. Taking the
        // earliest free day each time packs a 2×/week habit into Mon+Tue and
        // leaves the weekend empty; picking the day furthest from the ones the
        // group already occupies distributes them over the whole horizon.
        const gapFromUsed = (dayMs: number) => {
          if (!usedDays || usedDays.size === 0) return Infinity   // first session: earliest wins
          let min = Infinity
          for (const u of usedDays) min = Math.min(min, Math.abs(dayMs - u))
          return min
        }
        pool.sort((a, b) => gapFromUsed(b.dayMs) - gapFromUsed(a.dayMs) || a.start - b.start)
      } else {
        pool.sort((a, b) => a.excess - b.excess || a.start - b.start)
      }

      const best = pool[0]

      if (task.spreadGroup) {
        const set = groupDays.get(task.spreadGroup) ?? new Set<number>()
        set.add(best.dayMs)
        groupDays.set(task.spreadGroup, set)
      }

      scheduled.push({
        taskId:        task.id,
        taskTitle:     task.title,
        taskPriority:  task.priority,
        start:         new Date(best.start),
        end:           new Date(best.end),
        segmentIndex:  seg,
        totalSegments: totalSegs,
        energyMatch:   best.energyMatch,
      })

      placedBlocks.push([best.start, best.end])
      placedLoc.push({ start: best.start, end: best.end, loc })
      // The span runs from the first segment — the cycle starts when you load it.
      if (spanMs > 0 && seg === 0) {
        tethers.push({ start: best.start, end: best.start + spanMs, loc })
      }
    }

    // Only "unschedulable" if zero segments of THIS candidate were placed.
    // Scoped to this candidate rather than the task id: habit sessions share an
    // id, so a taskId check would silently swallow every session after the
    // first — "gym 4×/week" would quietly become 2 with nothing reported.
    if (!allPlaced && scheduled.length === blocksBefore) {
      unschedulable.push(task)
    }
  }

  for (const task of sorted) {
    // A chain is placed in one go, from the position of its highest-ranked
    // member, so it competes for time like any other piece of work.
    if (task.chainGroup) {
      if (handledChains.has(task.chainGroup)) continue
      handledChains.add(task.chainGroup)
      placeChain(
        sorted
          .filter(t => t.chainGroup === task.chainGroup)
          .sort((a, b) => (a.chainIndex ?? 0) - (b.chainIndex ?? 0)),
      )
      continue
    }
    placeSingle(task)
  }

  // Chronological, not placement order. Blocks are appended as the greedy loop
  // places them, and spread groups deliberately jump around the horizon looking
  // for the widest gap — so placement order is not time order. Callers that
  // group by day off the raw array end up with day sections out of sequence
  // ("tomorrow, today, Sunday, Friday"). A schedule is inherently chronological,
  // so sort here rather than in each consumer.
  scheduled.sort((a, b) => a.start.getTime() - b.start.getTime())

  return { scheduled, unschedulable }
}
