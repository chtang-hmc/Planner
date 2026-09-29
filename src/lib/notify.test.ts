import { describe, expect, it } from 'vitest'
import {
  composeCalendar, composeHabits, composeMorning, composeWrapUp, DEFAULT_PREFS, duePieces, habitsLeft,
  inWindow, milestones, motivation, names, normalizePrefs, weeklyAtRisk,
  type HabitState, type NotifyPrefs, type OpenTask,
} from './notify'

// 2026-09-28 is a Monday; weeks start Monday (1).
const MON = '2026-09-28'
const WSD = 1

const task = (o: Partial<OpenTask>): OpenTask => ({
  id: o.id ?? o.title ?? 'x', title: 'Task', type: 'task', priority: 2, dueDay: null,
  parentId: null, projectId: 'p', urgency: 50, ...o,
})

const habit = (o: Partial<HabitState> & { streak?: number; unit?: 'd' | 'w'; thisWeek?: number; lastDone?: string | null }): HabitState => ({
  title: o.title ?? 'Piano',
  weeklyTarget: 'weeklyTarget' in o ? o.weeklyTarget! : 7,
  doneToday: o.doneToday ?? false,
  summary: {
    streak: o.streak === undefined ? null : { value: o.streak, unit: o.unit ?? 'd' },
    best: null,
    thisWeek: o.thisWeek ?? 0,
    lastDone: o.lastDone ?? null,
  },
})

const prefs = (on: Partial<NotifyPrefs['on']> = {}): NotifyPrefs => ({ ...DEFAULT_PREFS, on: { ...DEFAULT_PREFS.on, ...on } })

describe('normalizePrefs', () => {
  it('fills an empty object with every default', () => {
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS)
  })
  it('keeps valid fields and drops bad ones', () => {
    const p = normalizePrefs({ morningAt: 450, habitsAt: 9999, on: { inbox: false, bogus: true }, inboxThreshold: 0 })
    expect(p.morningAt).toBe(450)
    expect(p.habitsAt).toBe(DEFAULT_PREFS.habitsAt)
    expect(p.inboxThreshold).toBe(DEFAULT_PREFS.inboxThreshold)
    expect(p.on.inbox).toBe(false)
    expect(p.on.dueToday).toBe(true)
    expect('bogus' in p.on).toBe(false)
  })
})

describe('inWindow', () => {
  it('opens at the time and closes after the window', () => {
    expect(inWindow(479, 480)).toBe(false)
    expect(inWindow(480, 480)).toBe(true)
    expect(inWindow(569, 480)).toBe(true)
    expect(inWindow(570, 480)).toBe(false)
  })
})

