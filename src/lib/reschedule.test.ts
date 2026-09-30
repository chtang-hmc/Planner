import { describe, expect, it } from 'vitest'
import { dueDateFor, movableToToday } from './reschedule'

const TODAY = '2026-09-30'
const row = (id: string, due: string | null, o: Partial<{ status: string; type: string }> = {}) =>
  ({ id, due_date: due, status: o.status ?? 'inbox', type: o.type ?? 'task' })

describe('movableToToday', () => {
  it('moves open tasks dated before today', () => {
    expect(movableToToday([row('a', '2026-09-29T00:00:00+00:00'), row('b', '2026-09-01T00:00:00Z', { status: 'active' })], TODAY))
      .toEqual(['a', 'b'])
  })
  it('leaves anything no longer overdue alone, since the page may be stale', () => {
    expect(movableToToday([
      row('today', '2026-09-30T00:00:00Z'),
      row('later', '2026-10-02T00:00:00Z'),
      row('undated', null),
      row('done', '2026-09-29T00:00:00Z', { status: 'done' }),
      row('cancelled', '2026-09-29T00:00:00Z', { status: 'cancelled' }),
    ], TODAY)).toEqual([])
  })
  it('never moves a habit, whose date is its chain position', () => {
    expect(movableToToday([row('h', '2026-09-26T00:00:00Z', { type: 'habit' })], TODAY)).toEqual([])
  })
})

describe('dueDateFor', () => {
  it('is UTC midnight, like every stored due date', () => {
    expect(dueDateFor(TODAY)).toBe('2026-09-30T00:00:00Z')
    expect(dueDateFor(TODAY).slice(0, 10)).toBe(TODAY)
  })
})
