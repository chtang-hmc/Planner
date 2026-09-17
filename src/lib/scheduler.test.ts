import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  runScheduler, localMidnight, blockLabel,
  type SchedulerTask, type SchedulerConfig, type WorkingHours,
  type EnergyScheduleEntry, type ProposedBlock,
} from './scheduler'

/**
 * The scheduler is the product: everything else is a way of feeding it or
 * looking at what it decided. It is also the largest piece of untested logic in
 * the app, and most of its rules exist because a real week went wrong — gym
 * booked twice in a day, a habit scheduled straight after lunch, a reading
 * chain scattered across four sittings.
 *
 * These are behaviour tests. They assert the rule a user would describe, not
 * the exact minute a block lands on, so the placement heuristics can change
 * without rewriting the suite.
 */

const TZ = 'America/Los_Angeles'
const MON = '2026-09-14'   // a Monday

/** Nine-to-five every day, so a test only opts into constraints it cares about. */
const NINE_TO_FIVE: WorkingHours[] = Array.from({ length: 7 }, (_, d) => ({
  day_of_week: d, start_hour: 9, start_minute: 0, end_hour: 17, end_minute: 0, enabled: true,
}))

/** Flat medium energy, so energy matching never silently drives placement. */
const FLAT_ENERGY: EnergyScheduleEntry[] = []

function config(over: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    maxSessionMinutes: 90, bufferMinutes: 15, timezone: TZ, startDateStr: MON,
    ...over,
  }
}

let nextId = 0
function task(over: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: `t${nextId++}`, title: `Task ${nextId}`,
    priority: 2, urgency_score: 50, energy_required: 'medium',
    duration_minutes: 60, due_date: null,
    ...over,
  }
}

/** Local calendar day a block starts on, in the scheduler's timezone. */
function dayOf(b: ProposedBlock): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(b.start)
}

/** Local hour a block starts at. */
function hourOf(b: ProposedBlock): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', hour12: false,
  }).format(b.start)) % 24
}

function run(tasks: SchedulerTask[], opts: {
  workingHours?: WorkingHours[]
  busy?: [number, number][]
  horizonDays?: number
  config?: Partial<SchedulerConfig>
} = {}) {
  return runScheduler(
    tasks,
    opts.workingHours ?? NINE_TO_FIVE,
    FLAT_ENERGY,
    opts.busy ?? [],
    opts.horizonDays ?? 7,
    config(opts.config),
  )
}

// The scheduler refuses to place anything in the past, so the clock sits just
// before the horizon starts.
beforeEach(() => {
  nextId = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date(localMidnight(MON, TZ)))
})
afterEach(() => { vi.useRealTimers() })

describe('placement basics', () => {
  it('places a task inside working hours', () => {
    const { scheduled } = run([task({ duration_minutes: 60 })])
    expect(scheduled).toHaveLength(1)
    expect(hourOf(scheduled[0])).toBeGreaterThanOrEqual(9)
    expect(hourOf(scheduled[0])).toBeLessThan(17)
  })

  it('never overlaps two blocks', () => {
    const { scheduled } = run(Array.from({ length: 6 }, () => task({ duration_minutes: 60 })))
    const sorted = [...scheduled].sort((a, b) => a.start.getTime() - b.start.getTime())
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].end.getTime())
    }
  })

  it('silently skips a task with no duration', () => {
    // Neither placed nor reported. Callers filter these out before they get
    // here (`if (!duration) continue` in buildCandidates), so nothing reaches
    // the scheduler without an estimate — pinned so that stays a deliberate
    // choice rather than something that quietly starts mattering.
    const { scheduled, unschedulable } = run([task({ duration_minutes: 0 })])
    expect(scheduled).toHaveLength(0)
    expect(unschedulable).toHaveLength(0)
  })

  it('skips a day that is not a working day', () => {
    const weekdaysOnly = NINE_TO_FIVE.map(w => ({ ...w, enabled: w.day_of_week >= 1 && w.day_of_week <= 5 }))
    const { scheduled } = run(
      Array.from({ length: 12 }, () => task({ duration_minutes: 120 })),
      { workingHours: weekdaysOnly },
    )
    for (const b of scheduled) {
      const dow = b.start.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
      expect(['Sat', 'Sun']).not.toContain(dow)
    }
  })

  it('works around busy calendar intervals', () => {
    // Block out the whole of Monday.
    const dayStart = localMidnight(MON, TZ)
    const busy: [number, number][] = [[dayStart, dayStart + 24 * 3_600_000]]
    const { scheduled } = run([task({ duration_minutes: 60 })], { busy })
    expect(scheduled).toHaveLength(1)
    expect(dayOf(scheduled[0])).not.toBe(MON)
  })
})

