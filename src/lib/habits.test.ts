import { describe, it, expect } from 'vitest'
import {
  completionDaysByTitle, oneRowPerTitle, summariesFor, availableBefore,
} from '@/lib/habits'
import type { Project, Task } from '@/types'

const TZ = 'America/Los_Angeles'
const PROJECT = { id: 'p', name: 'Home', color: '#000', archived: false, created_at: '' } as Project

function habit(id: string, title: string, status: Task['status'] = 'inbox') {
  return { id, title, status, type: 'habit', project: PROJECT } as Task & { project: Project }
}

describe('completion days are local days, per title', () => {
  it('counts an evening session on the evening you had', () => {
    // 03:00 UTC on the 20th is 20:00 on the 19th in Los Angeles.
    const map = completionDaysByTitle([{ title: 'Gym', completed_at: '2026-09-20T03:00:00Z' }], TZ)
    expect(map).toEqual({ Gym: ['2026-09-19'] })
  })

  it('counts two sessions on one day once', () => {
    const map = completionDaysByTitle([
      { title: 'Piano', completed_at: '2026-09-18T17:00:00Z' },
      { title: 'Piano', completed_at: '2026-09-18T23:00:00Z' },
    ], TZ)
    expect(map.Piano).toEqual(['2026-09-18'])
  })

  it('ignores a row with no completion time', () => {
    expect(completionDaysByTitle([{ title: 'Run', completed_at: null }], TZ)).toEqual({})
  })

  it('keeps titles apart and sorts the days', () => {
    const map = completionDaysByTitle([
      { title: 'Gym',   completed_at: '2026-09-18T17:00:00Z' },
      { title: 'Piano', completed_at: '2026-09-16T17:00:00Z' },
      { title: 'Gym',   completed_at: '2026-09-15T17:00:00Z' },
    ], TZ)
    expect(map).toEqual({ Gym: ['2026-09-15', '2026-09-18'], Piano: ['2026-09-16'] })
  })
})

describe('weekly counts start at the configured week start', () => {
  const map = { Piano: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'] }
  const week = (weekStartDay: number) =>
    summariesFor([{ id: 'p', title: 'Piano', weekly_target: 7 }], map, '2026-09-16', weekStartDay).p.thisWeek

  it('counts from the week start the user chose', () => {
    expect(week(1)).toBe(3)   // Monday start: the 13th is last week
    expect(week(0)).toBe(4)   // Sunday start
  })

  it('counts nothing for a habit last done in a previous week', () => {
    expect(summariesFor([{ id: 'r', title: 'Run', weekly_target: 3 }], { Run: ['2026-08-01'] }, '2026-09-16', 1).r.thisWeek).toBe(0)
  })
})

describe('one row per habit', () => {
  it("shows today's completion over a leftover pending row", () => {
    // Piano on 2026-09-28: logged, with an older open row still pending. A
    // second tick records nothing, so the habit reads as done.
    const { habits, doneTodayIds } = oneRowPerTitle(
      [habit('leftover', 'Piano')],
      [habit('logged', 'Piano', 'done')],
    )
    expect(habits.map(h => h.id)).toEqual(['logged'])
    expect(doneTodayIds).toEqual(['logged'])
  })

  it('shows the pending row when the habit is not done today', () => {
    const { habits, doneTodayIds } = oneRowPerTitle([habit('open', 'Gym')], [])
    expect(habits.map(h => h.id)).toEqual(['open'])
    expect(doneTodayIds).toEqual([])
  })

  it('keeps a habit that is only done today, and marks it', () => {
    const { habits, doneTodayIds } = oneRowPerTitle([], [habit('old', 'Piano', 'done')])
    expect(habits.map(h => h.id)).toEqual(['old'])
    expect(doneTodayIds).toEqual(['old'])
  })

  it('collapses two completions of the same habit to one row', () => {
    const { habits } = oneRowPerTitle([], [habit('a', 'Gym', 'done'), habit('b', 'Gym', 'done')])
    expect(habits).toHaveLength(1)
  })

  it('sorts by title', () => {
    const { habits } = oneRowPerTitle([habit('1', 'Run'), habit('2', 'Gym')], [])
    expect(habits.map(h => h.title)).toEqual(['Gym', 'Run'])
  })
})

describe('summaries follow the title, not the row', () => {
  /**
   * #38. Completing a habit closes its row and spawns a new one, so a streak
   * stored against the row's id was always written to an id that was about to
   * be retired, and could never read more than 1. Derived from the title's
   * completion days, the row on screen gets the history its predecessors made.
   */
  it('gives today’s row the streak the retired rows earned', () => {
    const days = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']
    const s = summariesFor([{ id: 'todays-id', title: 'Piano', weekly_target: 7 }], { Piano: days }, '2026-09-16', 1)
    expect(s['todays-id']).toEqual({
      streak: { value: 5, unit: 'd' }, best: { value: 5, unit: 'd' }, thisWeek: 3, lastDone: '2026-09-16',
    })
  })

  it('gives a never-done habit zeroes rather than nothing', () => {
    const s = summariesFor([{ id: 'x', title: 'Run', weekly_target: 3 }], {}, '2026-09-16', 1)
    expect(s.x).toMatchObject({ thisWeek: 0, lastDone: null, streak: { value: 0, unit: 'w' } })
  })
})

describe('tomorrow stays hidden until it is tomorrow', () => {
  it('cuts off at the start of the next local day', () => {
    // Los Angeles is UTC-7 in September, so the 21st begins at 07:00Z.
    expect(availableBefore('2026-09-20', TZ)).toBe('2026-09-21T07:00:00.000Z')
  })

  it('does not cut off at UTC midnight, which arrives a day early locally', () => {
    // A row due 2026-09-21T00:00:00Z is 17:00 on the 20th in Los Angeles.
    // Comparing against UTC midnight would hide today's habits all afternoon.
    expect('2026-09-21T00:00:00Z' < availableBefore('2026-09-20', TZ)).toBe(true)
  })
})
