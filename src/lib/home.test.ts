import { describe, it, expect } from 'vitest'
import { freeGaps, localMidnight, workWindowFor, type WorkingHours, type BreakWindow } from '@/lib/scheduler'
import {
  buildHome, rankForGap, rightNowFrom, rightNowSentence, resolveAgainstParent, edgeBuffer, collapseChains, formatClock, describeAge, freeTimeBasis, dayReason, isConsumed,
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
    const gaps = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(), busy: [] }).gaps
    expect(gaps).toEqual([[at('9:00'), at('22:00')]])
  })

  it('returns nothing when the day is switched off', () => {
    const wh = hours().map(w => w.day_of_week === 3 ? { ...w, enabled: false } : w)
    expect(freeGaps({ dayStr: DAY, tz: TZ, workingHours: wh, busy: [] }).gaps).toEqual([])
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
    }).gaps
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
    }).gaps
    expect(gaps[1][0]).toBe(at('14:00'))
  })

  it('leaves no zero-length gap between back-to-back events', () => {
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [[at('11:00'), at('12:00')], [at('12:00'), at('13:00')]],
    }).gaps
    expect(gaps).toEqual([[at('9:00'), at('11:00')], [at('13:00'), at('22:00')]])
  })

  it('carves out a break', () => {
    const lunch: BreakWindow = {
      label: 'Lunch', durationMinutes: 30,
      startHour: 12, startMinute: 0, endHour: 14, endMinute: 0, cooldownMinutes: 0,
    }
    const gaps = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(), busy: [], breaks: [lunch] }).gaps
    // Takes the earliest slot in its window.
    expect(gaps).toEqual([[at('9:00'), at('12:00')], [at('12:30'), at('22:00')]])
  })

  it('drops gaps below minMinutes', () => {
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(),
      busy: [[at('9:10'), at('12:00')]],
      minMinutes: 15,
    }).gaps
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
  const window: [number, number] = [at('9:00'), at('22:00')]

  it('reports the overlapping event that ends last', () => {
    const rn = rightNowFrom({ nowMs: at('12:30'), gaps, events, workWindow: window })
    expect(rn.inEvent?.title).toBe('Fall Fest')
    expect(rn.gap?.startMs).toBe(at('13:15'))
    expect(rn.gap?.minutes).toBe(90)
    expect(rn.nextEvent?.title).toBe('CSCI 134')
  })

  it('measures a gap you are already inside from now', () => {
    const rn = rightNowFrom({ nowMs: at('13:45'), gaps, events, workWindow: window })
    expect(rn.inEvent).toBeNull()
    expect(rn.gap?.minutes).toBe(60)
    expect(rn.gap?.hasStarted).toBe(true)
    expect(rn.reason).toBe('available')
  })

  it('knows when the day has no free time left', () => {
    const rn = rightNowFrom({ nowMs: at('21:00'), gaps, events, workWindow: window, reason: 'consumed' })
    expect(rn.gap).toBeNull()
    expect(rn.reason).toBe('consumed')
  })
})

describe('a gap that has not opened is not time you have', () => {
  // The bug: the header announced the first gap of the day as though it were
  // current. At 08:00 against a 09:00 start it read "2h free until Fall Fest
  // at 11:00am", offering an hour that had not arrived.
  const gaps: [number, number][] = [[at('9:00'), at('11:00')], [at('13:15'), at('14:45')]]
  const events = [event('Fall Fest', '11:00', '13:15')]
  const window: [number, number] = [at('9:00'), at('22:00')]

  it('says the day has not started, and when it does', () => {
    const rn = rightNowFrom({ nowMs: at('8:00'), gaps, events, workWindow: window })
    expect(rn.gap?.hasStarted).toBe(false)
    expect(rn.dayStartsMs).toBe(at('9:00'))
    // The whole gap, not a remainder — none of it has been spent.
    expect(rn.gap?.minutes).toBe(120)
    expect(rn.gap?.startMs).toBe(at('9:00'))
  })

  it('distinguishes a break from a day that has not begun', () => {
    // 11:00–13:15 is Fall Fest, so at 12:00 you are in an event. Take the
    // event away and the same hole is a carved-out break: inside the working
    // day, nothing to report being "in", and the next gap still to come.
    const rn = rightNowFrom({ nowMs: at('12:00'), gaps, events: [], workWindow: window })
    expect(rn.inEvent).toBeNull()
    expect(rn.gap?.hasStarted).toBe(false)
    expect(rn.dayStartsMs).toBeNull()      // the day is open; this is not its start
    expect(rn.gap?.startMs).toBe(at('13:15'))
  })

  it('reports nothing about a day start once the day is open', () => {
    const rn = rightNowFrom({ nowMs: at('13:45'), gaps, events, workWindow: window })
    expect(rn.dayStartsMs).toBeNull()
  })

  it('treats a day with no window as simply having no start to name', () => {
    const rn = rightNowFrom({ nowMs: at('8:00'), gaps, events, workWindow: null })
    expect(rn.dayStartsMs).toBeNull()
    expect(rn.gap?.hasStarted).toBe(false)
  })
})

