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
function localMidnight(dateStr: string, tz: string): number {
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
  const sorted = [...candidates].sort((a, b) => {
    const aSegs  = Math.ceil(a.duration_minutes / config.maxSessionMinutes)
    const bSegs  = Math.ceil(b.duration_minutes / config.maxSessionMinutes)
    const aScore = a.urgency_score + (aSegs > 1 ? 8 : 0)
    const bScore = b.urgency_score + (bSegs > 1 ? 8 : 0)
    return bScore - aScore
  })

  const scheduled:     ProposedBlock[] = []
  const unschedulable: SchedulerTask[] = []

  for (const task of sorted) {
    const totalSegs    = Math.ceil(task.duration_minutes / config.maxSessionMinutes)
    const dueMs        = task.due_date ? new Date(task.due_date).getTime() : Infinity
    let remaining      = task.duration_minutes
    let allPlaced      = true

    for (let seg = 0; seg < totalSegs; seg++) {
      const segMins = Math.min(remaining, config.maxSessionMinutes)
      const segMs   = segMins * 60_000
      remaining    -= segMins

      // All busy = GCal events + already-placed blocks, both buffered
      const allBusy: Interval[] = [
        ...busyIntervals.map(([s, e]): Interval => [s - bufferMs, e + bufferMs]),
        ...placedBlocks.map(([s, e]):  Interval  => [s - bufferMs, e + bufferMs]),
      ]

      interface Candidate { start: number; end: number; excess: number; energyMatch: boolean }
      const candidates: Candidate[] = []

      for (const dayMs of days) {
        if (dayMs > dueMs) break

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

          candidates.push({ start: slotStart, end: slotStart + segMs, excess, energyMatch })
        }
      }

      if (candidates.length === 0) {
        allPlaced = false
        break
      }

      // Prefer energy-matched; fall back to any. Within group: tightest fit, then earliest.
      const matched = candidates.filter(c => c.energyMatch)
      const pool    = matched.length > 0 ? matched : candidates
      pool.sort((a, b) => a.excess - b.excess || a.start - b.start)
      const best = pool[0]

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

    // Task is only "unschedulable" if zero segments were placed
    if (!allPlaced && !scheduled.some(b => b.taskId === task.id)) {
      unschedulable.push(task)
    }
  }

  return { scheduled, unschedulable }
}

// ── Attack list for "Plan my day" ─────────────────────────────────────────────

export interface AttackItem {
  taskId:           string
  taskTitle:        string
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

  // Interleave: scheduled tasks stay at their times, unscheduled fill between
  const merged: AttackItem[] = []
  let ui = 0
  for (const s of scheduled) {
    // Add any unscheduled tasks that would fit before this scheduled block
    while (ui < unscheduled.length) {
      merged.push(unscheduled[ui++])
    }
    merged.push(s)
  }
  // Remaining unscheduled
  while (ui < unscheduled.length) merged.push(unscheduled[ui++])

  return merged.map((item, i) => ({ ...item, rank: i + 1 }))
}