describe('urgency ordering', () => {
  it('books the more urgent task earlier', () => {
    // One working day, room for roughly two blocks, three tasks wanting it.
    const oneDay = NINE_TO_FIVE.map(w => ({ ...w, enabled: w.day_of_week === 1 }))
    const { scheduled } = run(
      [
        task({ title: 'low',  urgency_score: 10, duration_minutes: 90 }),
        task({ title: 'high', urgency_score: 95, duration_minutes: 90 }),
        task({ title: 'mid',  urgency_score: 50, duration_minutes: 90 }),
      ],
      { workingHours: oneDay },
    )
    const byTitle = Object.fromEntries(scheduled.map(b => [b.taskTitle, b.start.getTime()]))
    expect(byTitle['high']).toBeLessThan(byTitle['mid'])
    expect(byTitle['mid']).toBeLessThan(byTitle['low'])
  })
})

describe('session length', () => {
  it('splits long work into segments no longer than the session cap', () => {
    const { scheduled } = run([task({ duration_minutes: 240 })], { config: { maxSessionMinutes: 90 } })
    expect(scheduled.length).toBeGreaterThan(1)
    for (const b of scheduled) {
      expect(b.end.getTime() - b.start.getTime()).toBeLessThanOrEqual(90 * 60_000)
    }
    const total = scheduled.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()), 0)
    expect(total).toBe(240 * 60_000)
  })

  it('keeps atomic work in one block however long it is', () => {
    // A 120-minute gym session under a 90-minute cap used to become two blocks,
    // so a 2×/week target quietly produced four scheduled sessions.
    const { scheduled } = run(
      [task({ duration_minutes: 120, atomic: true })],
      { config: { maxSessionMinutes: 90 } },
    )
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].end.getTime() - scheduled[0].start.getTime()).toBe(120 * 60_000)
  })
})

describe('spread groups', () => {
  it('puts sessions of one habit on different days', () => {
    const sessions = Array.from({ length: 4 }, () =>
      task({ title: 'Gym', duration_minutes: 60, spreadGroup: 'gym', atomic: true }))
    const { scheduled } = run(sessions)
    const days = scheduled.map(dayOf)
    expect(new Set(days).size).toBe(days.length)
  })
})

describe('exclusive groups', () => {
  it('keeps two habits in one group off the same day', () => {
    // Exclusivity has no field of its own: buildHabitCandidates gives grouped
    // habits a *shared* spreadGroup (`group:cardio`) and the spread rule does
    // the rest. Worth pinning, because the mechanism is not obvious from the
    // scheduler alone — and "gym and run on the same day" was a real report.
    const gym = Array.from({ length: 2 }, () =>
      task({ title: 'Gym', duration_minutes: 60, spreadGroup: 'group:cardio', atomic: true }))
    const run_ = Array.from({ length: 2 }, () =>
      task({ title: 'Run', duration_minutes: 60, spreadGroup: 'group:cardio', atomic: true }))
    const { scheduled } = run([...gym, ...run_])

    const byDay = new Map<string, Set<string>>()
    for (const b of scheduled) {
      const d = dayOf(b)
      byDay.set(d, (byDay.get(d) ?? new Set()).add(b.taskTitle))
    }
    for (const titles of byDay.values()) {
      expect(titles.has('Gym') && titles.has('Run')).toBe(false)
    }
  })
})

describe('not before', () => {
  it('will not place work earlier than its start date', () => {
    const wed = '2026-09-16'
    const { scheduled } = run([task({
      duration_minutes: 60,
      notBefore: new Date(localMidnight(wed, TZ)).toISOString(),
    })])
    expect(scheduled).toHaveLength(1)
    expect(dayOf(scheduled[0]) >= wed).toBe(true)
  })
})

