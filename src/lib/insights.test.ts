import { describe, it, expect } from 'vitest'
import {
  capacityFinding, urgencyFinding, concentrationFinding,
  workloadFinding, workloadSegments, URGENCY_HIGH,
} from '@/lib/insights'
import { buildProjectRows } from '@/lib/projects'
import type { Project, Task } from '@/types'

const TODAY = '2026-09-21'

const proj = (id: string, name = id): Project =>
  ({ id, name, color: '#2E5FA3', archived: false, created_at: '2026-01-01T00:00:00Z' })

type TaskFixture = Parameters<typeof buildProjectRows>[0]['tasks'][number]
const task = (over: Partial<TaskFixture> = {}): TaskFixture => ({
  project_id: null, parent_id: null, status: 'active' as Task['status'],
  type: 'task' as Task['type'], estimated_minutes: 60, adjusted_minutes: null,
  due_date: null, completed_at: null, ...over,
})

describe('capacityFinding', () => {
  const base = { dueCount: 10, fitCount: 2 }

  it('names both numbers in the headline', () => {
    const f = capacityFinding({
      ...base, capacity: { dueTotal: 650, freeBeforeCutoff: 105, freeAfterCutoff: 210 },
    })!
    expect(f.headline).toBe('Today holds 10h 50m of work and 5h 15m of time.')
    expect(f.evidence).toBe('10 tasks are due. 2 of them fit before 10pm. That leaves 5h 35m with nowhere to go.')
    expect(f.urgent).toBe(true)
  })

  it('says nothing on a day that fits — there is no finding in "it is fine"', () => {
    expect(capacityFinding({
      ...base, capacity: { dueTotal: 60, freeBeforeCutoff: 300, freeAfterCutoff: 0 },
    })).toBeNull()
  })

  it('will not report a ratio it does not have', () => {
    // No calendar connected, or a day off: zeroes are not a workload finding.
    expect(capacityFinding({ ...base, capacity: null })).toBeNull()
    expect(capacityFinding({
      ...base, capacity: { dueTotal: 650, freeBeforeCutoff: 0, freeAfterCutoff: 0 },
    })).toBeNull()
    expect(capacityFinding({
      ...base, capacity: { dueTotal: 0, freeBeforeCutoff: 300, freeAfterCutoff: 0 },
    })).toBeNull()
  })

  it('has words for a day where nothing fits', () => {
    expect(capacityFinding({
      capacity: { dueTotal: 600, freeBeforeCutoff: 30, freeAfterCutoff: 0 },
      dueCount: 1, fitCount: 0,
    })!.evidence).toContain('None of them fits before 10pm.')
  })
})

describe('urgencyFinding', () => {
  const scores = (high: number, total: number) =>
    [...Array(high).fill(85), ...Array(total - high).fill(30)]

  it('fires when the score has stopped sorting', () => {
    const f = urgencyFinding(scores(20, 26))!
    expect(f.headline).toBe(`20 of your 26 tasks score above ${URGENCY_HIGH}.`)
    expect(f.evidence).toContain('20 tasks sit above 80 and only 6 below 40.')
  })

  it('stays quiet when the distribution is doing its job', () => {
    expect(urgencyFinding(scores(5, 26))).toBeNull()
  })

  it('will not read a shape into five points', () => {
    expect(urgencyFinding([90, 90, 90, 90])).toBeNull()
  })

  it('says "none" rather than "only 0"', () => {
    expect(urgencyFinding(Array(10).fill(85))!.evidence).toContain('and none below 40.')
  })
})

describe('concentrationFinding', () => {
  const build = (mins: Record<string, number>) => buildProjectRows({
    projects: Object.keys(mins).map(k => proj(k)),
    tasks: Object.entries(mins).flatMap(([k, m]) =>
      [task({ project_id: k, estimated_minutes: m }), task({ project_id: k, status: 'done' })]),
    todayStr: TODAY,
  })

  it('names the project and its share', () => {
    const f = concentrationFinding({
      rows: build({ Research: 600, Other: 200, Third: 100 }), scheduledCount: 0,
    })!
    expect(f.headline).toBe('Research is 67% of everything you have left.')
    expect(f.evidence).toBe('10h across 1 active task, 50% done. None of them has a time on the calendar this week.')
    expect(f.action.label).toBe('Open Research →')
  })

  it('stays quiet below the threshold, which is where the real data sits', () => {
    // Three projects at a third each: no one of them has taken over.
    expect(concentrationFinding({
      rows: build({ A: 100, B: 100, C: 100 }), scheduledCount: 0,
    })).toBeNull()
  })

  it('reports what is already booked rather than claiming nothing is', () => {
    expect(concentrationFinding({
      rows: build({ Research: 600, Other: 100 }), scheduledCount: 2,
    })!.evidence).toContain('2 of them have a time on the calendar this week.')
  })

  it('never hands the title to Inbox', () => {
    const rows = buildProjectRows({
      projects: [proj('Small')],
      tasks: [
        task({ estimated_minutes: 900 }),                       // Inbox, the biggest
        task({ project_id: 'Small', estimated_minutes: 100 }),
        task({ project_id: 'Small', status: 'done' }),
      ],
      todayStr: TODAY,
    })
    // Small is only 10%, so nothing fires — rather than Inbox claiming it.
    expect(concentrationFinding({ rows, scheduledCount: 0 })).toBeNull()
  })
})

describe('workloadFinding', () => {
  const rows = (inboxMins: number, projMins: number) => buildProjectRows({
    projects: [proj('P')],
    tasks: [
      ...(inboxMins > 0 ? [task({ estimated_minutes: inboxMins })] : []),
      task({ project_id: 'P', estimated_minutes: projMins }),
    ],
    todayStr: TODAY,
  })

  it('names the unassigned pile and how big a share it is', () => {
    expect(workloadFinding(rows(525, 1150))).toBe('8h 45m of it — nearly a third — has no project.')
  })

  it('drops the qualifier when there is not a phrase that fits', () => {
    expect(workloadFinding(rows(60, 1000))).toBe('1h of it has no project.')
  })

  it('says nothing about an empty inbox, which is a quiet win', () => {
    expect(workloadFinding(rows(0, 600))).toBeNull()
  })
})

describe('workloadSegments', () => {
  it('drops rows with no time, which would be invisible segments', () => {
    const rows = buildProjectRows({
      projects: [proj('A'), proj('B')],
      tasks: [
        task({ project_id: 'A', estimated_minutes: 300 }),
        task({ project_id: 'B', status: 'done' }),
      ],
      todayStr: TODAY,
    })
    expect(workloadSegments(rows).map(s => s.name)).toEqual(['A'])
  })

  it('shares sum to one across the rows that have work', () => {
    const rows = buildProjectRows({
      projects: [proj('A'), proj('B')],
      tasks: [
        task({ project_id: 'A', estimated_minutes: 300 }),
        task({ project_id: 'B', estimated_minutes: 100 }),
      ],
      todayStr: TODAY,
    })
    expect(workloadSegments(rows).reduce((n, s) => n + s.share, 0)).toBeCloseTo(1)
  })
})
