import { describe, it, expect } from 'vitest'
import { sortRail, RAIL_SORTS, type RailItem } from '@/components/ds/UnplacedRail'

const item = (o: Partial<RailItem> & { key: string }): RailItem => ({
  taskId: o.key, title: o.key, note: null, minutes: 30, urgency: 50,
  project: 'Inbox', color: null, ...o,
})

const items = [
  item({ key: 'small',  minutes: 15,  urgency: 90, project: 'Research' }),
  item({ key: 'big',    minutes: 150, urgency: 20, project: 'Clinic' }),
  item({ key: 'middle', minutes: 60,  urgency: 70, project: 'Clinic' }),
]

describe('the rail sorts by the column it shows', () => {
  it('puts the largest first by default', () => {
    // The deficit is denominated in minutes: one decision on a 2h task clears
    // more than four decisions on 15m ones.
    expect(sortRail(items, 'size').map(i => i.key)).toEqual(['big', 'middle', 'small'])
  })

  it('orders by score under urgency', () => {
    expect(sortRail(items, 'urgency').map(i => i.key)).toEqual(['small', 'middle', 'big'])
  })

  it('groups by project, largest first inside each', () => {
    expect(sortRail(items, 'project').map(i => i.key)).toEqual(['big', 'middle', 'small'])
  })

  it('does not mutate what it was given', () => {
    const before = items.map(i => i.key)
    sortRail(items, 'urgency')
    expect(items.map(i => i.key)).toEqual(before)
  })

  it('labels a column for every sort, so the unit is never inferred', () => {
    // Sorting by a number you cannot see is what the old Projects page did.
    expect(RAIL_SORTS.every(s => s.column.length > 0)).toBe(true)
    expect(RAIL_SORTS.find(s => s.id === 'urgency')!.column).toBe('Urgency')
    expect(RAIL_SORTS.find(s => s.id === 'size')!.column).toBe('Minutes')
  })

  it('treats an unestimated task as smallest rather than dropping it', () => {
    const withNull = [...items, item({ key: 'none', minutes: null })]
    expect(sortRail(withNull, 'size').at(-1)!.key).toBe('none')
  })
})
