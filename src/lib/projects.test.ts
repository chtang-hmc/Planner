import { describe, it, expect } from 'vitest'
import {
  isActiveTask, buildProjectRows, projectStatus, sortProjectRows,
  projectsSummary, projectsFinding, CONCENTRATION_THRESHOLD, STALL_DAYS,
} from '@/lib/projects'
import type { Task, Project } from '@/types'

const TODAY = '2026-09-21'

function proj(id: string, name = id): Project {
  return { id, name, color: '#2E5FA3', archived: false, created_at: '2026-01-01T00:00:00Z' }
}

type TaskFixture = Parameters<typeof buildProjectRows>[0]['tasks'][number]

function task(over: Partial<TaskFixture> = {}): TaskFixture {
  return {
    project_id: null, parent_id: null, status: 'active' as Task['status'],
    type: 'task' as Task['type'], estimated_minutes: 60, adjusted_minutes: null,
    due_date: null, completed_at: null,
    ...over,
  }
}

const build = (tasks: TaskFixture[], projects: Project[] = []) =>
  buildProjectRows({ projects, tasks, todayStr: TODAY })

describe('isActiveTask', () => {
  it('counts open, non-someday, top-level tasks', () => {
    expect(isActiveTask(task())).toBe(true)
    expect(isActiveTask(task({ status: 'inbox' }))).toBe(true)
  })

  it('excludes subtasks, so a six-step task does not outrank six projects', () => {
    expect(isActiveTask(task({ parent_id: 'p' }))).toBe(false)
  })

  it('excludes someday, which is a parking lot rather than work', () => {
    expect(isActiveTask(task({ type: 'someday' }))).toBe(false)
  })

  it('excludes done and cancelled', () => {
    expect(isActiveTask(task({ status: 'done' }))).toBe(false)
    expect(isActiveTask(task({ status: 'cancelled' }))).toBe(false)
  })
})

describe('buildProjectRows', () => {
  it('sums the bias-corrected estimate when there is one', () => {
    const [row] = build([task({ project_id: 'a', estimated_minutes: 60, adjusted_minutes: 90 })], [proj('a')])
    expect(row.minutesLeft).toBe(90)
  })

  it('measures progress at the same grain it measures work', () => {
    // Two active, two done, plus a subtask and a someday that count for neither.
    const [row] = build([
      task({ project_id: 'a' }), task({ project_id: 'a' }),
      task({ project_id: 'a', status: 'done' }), task({ project_id: 'a', status: 'done' }),
      task({ project_id: 'a', parent_id: 'x' }),
      task({ project_id: 'a', type: 'someday' }),
    ], [proj('a')])
    expect(row.activeCount).toBe(2)
    expect(row.doneCount).toBe(2)
    expect(row.progress).toBe(0.5)
  })

  it('leaves progress null for a project with nothing in it', () => {
    const [row] = build([], [proj('a')])
    expect(row.progress).toBeNull()
    expect(row.minutesLeft).toBe(0)
  })

  it('omits Inbox when it is empty, and renders it when it is not', () => {
    expect(build([task({ project_id: 'a' })], [proj('a')]).map(r => r.name)).toEqual(['a'])
    expect(build([task()], []).map(r => r.name)).toEqual(['Inbox — no project'])
  })

  it('counts a completed Inbox task as history, so Inbox survives an empty day', () => {
    const rows = build([task({ status: 'done' })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].activeCount).toBe(0)
  })

  it('shares out the whole table, Inbox included', () => {
    const rows = build([
      task({ project_id: 'a', estimated_minutes: 75 }),
      task({ estimated_minutes: 25 }),
    ], [proj('a')])
    expect(rows.map(r => r.share)).toEqual([0.75, 0.25])
  })

  it('sorts by time left and breaks ties by name', () => {
    const rows = build([
      task({ project_id: 'b', estimated_minutes: 30 }),
      task({ project_id: 'a', estimated_minutes: 30 }),
      task({ project_id: 'c', estimated_minutes: 90 }),
    ], [proj('a'), proj('b'), proj('c')])
    expect(rows.map(r => r.name)).toEqual(['c', 'a', 'b'])
  })

  it('takes the earliest active due date, and says how far off it is', () => {
    const [row] = build([
      task({ project_id: 'a', due_date: '2026-09-25T00:00:00Z' }),
      task({ project_id: 'a', due_date: '2026-09-19T00:00:00Z' }),
      task({ project_id: 'a', due_date: '2026-09-01T00:00:00Z', status: 'done' }),
    ], [proj('a')])
    expect(row.nextDue).toBe('2026-09-19')
    expect(row.nextDueIn).toBe(-2)
  })
})