describe('per-task buffer', () => {
  it('lets a zero-buffer chore into a gap the global buffer would reject', () => {
    // One hour of working time, already holding a 45-minute block: 15 minutes
    // are left, which a 5-minute task can only use with no buffer.
    const tight = NINE_TO_FIVE.map(w => ({
      ...w, enabled: w.day_of_week === 1, start_hour: 9, end_hour: 10,
    }))
    const filler = task({ title: 'filler', duration_minutes: 45, urgency_score: 99 })
    const chore  = task({ title: 'chore',  duration_minutes: 5, urgency_score: 1, bufferMinutes: 0 })

    const { scheduled } = run([filler, chore], { workingHours: tight, horizonDays: 1 })
    expect(scheduled.map(b => b.taskTitle)).toContain('chore')
  })
})

describe('chains', () => {
  it('runs subtasks of one parent back to back', () => {
    const chain = [0, 1, 2].map(i =>
      task({ title: `part ${i}`, duration_minutes: 30, chainGroup: 'readings', chainIndex: i }))
    const { scheduled } = run(chain)

    expect(scheduled).toHaveLength(3)
    const sorted = [...scheduled].sort((a, b) => a.start.getTime() - b.start.getTime())
    // Same sitting, no gap between members.
    expect(new Set(sorted.map(dayOf)).size).toBe(1)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start.getTime()).toBe(sorted[i - 1].end.getTime())
    }
  })

  it('keeps chain members in their running order', () => {
    // Laundry: load the washer, move it to the dryer, then make the bed. Taking
    // members off the urgency-sorted list once put these in the wrong order.
    const chain = [
      task({ title: 'washer',     duration_minutes: 5,  chainGroup: 'laundry', chainIndex: 0 }),
      task({ title: 'dryer',      duration_minutes: 5,  chainGroup: 'laundry', chainIndex: 1 }),
      task({ title: 'make bed',   duration_minutes: 15, chainGroup: 'laundry', chainIndex: 2 }),
    ]
    const { scheduled } = run(chain)
    const order = [...scheduled]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map(b => b.taskTitle)
    expect(order).toEqual(['washer', 'dryer', 'make bed'])
  })

  it('honours a fixed wait between stages', () => {
    const chain = [
      task({ title: 'load',  duration_minutes: 5, chainGroup: 'laundry', chainIndex: 0, gapAfterMinutes: 60 }),
      task({ title: 'unload', duration_minutes: 5, chainGroup: 'laundry', chainIndex: 1 }),
    ]
    const { scheduled } = run(chain)
    const sorted = [...scheduled].sort((a, b) => a.start.getTime() - b.start.getTime())
    expect(sorted).toHaveLength(2)
    expect(sorted[1].start.getTime() - sorted[0].end.getTime()).toBe(60 * 60_000)
  })

  it('falls back to placing members singly when the run will not fit anywhere', () => {
    // Four 60-minute members cannot sit together in a 2-hour day, but they can
    // still be done separately — the alternative is scheduling none of them.
    const short = NINE_TO_FIVE.map(w => ({ ...w, start_hour: 9, end_hour: 11 }))
    const chain = [0, 1, 2, 3].map(i =>
      task({ title: `part ${i}`, duration_minutes: 60, chainGroup: 'big', chainIndex: i }))
    const { scheduled } = run(chain, { workingHours: short })
    expect(scheduled.length).toBeGreaterThan(0)
  })
})

describe('results are chronological', () => {
  it('returns blocks in time order whatever order they were placed in', () => {
    // Spread and dispersion make placement order non-chronological, which once
    // showed the review as "tomorrow, today, Sunday, Friday".
    const tasks = [
      ...Array.from({ length: 3 }, () => task({ spreadGroup: 'a', atomic: true, duration_minutes: 60 })),
      task({ urgency_score: 99, duration_minutes: 30 }),
      task({ urgency_score: 5,  duration_minutes: 30 }),
    ]
    const { scheduled } = run(tasks)
    for (let i = 1; i < scheduled.length; i++) {
      expect(scheduled[i].start.getTime()).toBeGreaterThanOrEqual(scheduled[i - 1].start.getTime())
    }
  })
})