describe('names', () => {
  it('reads as a list', () => {
    expect(names(['A'])).toBe('A')
    expect(names(['A', 'B'])).toBe('A and B')
    expect(names(['A', 'B', 'C'])).toBe('A, B and C')
    expect(names(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 more')
  })
})

describe('duePieces', () => {
  it('counts a parent and its undated steps once, under the parent', () => {
    const tasks = [
      task({ id: 'p', title: 'Readings', dueDay: MON, urgency: 40 }),
      task({ id: 's1', title: 'Ch 1', parentId: 'p', urgency: 70 }),
      task({ id: 's2', title: 'Ch 2', parentId: 'p' }),
      task({ id: 'h', title: 'Piano', type: 'habit', dueDay: MON }),
      task({ id: 'z', title: 'Someday', type: 'someday', dueDay: MON }),
    ]
    const pieces = duePieces(tasks, d => d === MON)
    expect(pieces).toEqual([{ title: 'Readings', urgency: 70, priority: 2 }])
  })
})

describe('motivation', () => {
  it('matches its tone to the count and names the top task', () => {
    expect(motivation(0, null, MON)).not.toMatch(/Thesis/)
    for (const n of [1, 4, 9]) expect(motivation(n, 'Thesis draft', MON)).toContain('Thesis draft')
  })
  it('is stable for a day', () => {
    expect(motivation(4, 'X', MON)).toBe(motivation(4, 'X', MON))
  })
})

describe('composeMorning', () => {
  const base = { today: MON, weekStartDay: WSD, habits: [], lastReviewISO: '2026-09-27T20:00:00Z', nowISO: '2026-09-28T15:00:00Z' }

  it('always says how many are due, even none', () => {
    const m = composeMorning({ ...base, tasks: [], prefs: prefs() })!
    expect(m.title).toBe('Nothing due today')
  })

  it('puts overdue-since-yesterday and critical-tomorrow on their own lines', () => {
    const tasks = [
      task({ title: 'Thesis draft', dueDay: MON, urgency: 90 }),
      task({ title: 'Email advisor', dueDay: '2026-09-27' }),
      task({ title: 'Old thing', dueDay: '2026-09-20' }),
      task({ title: 'Problem set', dueDay: '2026-09-29', priority: 4 }),
      task({ title: 'Minor', dueDay: '2026-09-29', priority: 2 }),
    ]
    const m = composeMorning({ ...base, tasks, prefs: prefs() })!
    expect(m.title).toBe('1 task due today')
    expect(m.body).toContain('Thesis draft')
    expect(m.body).toContain('Went overdue yesterday: Email advisor.')
    expect(m.body).not.toContain('Old thing')
    expect(m.body).toContain('Critical, due tomorrow: Problem set.')
    expect(m.body).not.toContain('Minor')
  })

  it('mentions the review on the first day of the week unless one was just done', () => {
    const tasks: OpenTask[] = []
    expect(composeMorning({ ...base, tasks, prefs: prefs(), lastReviewISO: '2026-09-20T00:00:00Z' })!.body).toContain('weekly review')
    expect(composeMorning({ ...base, tasks, prefs: prefs() })!.body).not.toContain('weekly review')
    expect(composeMorning({ ...base, today: '2026-09-29', tasks, prefs: prefs(), lastReviewISO: null })!.body).not.toContain('weekly review')
  })

  it('flags the inbox at the threshold', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `i${i}`, projectId: null }))
    expect(composeMorning({ ...base, tasks, prefs: prefs() })!.body).toContain('5 tasks in the inbox')
    expect(composeMorning({ ...base, tasks: tasks.slice(1), prefs: prefs() })!.body).not.toContain('inbox')
  })

  it('sends nothing when every line is off or empty', () => {
    const off = prefs(Object.fromEntries(Object.keys(DEFAULT_PREFS.on).map(k => [k, false])))
    expect(composeMorning({ ...base, tasks: [task({ dueDay: MON })], prefs: off })).toBeNull()
  })
})

describe('weeklyAtRisk', () => {
  it('fires with one day of slack or none, and not once it is out of reach', () => {
    // Run 2× a week, none yet. Saturday (2 days left incl. today): at risk.
    expect(weeklyAtRisk(habit({ title: 'Run', weeklyTarget: 2 }), '2026-10-03', WSD)).toEqual({ needed: 2, daysLeft: 2 })
    // Friday, 3 days left: one day of slack, still flagged.
    expect(weeklyAtRisk(habit({ title: 'Run', weeklyTarget: 2 }), '2026-10-02', WSD)).not.toBeNull()
    // Monday, 7 days left: plenty.
    expect(weeklyAtRisk(habit({ title: 'Run', weeklyTarget: 2 }), MON, WSD)).toBeNull()
    // Job Application 5×, none by Sunday: can't be done, so no nag.
    expect(weeklyAtRisk(habit({ weeklyTarget: 5 }), '2026-10-04', WSD)).toBeNull()
    // Daily and anytime habits are someone else's business.
    expect(weeklyAtRisk(habit({ weeklyTarget: 7 }), '2026-10-04', WSD)).toBeNull()
    expect(weeklyAtRisk(habit({ weeklyTarget: null }), '2026-10-04', WSD)).toBeNull()
  })
})

