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

export interface SchedulerConfig {
  maxSessionMinutes: number  // default 90
  bufferMinutes:     number  // default 15
  timezone:          string  // IANA tz, e.g. "America/Los_Angeles"
  startDateStr?:     string  // YYYY-MM-DD local date to start horizon from; defaults to today
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
  const bufferMs = config.bufferMinutes * 60_000
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

  const scheduled:     ProposedBlock[] = []
  const unschedulable: SchedulerTask[] = []

  // spreadGroup → day-midnight ms values already used by that group
  const groupDays = new Map<string, Set<number>>()

  for (const task of sorted) {
    const totalSegs    = task.atomic ? 1 : Math.ceil(task.duration_minutes / config.maxSessionMinutes)
    const dueMs        = task.due_date ? endOfDayMs(task.due_date, tz) : Infinity
    const blocksBefore = scheduled.length
    let remaining      = task.duration_minutes
    let allPlaced      = true

    for (let seg = 0; seg < totalSegs; seg++) {
      const segMins = task.atomic ? remaining : Math.min(remaining, config.maxSessionMinutes)
      const segMs   = segMins * 60_000
      remaining    -= segMins

      // All busy = GCal events + already-placed blocks, both buffered
      const allBusy: Interval[] = [
        ...busyIntervals.map(([s, e]): Interval => [s - bufferMs, e + bufferMs]),
        ...placedBlocks.map(([s, e]):  Interval  => [s - bufferMs, e + bufferMs]),
      ]

      interface Candidate { start: number; end: number; excess: number; energyMatch: boolean; dayMs: number }
      const candidates: Candidate[] = []

      // Days already taken by a sibling session of the same habit
      const usedDays = task.spreadGroup ? groupDays.get(task.spreadGroup) : undefined

      for (const dayMs of days) {
        if (dayMs > dueMs) break
        if (usedDays?.has(dayMs)) continue   // one session per day per habit

        const { dow } = localPartsAt(dayMs + 60_000, tz)  // +1min: avoid DST edge at midnight
        const wh  = workingHours.find(w => w.day_of_week === dow)
        if (!wh || !wh.enabled) continue

        // Working window = local midnight + hours offset (ms arithmetic, tz-safe)
        const workStartMs = dayMs + (wh.start_hour * 60 + wh.start_minute) * 60_000
        const workEndMs   = dayMs + (wh.end_hour   * 60 + wh.end_minute)   * 60_000

        // Day-scoped allBusy
        const dayBusy = allBusy.filter(([s, e]) => s < workEndMs && e > workStartMs)

        const free = subtractIntervals([[workStartMs, workEndMs]], dayBusy)

        for (const [fS, fE] of free) {
          const slotStart = Math.max(fS, nowMs)
          if (slotStart + segMs > fE) continue  // slot too small
          if (slotStart > dueMs) continue        // past deadline

          const energy      = slotEnergyLevel(slotStart, energySchedule, tz)
          const energyMatch = ENERGY_RANK[energy] >= ENERGY_RANK[task.energy_required]
          const excess      = (fE - fS) - segMs

          candidates.push({ start: slotStart, end: slotStart + segMs, excess, energyMatch, dayMs })
        }
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
    }

    // Only "unschedulable" if zero segments of THIS candidate were placed.
    // Scoped to this candidate rather than the task id: habit sessions share an
    // id, so a taskId check would silently swallow every session after the
    // first — "gym 4×/week" would quietly become 2 with nothing reported.
    if (!allPlaced && scheduled.length === blocksBefore) {
      unschedulable.push(task)
    }
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