describe('buildHome', () => {
  const events = [event('Fall Fest', '11:00', '13:15'), event('CSCI 134', '14:45', '16:00')]
  const gaps = freeGaps({
    dayStr: DAY, tz: TZ, workingHours: hours(),
    busy: events.map(e => [e.startMs, e.endMs] as [number, number]),
    minMinutes: 15,
  }).gaps

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

  it('draws the whole day in time order, gaps included', () => {
    const d = buildHome({ ...BASE, nowMs: at('13:30'), gaps, events, tasks })
    // Three gaps and two events, interleaved: the whole day, not the rest of it.
    expect(d.shape.map(r => r.kind)).toEqual(['gap', 'event', 'gap', 'event', 'gap'])
    // The gap you are standing in starts now, not when it opened at 13:15.
    const current = d.shape.find(r => r.position === 'current')!
    expect(current.startMs).toBe(at('13:30'))
    expect(current.kind === 'gap' && current.minutes).toBe(75)
  })

  it('keeps the past, dimmed, rather than shortening the day', () => {
    // Deleting spent slots makes the day look shorter than it was. They stay,
    // marked, and hold no chips because there is nothing left to act on.
    const d = buildHome({ ...BASE, nowMs: at('17:00'), gaps, events, tasks })
    const past = d.shape.filter(r => r.position === 'past')
    expect(past.length).toBeGreaterThan(0)
    expect(past.every(r => r.kind !== 'gap' || r.fits.length === 0)).toBe(true)
  })

  it('marks only one slot current and one next', () => {
    const d = buildHome({ ...BASE, nowMs: at('13:30'), gaps, events, tasks })
    const slots = d.shape.filter(r => r.kind === 'gap')
    expect(slots.filter(r => r.position === 'current')).toHaveLength(1)
    expect(slots.filter(r => r.position === 'next')).toHaveLength(1)
  })

  it('marks a slot late from the same threshold the bar uses', () => {
    const lateHours: WorkingHours[] = Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d, start_hour: 10, start_minute: 0,
      end_hour: 1, end_minute: 30, enabled: true,
    }))
    const g = freeGaps({ dayStr: DAY, tz: TZ, workingHours: lateHours, busy: [], minMinutes: 15 }).gaps
    const d = buildHome({ ...BASE, nowMs: at('10:00'), gaps: g, events: [], tasks: [] })
    const slot = d.shape.find(r => r.kind === 'gap')!
    // 10:00–01:30 as one stretch starts before the cutoff, so it is not late.
    expect(slot.kind === 'gap' && slot.late).toBe(false)

    const evening = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: lateHours,
      busy: [[at('10:00'), at('22:00')]], minMinutes: 15,
    }).gaps
    const e = buildHome({ ...BASE, nowMs: at('10:00'), gaps: evening, events: [], tasks: [] })
    const lateSlot = e.shape.find(r => r.kind === 'gap')!
    expect(lateSlot.kind === 'gap' && lateSlot.late).toBe(true)
  })

  it('offers nothing once the working day is over', () => {
    const d = buildHome({ ...BASE, nowMs: at('23:00'), gaps, events, tasks })
    expect(d.suggestions).toEqual([])
    expect(d.rightNow.reason).toBe('consumed')
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
  }).gaps
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