describe('the evening habit reminder', () => {
  const habits = [
    habit({ title: 'Piano', weeklyTarget: 7, streak: 12 }),
    habit({ title: 'Gym', weeklyTarget: 2, thisWeek: 1 }),
    habit({ title: 'Run', weeklyTarget: 2, thisWeek: 2 }),       // target met
    habit({ title: 'News', weeklyTarget: null }),                // anytime
    habit({ title: 'Stretch', weeklyTarget: 7, doneToday: true }),
  ]

  // Saturday: Gym needs 1 more with 2 days left, so it is on the list.
  const SAT = '2026-10-03'

  it('leaves weekly habits alone while the week has room', () => {
    expect(habitsLeft({ today: MON, weekStartDay: WSD, habits, prefs: prefs() }).map(h => h.title)).toEqual(['Piano'])
  })

  it('lists what is left and calls out the streak', () => {
    const left = habitsLeft({ today: SAT, weekStartDay: WSD, habits, prefs: prefs() })
    expect(left.map(h => h.title)).toEqual(['Piano', 'Gym'])
    const m = composeHabits({ today: SAT, weekStartDay: WSD, habits, prefs: prefs() })!
    expect(m.title).toBe('Keep your 12-day streak: Piano')
    expect(m.body).toBe('Piano (12-day streak), Gym (1 of 2 this week)')
  })

  it('with only streak warnings on, stays quiet unless a streak is at risk', () => {
    const p = prefs({ habitReminder: false })
    expect(composeHabits({ today: MON, weekStartDay: WSD, habits, prefs: p })!.body).toBe('Piano (12-day streak)')
    expect(composeHabits({ today: SAT, weekStartDay: WSD, habits: habits.slice(1), prefs: p })).toBeNull()
  })
})

describe('composeWrapUp', () => {
  it('counts tasks, habits and minutes, and names what is still due', () => {
    const m = composeWrapUp({
      today: MON,
      done: [{ type: 'task', minutes: 90 }, { type: 'task', minutes: 70 }, { type: 'habit', minutes: 30 }],
      tasks: [task({ title: 'Thesis draft', dueDay: MON })],
    })!
    expect(m.title).toBe('Today: 2 tasks and 1 habit done')
    expect(m.body).toBe('3h 10m logged. Still due today: Thesis draft.')
  })
  it('says nothing on a day with nothing done and nothing due', () => {
    expect(composeWrapUp({ today: MON, done: [], tasks: [] })).toBeNull()
  })
})

describe('milestones', () => {
  it('announces a milestone reached today or yesterday, once per anchor', () => {
    const got = milestones([
      habit({ title: 'Piano', streak: 7, lastDone: MON }),
      habit({ title: 'Old', streak: 30, lastDone: '2026-09-20' }),
      habit({ title: 'Mid', streak: 8, lastDone: MON }),
      habit({ title: 'Gym', weeklyTarget: 2, streak: 4, unit: 'w', lastDone: '2026-09-27' }),
    ], MON, WSD)
    expect(got.map(g => g.key)).toEqual(['milestone:Piano:7d:2026-09-28', 'milestone:Gym:4w:2026-09-21'])
    expect(got[0].message.title).toBe('7 days of Piano')
  })
})

describe('composeCalendar', () => {
  const now = '2026-09-28T20:00:00Z'
  it('stays quiet while the hourly sync is working', () => {
    expect(composeCalendar({ connected: true, lastSyncedISO: '2026-09-28T19:17:00Z', nowISO: now })).toBeNull()
    expect(composeCalendar({ connected: false, lastSyncedISO: null, nowISO: now })).toBeNull()
  })
  it('speaks up after six hours', () => {
    expect(composeCalendar({ connected: true, lastSyncedISO: '2026-09-28T13:00:00Z', nowISO: now })!.body).toContain('7 hours ago')
  })
})
