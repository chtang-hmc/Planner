import { describe, it, expect } from 'vitest'
import { freeGaps, localMidnight, type WorkingHours, type BreakWindow } from '@/lib/scheduler'
import {
  buildHome, rankForGap, rightNowFrom, resolveAgainstParent, edgeBuffer, collapseChains, formatClock,
  type HomeTask, type HomeEvent,
} from '@/lib/home'

const TZ  = 'America/Los_Angeles'
const DAY = '2026-09-16'          // a Wednesday

/** UTC ms for a wall-clock time on DAY. */
function at(hhmm: string, dayStr = DAY): number {
  const [h, m] = hhmm.split(':').map(Number)
  return localMidnight(dayStr, TZ) + (h * 60 + m) * 60_000
}

/** Working hours: every day 09:00–22:00 unless overridden. */
function hours(overrides: Partial<WorkingHours> = {}): WorkingHours[] {
  return Array.from({ length: 7 }, (_, d) => ({
    day_of_week: d, start_hour: 9, start_minute: 0,
    end_hour: 22, end_minute: 0, enabled: true, ...overrides,
  }))
}

function event(title: string, from: string, to: string): HomeEvent {
  return { id: title, title, startMs: at(from), endMs: at(to) }
}

function task(over: Partial<HomeTask> & { id: string }): HomeTask {
  return {
    title: over.id, parentId: null, parentTitle: null, type: 'task',
    priority: 2, urgencyScore: 50, energyRequired: 'medium', minutes: 30,
    dueDay: null, startDay: null, location: 'anywhere', bufferMinutes: 0,
    scheduledStartISO: null, chainIndex: 0, ...over,
  }
}

const BASE = {
  todayStr: DAY, tz: TZ, energySchedule: [], bufferMinutes: 15,
}

// ─────────────────────────────────────────────────────────────────────────────

describe('freeGaps', () => {
  it('is the whole working window on an empty day', () => {
    const gaps = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(), busy: [] })
    expect(gaps).toEqual([[at('9:00'), at('22:00')]])
  })

  it('returns nothing when the day is switched off', () => {
    const wh = hours().map(w => w.day_of_week === 3 ? { ...w, enabled: false } : w)
    expect(freeGaps({ dayStr: DAY, tz: TZ, workingHours: wh, busy: [] })).toEqual([])
  })

  /**
   * The trap the spec names: an event nested inside a longer one must not end
   * the busy stretch early. Fall Fest 11:00–13:15 runs under ENTR 179A
   * 11:00–12:15, and you are not free at 12:15.
   */
  it('does not manufacture free time between overlapping events', () => {
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [
        [at('11:00'), at('13:15')],   // Fall Fest
        [at('11:00'), at('12:15')],   // ENTR 179A, nested inside it
      ],
    })
    expect(gaps).toEqual([
      [at('9:00'),  at('11:00')],
      [at('13:15'), at('22:00')],
    ])
  })

  it('works from the running maximum end, not the previous event', () => {
    // Staggered overlap: 11–13 then 12–14. Free time resumes at 14:00.
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [[at('11:00'), at('13:00')], [at('12:00'), at('14:00')]],
    })
    expect(gaps[1][0]).toBe(at('14:00'))
  })

  it('leaves no zero-length gap between back-to-back events', () => {
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [[at('11:00'), at('12:00')], [at('12:00'), at('13:00')]],
    })
    expect(gaps).toEqual([[at('9:00'), at('11:00')], [at('13:00'), at('22:00')]])
  })

  it('carves out a break', () => {
    const lunch: BreakWindow = {
      label: 'Lunch', durationMinutes: 30,
      startHour: 12, startMinute: 0, endHour: 14, endMinute: 0, cooldownMinutes: 0,
    }
    const gaps = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(), busy: [], breaks: [lunch] })
    // Takes the earliest slot in its window.
    expect(gaps).toEqual([[at('9:00'), at('12:00')], [at('12:30'), at('22:00')]])
  })

  it('drops gaps below minMinutes', () => {
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [[at('9:10'), at('12:00')]],
      minMinutes: 15,
    })
    expect(gaps).toEqual([[at('12:00'), at('22:00')]])   // the 10-minute sliver is gone
  })
})

