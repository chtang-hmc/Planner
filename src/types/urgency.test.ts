import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeUrgency, computeUrgencyBreakdown, URGENCY_HORIZON_DAYS, Task, UrgencyCurve } from './index'

/**
 * Urgency is the app's ranking function: it decides what the scheduler books
 * first and what the list shows at the top. It also has to stay in step with
 * `recompute_urgency_scores()` in migration 0011, which recomputes the same
 * number nightly in PL/pgSQL — a sign error between the two once meant the
 * nightly job quietly overwrote every correct score.
 *
 * The clock is frozen so `daysUntil` is deterministic.
 */

const NOW = new Date('2026-09-16T12:00:00Z')

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function task(over: Partial<Task> = {}): Pick<Task, 'priority' | 'urgency_curve' | 'due_date' | 'created_at'> {
  return {
    priority: 2, urgency_curve: 'linear', due_date: null,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task
}

/** A due date `days` from now. */
function due(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

describe('priority', () => {
  it('is worth ten points a level with no deadline', () => {
    for (const p of [1, 2, 3, 4] as const) {
      expect(computeUrgency(task({ priority: p }))).toBe(p * 10)
    }
  })

  it('is the whole score when there is no deadline', () => {
    const b = computeUrgencyBreakdown(task({ priority: 3 }))
    expect(b.timePressure).toBe(0)
    expect(b.hasDueDate).toBe(false)
    expect(b.daysLeft).toBeNull()
  })
})

describe('creation date does not affect the score', () => {
  // The reason the formula was rewritten: two tasks of equal priority and
  // deadline used to rank differently because one was added a day earlier.
  it('ranks two identical tasks equally however old they are', () => {
    const young = computeUrgency(task({ due_date: due(3), created_at: '2026-09-16T00:00:00Z' }))
    const old   = computeUrgency(task({ due_date: due(3), created_at: '2025-01-01T00:00:00Z' }))
    expect(young).toBe(old)
  })
})

describe('time pressure', () => {
  it('is zero at the horizon and rises as the deadline nears', () => {
    const atHorizon = computeUrgencyBreakdown(task({ due_date: due(URGENCY_HORIZON_DAYS) }))
    expect(atHorizon.timePressure).toBeCloseTo(0, 6)

    const scores = [14, 10, 7, 3, 1, 0].map(d => computeUrgency(task({ due_date: due(d) })))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    }
  })

  it('is flat beyond the horizon rather than going negative', () => {
    const far    = computeUrgencyBreakdown(task({ due_date: due(400) }))
    const horizon = computeUrgencyBreakdown(task({ due_date: due(URGENCY_HORIZON_DAYS) }))
    expect(far.ramp).toBe(0)
    expect(far.timePressure).toBe(horizon.timePressure)
  })

  it('reaches the full on-time allowance exactly at the deadline', () => {
    const b = computeUrgencyBreakdown(task({ priority: 1, due_date: due(0) }))
    expect(b.ramp).toBe(1)
    expect(b.timePressure).toBeCloseTo(50, 6)
  })
})

describe('overdue', () => {
  it('keeps climbing past the deadline, so later beats merely late', () => {
    const today     = computeUrgency(task({ priority: 1, due_date: due(0) }))
    const oneDay    = computeUrgency(task({ priority: 1, due_date: due(-1) }))
    const threeDays = computeUrgency(task({ priority: 1, due_date: due(-3) }))
    expect(oneDay).toBeGreaterThan(today)
    expect(threeDays).toBeGreaterThan(oneDay)
  })

  it('stops climbing once the ramp is spent', () => {
    const week  = computeUrgency(task({ priority: 1, due_date: due(-7) }))
    const month = computeUrgency(task({ priority: 1, due_date: due(-30) }))
    expect(month).toBe(week)
  })
})

describe('bounds', () => {
  it('never exceeds 100, even critical and long overdue', () => {
    expect(computeUrgency(task({ priority: 4, due_date: due(-90) }))).toBeLessThanOrEqual(100)
  })

  it('never goes below the priority floor', () => {
    for (const p of [1, 2, 3, 4] as const) {
      expect(computeUrgency(task({ priority: p, due_date: due(400) }))).toBeGreaterThanOrEqual(p * 10)
    }
  })
})

describe('curves', () => {
  const CURVES: UrgencyCurve[] = ['linear', 'exponential', 'step']

  it('all peak at the full on-time allowance at the deadline', () => {
    for (const curve of CURVES) {
      const atDue = computeUrgencyBreakdown(task({ urgency_curve: curve, due_date: due(0) }))
      expect(atDue.timePressure).toBeCloseTo(50, 6)
    }
  })

  it('linear and exponential start at zero pressure at the horizon', () => {
    for (const curve of ['linear', 'exponential'] as UrgencyCurve[]) {
      const atHorizon = computeUrgencyBreakdown(task({ urgency_curve: curve, due_date: due(URGENCY_HORIZON_DAYS) }))
      expect(atHorizon.timePressure).toBeCloseTo(0, 6)
    }
  })

  it('step keeps a floor beyond the horizon, unlike the other two', () => {
    // curveShape's step branch returns 0.08 rather than 0 below ramp 0.6, so a
    // step task carries 4 points of pressure even a year out where linear and
    // exponential carry none. Migration 0011 does the same (`else 0.08`), so
    // the two sides agree — but the comment above curveShape claims every
    // curve starts at 0, and this is the one that does not. Pinned as-is:
    // changing it would move every existing score and need a new migration.
    const atHorizon = computeUrgencyBreakdown(task({ urgency_curve: 'step', due_date: due(URGENCY_HORIZON_DAYS) }))
    expect(atHorizon.timePressure).toBeCloseTo(4, 6)
  })

  it('never decrease as the deadline approaches', () => {
    for (const curve of CURVES) {
      let prev = -Infinity
      for (let d = URGENCY_HORIZON_DAYS; d >= 0; d--) {
        const score = computeUrgency(task({ urgency_curve: curve, due_date: due(d) }))
        expect(score).toBeGreaterThanOrEqual(prev)
        prev = score
      }
    }
  })

  it('stay quiet longer than linear in the middle of the window', () => {
    // The point of the exponential curve: a week out it should be pressing
    // less than a linear task at the same distance.
    const mid = URGENCY_HORIZON_DAYS / 2
    const lin = computeUrgency(task({ urgency_curve: 'linear', due_date: due(mid) }))
    const exp = computeUrgency(task({ urgency_curve: 'exponential', due_date: due(mid) }))
    expect(exp).toBeLessThan(lin)
  })

  it('defaults to linear when the curve is missing', () => {
    const withCurve = computeUrgency(task({ urgency_curve: 'linear', due_date: due(5) }))
    // Rows written before the column existed read back as null.
    const noCurve = computeUrgency(task({ urgency_curve: null as unknown as UrgencyCurve, due_date: due(5) }))
    expect(noCurve).toBe(withCurve)
  })
})

describe('breakdown agrees with the score', () => {
  it('sums its parts', () => {
    for (const p of [1, 2, 3, 4] as const) {
      for (const d of [20, 14, 7, 1, 0, -2, -10]) {
        const b = computeUrgencyBreakdown(task({ priority: p, due_date: due(d) }))
        expect(b.score).toBeCloseTo(Math.min(b.priorityPts + b.timePressure, 100), 6)
      }
    }
  })
})
