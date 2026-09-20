import { describe, it, expect } from 'vitest'
import {
  completionDaysByTitle, weeklyDayCounts, oneRowPerTitle, patchWeeklyProgress, availableBefore,
} from '@/lib/habits'
import type { HabitStreak, Project, Task } from '@/types'

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
  const map = { Piano: ['2026-09-13', '2026-09-14', '2026-09-17', '2026-09-19'] }

  it('excludes the day before the week began', () => {
    expect(weeklyDayCounts(map, '2026-09-14').Piano).toBe(3)   // Monday start
  })

  it('includes it when the week starts on Sunday', () => {
    expect(weeklyDayCounts(map, '2026-09-13').Piano).toBe(4)
  })

  it('is zero for a habit with nothing this week', () => {
    expect(weeklyDayCounts({ Run: ['2026-08-01'] }, '2026-09-14').Run).toBe(0)
  })
})

describe('one row per habit', () => {
  it('prefers the pending occurrence over the one done today', () => {
    // A habit that is somehow both must stay tickable.
    const { habits, doneTodayIds } = oneRowPerTitle(
      [habit('new', 'Gym')],
      [habit('old', 'Gym', 'done')],
    )
    expect(habits.map(h => h.id)).toEqual(['new'])
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

describe('weekly progress is patched onto the row on screen', () => {
  /**
   * The bug this file exists for. Completing a habit closes its row and spawns
   * a new one, so `habit_streaks` — keyed by task_id — holds a count for an id
   * that is no longer displayed. On 2026-09-20 there was no row at all for any
   * open habit, and Home showed Piano at 0/7 in a week it had been played six
   * times.
   */
  it('gives the current row a count the old row earned', () => {
    const streaks = patchWeeklyProgress(
      { 'retired-id': { task_id: 'retired-id', current_streak: 6, longest_streak: 6, last_completed: '2026-09-19', week_start: '2026-09-14', completions_this_week: 6 } },
      [{ id: 'todays-id', title: 'Piano' }],
      { Piano: 6 },
      '2026-09-14',
    )
    expect(streaks['todays-id'].completions_this_week).toBe(6)
  })

  it('zeroes rather than omits a habit with no streak row', () => {
    const streaks = patchWeeklyProgress({}, [{ id: 'x', title: 'Run' }], {}, '2026-09-14')
    expect(streaks.x).toMatchObject({ completions_this_week: 0, current_streak: 0 })
  })

  it('keeps the streak numbers, which only that table has', () => {
    const prev: HabitStreak = {
      task_id: 'x', current_streak: 12, longest_streak: 30,
      last_completed: '2026-09-19', week_start: '2026-09-07', completions_this_week: 1,
    }
    const streaks = patchWeeklyProgress({ x: prev }, [{ id: 'x', title: 'Piano' }], { Piano: 6 }, '2026-09-14')
    expect(streaks.x).toMatchObject({
      current_streak: 12, longest_streak: 30, last_completed: '2026-09-19',
      completions_this_week: 6, week_start: '2026-09-14',
    })
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