describe('a subtask is ranked on its parent', () => {
  it('takes the parent urgency, priority and deadline', () => {
    const sub    = task({ id: 'Rosner', parentId: 'pp', priority: 1, urgencyScore: 10 })
    const parent = task({ id: 'pp', title: 'Public Policy readings', priority: 3, urgencyScore: 80, dueDay: DAY })

    const resolved = resolveAgainstParent(sub, parent)
    expect(resolved.urgencyScore).toBe(80)
    expect(resolved.priority).toBe(3)
    expect(resolved.dueDay).toBe(DAY)
    expect(resolved.parentTitle).toBe('Public Policy readings')
  })

  it('keeps its own location when it has one', () => {
    const sub = task({ id: 's', parentId: 'p', location: 'away' })
    const p   = task({ id: 'p', location: 'home' })
    expect(resolveAgainstParent(sub, p).location).toBe('away')
  })

  it('ranks above unimportant dated work once resolved', () => {
    const errand = task({ id: 'errand', urgencyScore: 30, dueDay: DAY })
    const raw    = task({ id: 'Rosner', parentId: 'pp', priority: 1, urgencyScore: 10 })
    const parent = task({ id: 'pp', title: 'Readings', priority: 3, urgencyScore: 80, dueDay: DAY })

    const unresolved = rankForGap([errand, raw], [at('13:00'), at('15:00')], BASE)
    expect(unresolved[0].taskIds).toEqual(['errand'])

    const resolved = rankForGap([errand, resolveAgainstParent(raw, parent)], [at('13:00'), at('15:00')], BASE)
    expect(resolved[0].taskIds).toEqual(['Rosner'])
  })
})

describe('what fits a gap', () => {
  const gap90: [number, number] = [at('13:15'), at('14:45')]   // 1h 30m

  it('needs room for a buffer at each end', () => {
    // 60m of work + 15m either side is exactly 90.
    expect(rankForGap([task({ id: 'fits', minutes: 60, bufferMinutes: null })], gap90, BASE)).toHaveLength(1)
    expect(rankForGap([task({ id: 'over', minutes: 61, bufferMinutes: null })], gap90, BASE)).toHaveLength(0)
  })

  it('keeps an away errand out of the half-hour between two classes', () => {
    const errand = task({ id: 'post office', minutes: 20, location: 'away', bufferMinutes: null })
    const short: [number, number] = [at('14:15'), at('14:45')]
    expect(rankForGap([errand], short, BASE)).toHaveLength(0)
    expect(rankForGap([errand], gap90, BASE)).toHaveLength(1)
  })

  it('charges an away task the trip out and back', () => {
    expect(edgeBuffer({ location: 'away',     bufferMinutes: null }, 15)).toBe(30)
    expect(edgeBuffer({ location: 'anywhere', bufferMinutes: null }, 15)).toBe(15)
    expect(edgeBuffer({ location: 'away',     bufferMinutes: 0    }, 15)).toBe(0)
  })

  it('excludes what cannot be picked up', () => {
    const rows = [
      task({ id: 'unestimated', minutes: null }),
      task({ id: 'someday', type: 'someday' }),
      task({ id: 'habit', type: 'habit' }),
      task({ id: 'booked', scheduledStartISO: '2026-09-16T20:00:00Z' }),
      task({ id: 'not yet', startDay: '2026-09-20' }),
      task({ id: 'ok' }),
    ]
    expect(rankForGap(rows, gap90, BASE, 10).map(s => s.title)).toEqual(['ok'])
  })

  it('offers a chain as one run of as many steps as fit', () => {
    const chain = [0, 1, 2].map(i => task({
      id: `read${i}`, title: `Reading ${i}`, parentId: 'pp', parentTitle: 'Readings',
      minutes: 30, chainIndex: i, bufferMinutes: null,
    }))
    // 90m gap − 15m either side = 60m of work: two readings, not three.
    const [top] = rankForGap(chain, gap90, BASE)
    expect(top.taskIds).toEqual(['read0', 'read1'])
    expect(top.title).toBe('Reading 0 + 1 more')
    expect(top.minutes).toBe(60)
  })

  it('says why it picked something', () => {
    const [top] = rankForGap([task({ id: 'Essay', dueDay: DAY })], gap90, BASE)
    expect(top.reasons[0]).toBe('fits your 1h 30m')
    expect(top.reasons).toContain('due today')
  })

  it('explains an undated pick by its priority', () => {
    const [top] = rankForGap([task({ id: 'Rewrite CV', priority: 4 })], gap90, BASE)
    expect(top.reasons).toContain('critical, no deadline')
  })

  it('counts days for a deadline that is not today', () => {
    const [top] = rankForGap([task({ id: 'x', dueDay: '2026-09-14' })], gap90, BASE)
    expect(top.reasons).toContain('overdue by 2 days')
  })
})