describe('unschedulable reporting', () => {
  it('reports each candidate that could not be placed, not one per task', () => {
    // Four habit sessions with room for two used to report zero failures,
    // because the bookkeeping was keyed on task id rather than per candidate.
    const oneShortDay = NINE_TO_FIVE.map(w => ({
      ...w, enabled: w.day_of_week === 1, start_hour: 9, end_hour: 11,
    }))
    const sessions = Array.from({ length: 4 }, () =>
      task({ title: 'Gym', duration_minutes: 60, spreadGroup: 'gym', atomic: true }))

    const { scheduled, unschedulable } = run(sessions, { workingHours: oneShortDay, horizonDays: 1 })
    expect(scheduled.length + unschedulable.length).toBe(4)
    expect(unschedulable.length).toBeGreaterThan(0)
  })
})

describe('blockLabel', () => {
  it('prefixes a subtask with its parent', () => {
    expect(blockLabel('Dahl', 'Philosophy Readings')).toBe('Philosophy Readings - Dahl')
  })

  it('leaves a top-level task alone', () => {
    expect(blockLabel('Wash Sheets', null)).toBe('Wash Sheets')
    expect(blockLabel('Wash Sheets')).toBe('Wash Sheets')
  })
})

describe('a due time tightens the deadline within the day', () => {
  /**
   * `tasks.due_time_minutes` (migration 0015). "Due at 11am" means finished by
   * eleven — so the afternoon of the due day is no longer on time, even though
   * the *day* still is.
   *
   * Deliberately a deadline and not a pin: the work may be placed any time
   * before, which is usually where it belongs. Only the late end moves.
   */
  const ELEVEN_AM = 11 * 60
  const elevenMs  = () => localMidnight(MON, TZ) + ELEVEN_AM * 60_000

  it('keeps work before the hour, not merely on the day', () => {
    const { scheduled } = run([task({
      duration_minutes: 60, due_date: `${MON}T00:00:00Z`, dueTimeMinutes: ELEVEN_AM,
    })])
    expect(scheduled).toHaveLength(1)
    expect(dayOf(scheduled[0])).toBe(MON)
    expect(scheduled[0].end.getTime()).toBeLessThanOrEqual(elevenMs())
  })

  it('is what moved the deadline — the same task without an hour may run later', () => {
    const withHour = run([task({
      duration_minutes: 60, due_date: `${MON}T00:00:00Z`, dueTimeMinutes: ELEVEN_AM,
    })]).scheduled
    const without = run([task({
      duration_minutes: 60, due_date: `${MON}T00:00:00Z`,
    })]).scheduled
    expect(withHour[0].end.getTime()).toBeLessThanOrEqual(without[0].end.getTime())
  })

  it('does not pin the start to the hour', () => {
    // A 5pm deadline must not push the work to 5pm; earlier is still fine.
    const { scheduled } = run([task({
      duration_minutes: 60, due_date: `${MON}T00:00:00Z`, dueTimeMinutes: 17 * 60,
    })])
    expect(scheduled).toHaveLength(1)
    expect(hourOf(scheduled[0])).toBeLessThan(17)
  })

  it('reports work that cannot finish before the hour instead of placing it late', () => {
    // Nine-to-five, a two-hour task due by 10am, one day of horizon: one hour
    // of usable time, so it does not fit.
    const { scheduled, unschedulable } = run(
      [task({ duration_minutes: 120, due_date: `${MON}T00:00:00Z`, dueTimeMinutes: 10 * 60 })],
      { horizonDays: 1 },
    )
    expect(scheduled).toHaveLength(0)
    expect(unschedulable.length).toBeGreaterThan(0)
  })

  it('binds a chain by its strictest member', () => {
    // Two steps of one parent; only the second carries an hour. The run as a
    // whole has to respect it.
    const { scheduled } = run([
      task({ id: 'a', duration_minutes: 30, due_date: `${MON}T00:00:00Z`, chainGroup: 'p', chainIndex: 0 }),
      task({ id: 'b', duration_minutes: 30, due_date: `${MON}T00:00:00Z`, chainGroup: 'p', chainIndex: 1,
             dueTimeMinutes: ELEVEN_AM }),
    ])
    expect(scheduled.length).toBeGreaterThan(0)
    for (const b of scheduled) {
      expect(b.end.getTime()).toBeLessThanOrEqual(elevenMs())
    }
  })
})
