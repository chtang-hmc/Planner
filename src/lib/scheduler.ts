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

function slotEnergyLevel(
  slotStart: Date,
  energySchedule: EnergyScheduleEntry[],
): EnergyLevel {
  const dow   = slotStart.getDay()
  const hour  = slotStart.getHours()
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

  // Build day boundaries for the horizon
  const days: Date[] = []
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    d.setHours(0, 0, 0, 0)
    days.push(d)
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

      for (const day of days) {
        if (day.getTime() > dueMs) break

        const dow = day.getDay()
        const wh  = workingHours.find(w => w.day_of_week === dow)
        if (!wh || !wh.enabled) continue

        const workStart = new Date(day)
        workStart.setHours(wh.start_hour, wh.start_minute, 0, 0)
        const workEnd = new Date(day)
        workEnd.setHours(wh.end_hour, wh.end_minute, 0, 0)

        // Day-scoped allBusy
        const dayBusy = allBusy.filter(([s, e]) =>
          s < workEnd.getTime() && e > workStart.getTime()
        )

        const free = subtractIntervals(
          [[workStart.getTime(), workEnd.getTime()]],
          dayBusy,
        )

        for (const [fS, fE] of free) {
          const slotStart = Math.max(fS, nowMs)
          if (slotStart + segMs > fE) continue  // slot too small
          if (slotStart > dueMs) continue        // past deadline

          const energy      = slotEnergyLevel(new Date(slotStart), energySchedule)
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
): AttackItem[] {
  const now  = new Date()
  const currentEnergy = slotEnergyLevel(now, energySchedule)

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