describe('formatClock keeps the half of the day', () => {
  // Working hours can run 10:00 → 01:30, so "10:00" alone names two hours.
  it('distinguishes ten in the morning from ten at night', () => {
    expect(formatClock(at('10:00'), TZ)).toBe('10:00am')
    expect(formatClock(at('22:00'), TZ)).toBe('10:00pm')
  })

  it('reads midnight and noon the way a clock does', () => {
    expect(formatClock(at('0:00'),  TZ)).toBe('12:00am')
    expect(formatClock(at('12:00'), TZ)).toBe('12:00pm')
  })
})

describe('right now', () => {
  const gaps: [number, number][] = [[at('9:00'), at('11:00')], [at('13:15'), at('14:45')]]
  const events = [event('Fall Fest', '11:00', '13:15'), event('ENTR 179A', '11:00', '12:15'), event('CSCI 134', '14:45', '16:00')]

  it('reports the overlapping event that ends last', () => {
    const rn = rightNowFrom({ nowMs: at('12:30'), gaps, events })
    expect(rn.inEvent?.title).toBe('Fall Fest')
    expect(rn.gap?.startMs).toBe(at('13:15'))
    expect(rn.gap?.minutes).toBe(90)
    expect(rn.nextEvent?.title).toBe('CSCI 134')
  })

  it('measures a gap you are already inside from now', () => {
    const rn = rightNowFrom({ nowMs: at('13:45'), gaps, events })
    expect(rn.inEvent).toBeNull()
    expect(rn.gap?.minutes).toBe(60)
    expect(rn.doneForToday).toBe(false)
  })

  it('knows when the day has no free time left', () => {
    const rn = rightNowFrom({ nowMs: at('21:00'), gaps, events })
    expect(rn.gap).toBeNull()
    expect(rn.doneForToday).toBe(true)
  })
})

describe('buildHome', () => {
  const events = [event('Fall Fest', '11:00', '13:15'), event('CSCI 134', '14:45', '16:00')]
  const gaps = freeGaps({
    dayStr: DAY, tz: TZ, workingHours: hours(),
    busy: events.map(e => [e.startMs, e.endMs] as [number, number]),
    minMinutes: 15,
  })

  const tasks = [
    task({ id: 'late',  title: 'Late thing',  dueDay: '2026-09-12', urgencyScore: 95 }),
    task({ id: 'today', title: 'Today thing', dueDay: DAY,          urgencyScore: 70 }),
    task({ id: 'later', title: 'Later thing', dueDay: '2026-10-01', urgencyScore: 20 }),
  ]

  it('splits needs-attention into overdue and due today', () => {
    const d = buildHome({ ...BASE, nowMs: at('13:30'), gaps, events, tasks })
    expect(d.overdue.map(r => r.title)).toEqual(['Late thing'])
    expect(d.dueToday.map(r => r.title)).toEqual(['Today thing'])
  })

  it('suggests for the gap you are in, most urgent first', () => {
    const d = buildHome({ ...BASE, nowMs: at('13:30'), gaps, events, tasks })
    expect(d.suggestions[0].taskIds).toEqual(['late'])
    expect(d.suggestions).toHaveLength(3)
  })

  it('suggests for the next gap while you are in a meeting', () => {
    const d = buildHome({ ...BASE, nowMs: at('12:00'), gaps, events, tasks })
    expect(d.rightNow.inEvent?.title).toBe('Fall Fest')
    expect(d.suggestions.length).toBeGreaterThan(0)
  })

  it('draws the rest of the day in time order, gaps included', () => {
    const d = buildHome({ ...BASE, nowMs: at('13:30'), gaps, events, tasks })
    expect(d.shape.map(r => r.kind)).toEqual(['gap', 'event', 'gap'])
    // The gap you are standing in starts now, not when it opened at 13:15.
    expect(d.shape[0].startMs).toBe(at('13:30'))
    expect(d.shape[0].kind === 'gap' && d.shape[0].minutes).toBe(75)
  })

  it('leaves the past out of the shape', () => {
    const d = buildHome({ ...BASE, nowMs: at('17:00'), gaps, events, tasks })
    expect(d.shape.every(r => r.endMs > at('17:00'))).toBe(true)
  })

  it('offers nothing once the working day is over', () => {
    const d = buildHome({ ...BASE, nowMs: at('23:00'), gaps, events, tasks })
    expect(d.suggestions).toEqual([])
    expect(d.rightNow.doneForToday).toBe(true)
  })
})