describe('a working day is not a calendar day', () => {
  // The real configuration: 10:00 → 01:30, every day.
  const lateHours = (): WorkingHours[] => Array.from({ length: 7 }, (_, d) => ({
    day_of_week: d, start_hour: 10, start_minute: 0,
    end_hour: 1, end_minute: 30, enabled: true,
  }))

  it('runs the window ninety minutes into the next day', () => {
    const win = workWindowFor(localMidnight(DAY, TZ), lateHours(), TZ)
    expect(win![0]).toBe(at('10:00'))
    expect(win![1]).toBe(at('1:30', '2026-09-17'))   // the following morning
  })

  it('subtracts an event that starts after midnight', () => {
    // This is what the page was never fetching: bounding the event query at
    // local midnight left the 00:15 meeting out of `busy` entirely, so Home
    // offered 22:00–01:30 as free with a meeting inside it.
    const gaps = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: lateHours(),
      busy: [[at('0:15', '2026-09-17'), at('1:00', '2026-09-17')]],
      minMinutes: 15,
    }).gaps
    expect(gaps).toEqual([
      [at('10:00'),            at('0:15', '2026-09-17')],
      [at('1:00', '2026-09-17'), at('1:30', '2026-09-17')],
    ])
  })

  it('is one unbroken stretch when that tail is clear', () => {
    const gaps = freeGaps({ dayStr: DAY, tz: TZ, workingHours: lateHours(), busy: [], minMinutes: 15 }).gaps
    expect(gaps).toEqual([[at('10:00'), at('1:30', '2026-09-17')]])
  })
})

describe('describeAge', () => {
  const T = Date.parse('2026-09-20T12:00:00Z')
  const ago = (mins: number) => describeAge(new Date(T - mins * 60_000).toISOString(), T)

  it('says nothing when nothing was recorded', () => {
    // NULL means "unknown", which is not the claim "never".
    expect(describeAge(null, T)).toBeNull()
  })

  it('words the ranges', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(1)).toBe('just now')
    expect(ago(2)).toBe('2m ago')
    expect(ago(59)).toBe('59m ago')
    expect(ago(90)).toBe('2h ago')
    expect(ago(60 * 25)).toBe('1d ago')
  })

  it('is pure, so SSR and hydration cannot disagree', () => {
    // The bug this replaced: the minutes are rounded, so the "just now"
    // boundary is at 90 seconds. A sync 85s old read "just now" during SSR and
    // "2m ago" ten seconds later in the browser, because each render asked the
    // clock itself. Same inputs must now give the same answer, always.
    const iso = new Date(T - 85_000).toISOString()
    expect(describeAge(iso, T)).toBe(describeAge(iso, T))
    expect(describeAge(iso, T)).toBe('just now')
    expect(describeAge(iso, T + 10_000)).toBe('2m ago')   // the boundary it used to straddle
  })

  it('refuses a timestamp from the future rather than saying "-1m ago"', () => {
    expect(describeAge(new Date(T + 600_000).toISOString(), T)).toBeNull()
  })
})

describe('the sentence at the top of the page', () => {
  const gaps: [number, number][] = [[at('9:00'), at('11:00')], [at('13:15'), at('14:45')]]
  const events = [event('Fall Fest', '11:00', '13:15'), event('CSCI 134', '14:45', '16:00')]
  const window: [number, number] = [at('9:00'), at('22:00')]
  const say = (hhmm: string, over: { events?: HomeEvent[]; gaps?: [number, number][] } = {}) =>
    rightNowSentence(rightNowFrom({
      nowMs: at(hhmm), gaps: over.gaps ?? gaps, events: over.events ?? events, workWindow: window,
    }), TZ)

  it('names the start before the day opens', () => {
    expect(say('8:00')).toBe('Your day starts at 9:00am — 2h free then.')
  })

  it('reports the time you actually have once it has opened', () => {
    expect(say('13:45')).toBe('1h free until CSCI 134 at 2:45pm.')
  })

  it('reports the event you are in, and what follows', () => {
    expect(say('12:00')).toBe('In Fall Fest until 1:15pm. Next free: 1h 30m at 1:15pm.')
  })

  it('does not claim a day start when the day is already open', () => {
    // 11:00–13:15 with no event over it is a carved-out break, not a closed day.
    expect(say('12:00', { events: [] })).toBe('Nothing free until 1:15pm, then 1h 30m.')
  })

  it('says so when the day is spent', () => {
    expect(say('21:00')).toBe('No working time left today.')
  })

  it('says so when an event is the last thing on the day', () => {
    expect(say('12:00', { gaps: [[at('9:00'), at('11:00')]] }))
      .toBe('In Fall Fest until 1:15pm. Nothing free after it today.')
  })
})

