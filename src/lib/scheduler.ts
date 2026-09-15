// ─────────────────────────────────────────────────────────────────────────────
// Scheduling algorithm — pure TypeScript, no DB/API calls.
// All I/O is handled by the server action (src/app/actions/scheduling.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { EnergyLevel } from '@/types'

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
function endOfDayMs(dueISO: string, tz: string): number {
  // Extract the UTC date string from the stored ISO (e.g. "2026-09-15")
  const dateStr = dueISO.slice(0, 10)
  // Midnight of the next local day = end of the due day
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  const nextDateStr = d.toISOString().slice(0, 10)
  return localMidnight(nextDateStr, tz)
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

function slotEnergyLevel(
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
function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
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
  const maxMs    = config.maxSessionMinutes * 60_000
  const nowMs    = Date.now()
  const tz       = config.timezone

  // Build day boundaries for the horizon (as UTC ms of local midnight in user's tz)
  const startStr = config.startDateStr ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const days: number[] = []   // each value = UTC ms of local midnight for that day
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(startStr)
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    days.push(localMidnight(dateStr, tz))
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
    for (const br of config.breaks ?? []) {
      const winStart = dayMs + (br.startHour * 60 + br.startMinute) * 60_000
      const winEnd   = dayMs + (br.endHour   * 60 + br.endMinute)   * 60_000
      const needMs   = br.durationMinutes * 60_000
      if (winEnd - winStart < needMs) continue

      // Only real calendar events compete here; nothing is placed yet.
      const free = subtractIntervals(
        [[winStart, winEnd]],
        busyIntervals.filter(([s, e]) => s < winEnd && e > winStart),
      )
      const slot = free.find(([fS, fE]) => fE - fS >= needMs)
      if (!slot) continue          // window fully booked that day — skip it

      const start = slot[0]
      const end   = start + needMs
      breakIntervals.push([start, end])
      if (br.cooldownMinutes > 0) {
        cooldownIntervals.push([end, end + br.cooldownMinutes * 60_000])
      }
    }
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

      const { dow } = localPartsAt(dayMs + 60_000, tz)  // +1min: avoid DST edge at midnight
      const wh = workingHours.find(w => w.day_of_week === dow)
      if (!wh || !wh.enabled) continue

      // Working window = local midnight + hours offset (ms arithmetic, tz-safe)
      const workStartMs = dayMs + (wh.start_hour * 60 + wh.start_minute) * 60_000
      const workEndMs   = dayMs + (wh.end_hour   * 60 + wh.end_minute)   * 60_000

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
  function placeChain(members: SchedulerTask[]) {
    // The run is constrained by the strictest member: the widest buffer, the
    // earliest deadline, and any location that isn't 'anywhere'.
    const bufferMs = Math.max(...members.map(m => (m.bufferMinutes ?? config.bufferMinutes))) * 60_000
    const loc      = members.find(m => (m.location ?? 'anywhere') !== 'anywhere')?.location ?? 'anywhere'
    const dueMs    = Math.min(...members.map(m => m.due_date ? endOfDayMs(m.due_date, tz) : Infinity))
    const avoidAfterBreaks = members.some(m => m.avoidAfterBreaks)
    const maxRunMs = config.maxSessionMinutes * 60_000

    let remaining = [...members]

    while (remaining.length > 0) {
      let best: { start: number; count: number; energyMatch: boolean } | null = null

      for (const { fS, fE } of freeSlots({ bufferMs, loc, avoidAfterBreaks, dueMs })) {
        const start = Math.max(fS, nowMs)
        if (start > dueMs) continue

        // How many consecutive members fit here, capped by the sitting length?
        const room = Math.min(fE - start, maxRunMs)
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
    const loc          = task.location ?? 'anywhere'
    const spanMs       = (task.spanMinutes ?? 0) * 60_000
    const totalSegs    = task.atomic ? 1 : Math.ceil(task.duration_minutes / config.maxSessionMinutes)
    const dueMs        = task.due_date ? endOfDayMs(task.due_date, tz) : Infinity
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

        const slotStart = Math.max(fS, nowMs)
        if (slotStart + segMs > fE) continue  // slot too small
        if (slotStart > dueMs) continue        // past deadline

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
      placeChain(sorted.filter(t => t.chainGroup === task.chainGroup))
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

// ── Attack list for "Plan my day" ─────────────────────────────────────────────

export interface AttackItem {
  taskId:           string
  taskTitle:        string
  priority:         number
  urgencyScore:     number
  durationMinutes:  number | null
  energyRequired:   EnergyLevel
  scheduledStart:   Date | null
  isScheduled:      boolean
  energyMatchNow:   boolean   // does it match your current time-of-day energy?
  rank:             number
}

/**
 * Build a ranked attack list for today.
 * Scheduled tasks are placed at their scheduled times; unscheduled tasks are
 * inserted where they best fit energetically.
 */
export function buildAttackList(
  todaysTasks:    SchedulerTask[],
  scheduledToday: Array<{ taskId: string; start: Date; end: Date }>,
  energySchedule: EnergyScheduleEntry[],
  timezone:       string,
): AttackItem[] {
  const nowMs = Date.now()
  const currentEnergy = slotEnergyLevel(nowMs, energySchedule, timezone)

  const items: AttackItem[] = todaysTasks.map(task => {
    const block       = scheduledToday.find(b => b.taskId === task.id)
    const isScheduled = !!block
    const energyMatchNow = ENERGY_RANK[currentEnergy] >= ENERGY_RANK[task.energy_required]

    return {
      taskId:         task.id,
      taskTitle:      task.title,
      priority:       task.priority,
      urgencyScore:   task.urgency_score,
      durationMinutes: task.duration_minutes,
      energyRequired: task.energy_required,
      scheduledStart: block?.start ?? null,
      isScheduled,
      energyMatchNow,
      rank: 0,  // filled below
    }
  })

  // Sort: scheduled tasks by their time; unscheduled by urgency + energy match
  const scheduled   = items.filter(i => i.isScheduled).sort((a, b) =>
    (a.scheduledStart?.getTime() ?? 0) - (b.scheduledStart?.getTime() ?? 0)
  )
  const unscheduled = items.filter(i => !i.isScheduled).sort((a, b) => {
    // Energy match now is a strong signal for what to do right now
    const aScore = a.urgencyScore + (a.energyMatchNow ? 10 : 0)
    const bScore = b.urgencyScore + (b.energyMatchNow ? 10 : 0)
    return bScore - aScore
  })

  // Interleave: scheduled tasks stay in time order; an unscheduled task appears
  // before a scheduled block only when its urgency+energy score exceeds that block's.
  // This preserves calendar commitments while surfacing high-urgency free work.
  const merged: AttackItem[] = []
  let ui = 0
  for (const s of scheduled) {
    const sScore = s.urgencyScore + (s.energyMatchNow ? 10 : 0)
    while (ui < unscheduled.length) {
      const uScore = unscheduled[ui].urgencyScore + (unscheduled[ui].energyMatchNow ? 10 : 0)
      if (uScore > sScore) {
        merged.push(unscheduled[ui++])
      } else {
        break
      }
    }
    merged.push(s)
  }
  // Remaining unscheduled go after all scheduled blocks
  while (ui < unscheduled.length) merged.push(unscheduled[ui++])

  return merged.map((item, i) => ({ ...item, rank: i + 1 }))
}
