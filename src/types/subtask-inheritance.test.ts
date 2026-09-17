import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeUrgency, Task, UrgencyCurve } from './index'

/**
 * Subtask importance comes from the parent.
 *
 * A subtask used to be born at priority 1 with urgency 0 and no deadline, so
 * its own row said it did not matter while the thing it belonged to was due
 * today — five Public Policy readings sat at urgency 10 under a parent at 80.
 * Three separate readers had to resolve upward to work around that: the
 * scheduler, Upcoming's `dueDay`, and the relevance filter.
 *
 * `createSubtask` now inherits priority, deadline and curve, and `updateTask`
 * cascades them. What these tests pin is the property that makes that safe:
 * urgency is *derived*, so copying the inputs is enough and copying the score
 * itself is never necessary.
 */

const NOW = new Date('2026-09-16T12:00:00Z')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

type UrgencyInputs = Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'>

function inputs(over: Partial<UrgencyInputs> = {}): UrgencyInputs {
  return {
    priority: 3, urgency_curve: 'linear',
    due_date: '2026-09-16T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  } as UrgencyInputs
}

describe('a subtask carrying its parent inputs scores the same', () => {
  it('matches the parent exactly', () => {
    const parent = inputs()
    // Same priority, deadline and curve; created whenever.
    const child  = inputs({ created_at: '2026-09-16T09:00:00Z' })
    expect(computeUrgency(child)).toBe(computeUrgency(parent))
  })

  it('matches across every priority and curve', () => {
    for (const priority of [1, 2, 3, 4] as const) {
      for (const curve of ['linear', 'exponential', 'step'] as UrgencyCurve[]) {
        for (const due of ['2026-09-10T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-30T00:00:00Z', null]) {
          const parent = inputs({ priority, urgency_curve: curve, due_date: due })
          const child  = inputs({ priority, urgency_curve: curve, due_date: due,
                                  created_at: '2020-01-01T00:00:00Z' })
          expect(computeUrgency(child)).toBe(computeUrgency(parent))
        }
      }
    }
  })
})

describe('the old defaults are what made a subtask look unimportant', () => {
  it('scored a reading at 10 while its parent scored 80', () => {
    // The real rows, before the backfill.
    const parentRow = inputs({ priority: 3, due_date: '2026-09-16T00:00:00Z' })
    const oldChild  = inputs({ priority: 1, due_date: null })

    // The exact figure moves with the hour — the point is the size of the gap,
    // not the decimal. The live rows read 80.1 against 10.
    expect(computeUrgency(parentRow)).toBeGreaterThan(75)
    expect(computeUrgency(oldChild)).toBe(10)
    expect(computeUrgency(parentRow) - computeUrgency(oldChild)).toBeGreaterThan(65)
  })

  it('closes the gap once the inputs are inherited', () => {
    const parentRow = inputs({ priority: 3, due_date: '2026-09-16T00:00:00Z' })
    const newChild  = inputs({ priority: 3, due_date: '2026-09-16T00:00:00Z' })
    expect(computeUrgency(newChild)).toBe(computeUrgency(parentRow))
  })
})

describe('urgency stays derived, so a cascade only has to move inputs', () => {
  it('follows a deadline change', () => {
    const before = computeUrgency(inputs({ due_date: '2026-09-30T00:00:00Z' }))
    const after  = computeUrgency(inputs({ due_date: '2026-09-16T00:00:00Z' }))
    expect(after).toBeGreaterThan(before)
  })

  it('follows a priority change', () => {
    const before = computeUrgency(inputs({ priority: 1 }))
    const after  = computeUrgency(inputs({ priority: 4 }))
    expect(after - before).toBeCloseTo(30, 6)
  })

  it('never depends on when the row was created', () => {
    // The property the whole inheritance scheme rests on: a subtask created
    // today and a parent created months ago compute identically.
    const scores = [
      '2020-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-16T11:59:00Z',
    ].map(created_at => computeUrgency(inputs({ created_at })))
    expect(new Set(scores).size).toBe(1)
  })
})