describe('free time is only asserted when something asserts it', () => {
  /**
   * The bug: `freeGaps` subtracts what it is given, so given nothing it returns
   * the whole working window. With no calendar the page said "9h 30m free" and
   * ranked work into it, on the strength of no evidence at all. Zero events is
   * an unknown day, not a free one.
   */
  it('will not claim free time without a calendar', () => {
    expect(freeTimeBasis({ calendarConnected: false, lastSyncedISO: null, eventCount: 0 }))
      .toEqual({ observed: false, reason: 'no-calendar' })
  })

  it('still will not, even on a day that happens to have events', () => {
    // Events can exist from a connection that was since removed.
    expect(freeTimeBasis({ calendarConnected: false, lastSyncedISO: '2026-09-20T07:00:00Z', eventCount: 4 }))
      .toEqual({ observed: false, reason: 'no-calendar' })
  })

  it('treats a connection that has never synced as unknown', () => {
    // The window between finishing OAuth and the first sync completing.
    expect(freeTimeBasis({ calendarConnected: true, lastSyncedISO: null, eventCount: 0 }))
      .toEqual({ observed: false, reason: 'never-synced' })
  })

  it('accepts events as proof of a sync that predates the stamp', () => {
    // A database from before migration 0018 has no last_synced_at, but rows on
    // the day are themselves evidence that a sync happened.
    expect(freeTimeBasis({ calendarConnected: true, lastSyncedISO: null, eventCount: 3 }))
      .toEqual({ observed: true })
  })

  it('accepts a synced calendar with a genuinely empty day', () => {
    // This is the case the bug could not distinguish, and the only one that
    // earns the word "free".
    expect(freeTimeBasis({ calendarConnected: true, lastSyncedISO: '2026-09-20T07:00:00Z', eventCount: 0 }))
      .toEqual({ observed: true })
  })
})

describe('absence of data and data showing absence are different facts', () => {
  /**
   * `freeGaps` used to return the same empty list for three different days,
   * and "No working time left today" was said about all three. It is true of
   * exactly one.
   */
  const hours = (enabled: boolean): WorkingHours[] => Array.from({ length: 7 }, (_, d) => ({
    day_of_week: d, start_hour: 9, start_minute: 0,
    end_hour: 22, end_minute: 0, enabled,
  }))

  it('calls a switched-off weekday a day off', () => {
    const r = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(false), busy: [] })
    expect(r).toEqual({ reason: 'dayOff', gaps: [] })
  })

  it('calls a fully booked day consumed', () => {
    const r = freeGaps({
      dayStr: DAY, tz: TZ, workingHours: hours(true),
      busy: [[at('9:00'), at('22:00')]],
    })
    expect(r.reason).toBe('consumed')
    expect(r.gaps).toEqual([])
  })

  it('calls a day with room available', () => {
    expect(freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(true), busy: [] }).reason)
      .toBe('available')
  })

  it('does not decide "unknown" itself', () => {
    // It is handed working hours and busy spans and could only ever guess at
    // whether a calendar exists. That answer lives with the thing that knows.
    const seen = freeGaps({ dayStr: DAY, tz: TZ, workingHours: hours(true), busy: [] })
    expect(dayReason({ observed: false, reason: 'no-calendar' }, seen)).toBe('unknown')
    expect(dayReason({ observed: true }, seen)).toBe('available')
  })

  it('leaves exactly one cause that has been spent', () => {
    expect(isConsumed('consumed')).toBe(true)
    expect(isConsumed('dayOff')).toBe(false)
    expect(isConsumed('unknown')).toBe(false)
  })
})

describe('the sentence says which kind of nothing it is', () => {
  const say = (reason: 'unknown' | 'dayOff' | 'consumed') =>
    rightNowSentence(
      rightNowFrom({ nowMs: at('21:00'), gaps: [], events: [], workWindow: null, reason }),
      TZ,
    )

  it('does not promise free time on a day nobody has looked at', () => {
    expect(say('unknown')).toBe('Planner cannot see your day yet.')
  })

  it('does not say a day off was spent', () => {
    // The bug the audit found: "No working time left today" on a Sunday with
    // working hours switched off, where nothing had been used at all.
    expect(say('dayOff')).toBe('Today is a day off.')
  })

  it('says a full day was spent, because it was', () => {
    expect(say('consumed')).toBe('No working time left today.')
  })
})