describe('projectStatus', () => {
  const base = {
    isInbox: false, activeCount: 2, doneCount: 3, daysSinceDone: 1,
    nextDueIn: 3, share: 0.1, isLargest: false,
  }

  it('leads with the overdue-and-never-started case', () => {
    expect(projectStatus({ ...base, doneCount: 0, nextDueIn: -1 }))
      .toEqual({ text: 'Overdue, never started', tone: 'danger' })
  })

  it('says never started without an overdue date', () => {
    expect(projectStatus({ ...base, doneCount: 0, nextDueIn: 3 }).text).toBe('Never started')
    expect(projectStatus({ ...base, doneCount: 0, nextDueIn: null }).text).toBe('Never started')
  })

  it('never-started beats Inbox, because it is the sharper thing to say', () => {
    expect(projectStatus({ ...base, isInbox: true, doneCount: 0 }).text).toBe('Never started')
  })

  it('names Inbox for what is wrong with it', () => {
    expect(projectStatus({ ...base, isInbox: true }))
      .toEqual({ text: 'Needs assigning', tone: 'quiet' })
  })

  it('will not call an empty project on track', () => {
    expect(projectStatus({ ...base, activeCount: 0 }))
      .toEqual({ text: 'Nothing active', tone: 'quiet' })
  })

  it('names concentration only on the largest row, and only above the threshold', () => {
    const over = CONCENTRATION_THRESHOLD + 0.09
    expect(projectStatus({ ...base, share: over, isLargest: true }).text)
      .toBe(`${Math.round(over * 100)}% of all time left`)
    // Same share, not the largest: a rule that fires twice is a description.
    expect(projectStatus({ ...base, share: over, isLargest: false }).text).toBe('On track')
    // Largest, but under the threshold — which is where today's data sits.
    expect(projectStatus({ ...base, share: 0.32, isLargest: true }).text).toBe('On track')
  })

  it('counts a stall in days since the last completion', () => {
    expect(projectStatus({ ...base, daysSinceDone: STALL_DAYS }).text).toBe(`Stalled ${STALL_DAYS} days`)
    expect(projectStatus({ ...base, daysSinceDone: STALL_DAYS - 1 }).text).toBe('On track')
  })

  it('concentration outranks a stall, because it is the bigger fact', () => {
    expect(projectStatus({ ...base, share: 0.5, isLargest: true, daysSinceDone: 90 }).text)
      .toBe('50% of all time left')
  })
})

describe('sortProjectRows', () => {
  const rows = build([
    task({ project_id: 'a', estimated_minutes: 30, due_date: '2026-09-30T00:00:00Z' }),
    task({ project_id: 'b', estimated_minutes: 90 }),
    task({ project_id: 'c', estimated_minutes: 60, due_date: '2026-09-22T00:00:00Z' }),
    task({ project_id: 'c', status: 'done' }),
  ], [proj('a'), proj('b'), proj('c')])

  it('puts a project with no due date last, not first', () => {
    expect(sortProjectRows(rows, 'due').map(r => r.name)).toEqual(['c', 'a', 'b'])
  })

  it('sorts progress descending, with no progress at all sorting last', () => {
    expect(sortProjectRows(rows, 'progress').map(r => r.name)).toEqual(['c', 'a', 'b'])
  })

  it('does not mutate what it was given', () => {
    const before = rows.map(r => r.name)
    sortProjectRows(rows, 'name')
    expect(rows.map(r => r.name)).toEqual(before)
  })
})

describe('the line under the heading', () => {
  it('counts projects without counting Inbox as one', () => {
    const rows = build([
      task({ project_id: 'a', estimated_minutes: 60 }),
      task({ estimated_minutes: 30 }),
    ], [proj('a')])
    expect(projectsSummary(rows)).toEqual({ projectCount: 1, activeCount: 2, minutesLeft: 90 })
  })

  it('names the one project that has never finished anything', () => {
    const rows = build([task({ project_id: 'a' }), task({ project_id: 'b', status: 'done' })],
      [proj('a'), proj('b')])
    expect(projectsFinding(rows)).toBe('a has never had a task completed.')
  })

  it('counts them once there is more than one', () => {
    const rows = build([task({ project_id: 'a' }), task({ project_id: 'b' })], [proj('a'), proj('b')])
    expect(projectsFinding(rows)).toBe('2 projects have never had a task completed.')
  })

  it('says nothing when every project has a completion, rather than inventing a finding', () => {
    const rows = build([task({ project_id: 'a', status: 'done' })], [proj('a')])
    expect(projectsFinding(rows)).toBeNull()
  })

  it('does not count Inbox as a project that never started', () => {
    expect(projectsFinding(build([task()], []))).toBeNull()
  })
})