describe('one answer is not printed five times', () => {
  // Three free hours in a row, and three things to do. Each gap should get
  // something different rather than every gap getting the most urgent task.
  const events = [event('A', '11:00', '12:00'), event('B', '14:00', '15:00'), event('C', '17:00', '18:00')]
  const gaps = freeGaps({
    dayStr: DAY, tz: TZ, workingHours: hours(),
    busy: events.map(e => [e.startMs, e.endMs] as [number, number]),
    minMinutes: 15,
  })
  const tasks = [
    task({ id: 'one',   minutes: 30, urgencyScore: 90 }),
    task({ id: 'two',   minutes: 30, urgencyScore: 80 }),
    task({ id: 'three', minutes: 30, urgencyScore: 70 }),
    task({ id: 'four',  minutes: 30, urgencyScore: 60 }),
  ]

  it('spends each suggestion once across the day', () => {
    const d = buildHome({ ...BASE, nowMs: at('10:00'), gaps, events, tasks })
    const offered = d.shape.flatMap(r => r.kind === 'gap' ? r.fits.flatMap(f => f.taskIds) : [])
    expect(new Set(offered).size).toBe(offered.length)
  })

  it('still lets the first gap agree with "do this now"', () => {
    const d = buildHome({ ...BASE, nowMs: at('10:00'), gaps, events, tasks })
    const firstGap = d.shape.find(r => r.kind === 'gap')
    expect(firstGap?.kind === 'gap' && firstGap.fits[0].taskIds)
      .toEqual(d.suggestions[0].taskIds)
  })
})

describe('needs attention collapses a chain', () => {
  const parent = task({ id: 'pp', title: 'Readings', urgencyScore: 80, dueDay: DAY })
  const steps = [0, 1, 2].map(i => resolveAgainstParent(
    task({ id: `r${i}`, title: `Step ${i}`, parentId: 'pp', minutes: 20, chainIndex: i }),
    parent,
  ))

  it('makes one row out of three steps', () => {
    const [row] = collapseChains(steps)
    expect(row.title).toBe('Readings')
    expect(row.stepsLabel).toBe('3 steps')
    expect(row.minutes).toBe(60)
    expect(row.taskIds).toEqual(['r0', 'r1', 'r2'])
  })

  it('opens the work, not one step of it', () => {
    expect(collapseChains(steps)[0].openId).toBe('pp')
  })

  it('leaves a lone task alone', () => {
    const [row] = collapseChains([task({ id: 'solo', title: 'Solo', dueDay: DAY })])
    expect(row.stepsLabel).toBeNull()
    expect(row.openId).toBe('solo')
  })

  it('reports no total when a step has no estimate', () => {
    const mixed = [steps[0], { ...steps[1], minutes: null }]
    expect(collapseChains(mixed)[0].minutes).toBeNull()
  })

  it('sorts by the most urgent member', () => {
    const rows = collapseChains([
      task({ id: 'quiet', urgencyScore: 20, dueDay: DAY }),
      task({ id: 'loud',  urgencyScore: 99, dueDay: DAY }),
    ])
    expect(rows.map(r => r.title)).toEqual(['loud', 'quiet'])
  })
})
