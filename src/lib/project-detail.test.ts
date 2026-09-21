import { describe, it, expect } from 'vitest'
import {
  projectStats, projectContext, linkedEvents, calendarTotal,
  repeatingTasks, cadenceOf, nextLanding,
} from '@/lib/project-detail'
import { thinData, estimateAccuracy, ESTIMATE_SAMPLES_NEEDED } from '@/lib/thin-data'
import type { Task } from '@/types'

const TODAY = '2026-09-21'

type T = Parameters<typeof repeatingTasks>[0][number]
function task(over: Partial<T> = {}): T {
  return {
    id: 't', title: 'A task', rrule: null,
    status: 'active' as Task['status'], type: 'task' as Task['type'], parent_id: null,
    due_date: null, completed_at: null, estimated_minutes: 60, adjusted_minutes: null,
    ...over,
  }
}

describe('projectStats', () => {
  it('measures work and progress at the same grain', () => {
    expect(projectStats([
      task(), task({ estimated_minutes: 15 }),
      task({ status: 'done' }),
      task({ parent_id: 'p' }), task({ type: 'someday' }),
    ])).toEqual({ activeCount: 2, doneCount: 1, minutesLeft: 75, progress: 1 / 3 })
  })

  it('has no progress to report for a project with nothing in it', () => {
    expect(projectStats([]).progress).toBeNull()
  })
})

describe('projectContext — said only when true', () => {
  const due = (d: string) => task({ due_date: `${d}T00:00:00Z` })

  it('leads with what is already late', () => {
    expect(projectContext([due('2026-09-19'), due('2026-09-25')], TODAY))
      .toBe('One task is already past its deadline.')
    expect(projectContext([due('2026-09-19'), due('2026-09-18'), due('2026-09-25')], TODAY))
      .toBe('2 tasks are already past their deadline.')
  })

  it('says so when every remaining task is late', () => {
    expect(projectContext([due('2026-09-19'), due('2026-09-18')], TODAY))
      .toBe('Every remaining task is already past its deadline.')
  })

  it('has the designer\'s sentence for exactly two, both imminent', () => {
    expect(projectContext([due(TODAY), due('2026-09-22')], TODAY))
      .toBe('Both remaining tasks are due in the next 24 hours.')
  })

  it('counts them when there are more than two', () => {
    expect(projectContext([due(TODAY), due(TODAY), due('2026-09-22')], TODAY))
      .toBe('All 3 remaining tasks are due in the next 24 hours.')
  })

  it('does not claim imminence when one task is further out', () => {
    expect(projectContext([due(TODAY), due('2026-09-30')], TODAY)).toBeNull()
  })

  it('names the absence of deadlines, which a due column cannot', () => {
    expect(projectContext([task(), task()], TODAY)).toBe('Nothing here has a deadline.')
  })

  it('says nothing about an ordinary project rather than inventing a finding', () => {
    expect(projectContext([due('2026-09-30'), task()], TODAY)).toBeNull()
  })

  it('says nothing at all when there is no active work', () => {
    expect(projectContext([task({ status: 'done' })], TODAY)).toBeNull()
  })
})

describe('linkedEvents', () => {
  const ev = (id: string, start: string, mins: number, title = id) => ({
    id, title, start_time: start,
    end_time: new Date(Date.parse(start) + mins * 60_000).toISOString(),
    all_day: false,
  })
  const week = { fromMs: Date.parse('2026-09-21T00:00:00Z'), toMs: Date.parse('2026-09-28T00:00:00Z') }

  it('follows the link table, not a field on the event', () => {
    const out = linkedEvents({
      links: [{ task_id: 'a', event_id: 'e1' }, { task_id: 'other', event_id: 'e2' }],
      taskIds: new Set(['a']),
      events: [ev('e1', '2026-09-22T19:00:00Z', 60), ev('e2', '2026-09-22T20:00:00Z', 60)],
      ...week,
    })
    expect(out.map(e => e.id)).toEqual(['e1'])
    expect(out[0].minutes).toBe(60)
  })

  it('drops events outside the window and sorts what is left', () => {
    const out = linkedEvents({
      links: [{ task_id: 'a', event_id: 'e1' }, { task_id: 'a', event_id: 'e2' }, { task_id: 'a', event_id: 'old' }],
      taskIds: new Set(['a']),
      events: [
        ev('e2', '2026-09-24T11:00:00Z', 75), ev('e1', '2026-09-22T12:00:00Z', 60),
        ev('old', '2026-09-01T12:00:00Z', 60),
      ],
      ...week,
    })
    expect(out.map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('counts one event once even when two tasks point at it', () => {
    const out = linkedEvents({
      links: [{ task_id: 'a', event_id: 'e1' }, { task_id: 'b', event_id: 'e1' }],
      taskIds: new Set(['a', 'b']),
      events: [ev('e1', '2026-09-22T12:00:00Z', 60)],
      ...week,
    })
    expect(out).toHaveLength(1)
  })

  it('totals the timed events, because an all-day one has no duration to add', () => {
    expect(calendarTotal([
      { id: 'a', title: 'a', startMs: 0, minutes: 60, allDay: false },
      { id: 'b', title: 'b', startMs: 0, minutes: 75, allDay: false },
      { id: 'c', title: 'c', startMs: 0, minutes: 1440, allDay: true },
    ])).toBe('2h 15m')
  })
})

describe('cadenceOf', () => {
  it('reads the common rules', () => {
    expect(cadenceOf('FREQ=WEEKLY')).toBe('weekly')
    expect(cadenceOf('FREQ=WEEKLY;BYDAY=SU')).toBe('weekly')
    expect(cadenceOf('FREQ=DAILY')).toBe('daily')
    expect(cadenceOf('FREQ=WEEKLY;INTERVAL=2')).toBe('every 2 weeks')
  })

  it('keeps a rule it cannot read rather than guessing', () => {
    expect(cadenceOf('FREQ=HOURLY')).toBe('FREQ=HOURLY')
  })
})

describe('repeatingTasks', () => {
  it('collapses occurrences to one entry, keyed by title', () => {
    const out = repeatingTasks([
      task({ id: '1', title: 'Status report', rrule: 'FREQ=WEEKLY', status: 'done',
             due_date: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T10:00:00Z' }),
      task({ id: '2', title: 'Status report', rrule: 'FREQ=WEEKLY',
             due_date: '2026-09-22T00:00:00Z', estimated_minutes: 15 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      title: 'Status report', cadence: 'weekly', minutes: 15, nextDue: '2026-09-22',
    })
  })

  it('reads its history from the occurrences that finished', () => {
    const done = (due: string, at: string) => task({
      title: 'R', rrule: 'FREQ=WEEKLY', status: 'done' as Task['status'],
      due_date: `${due}T00:00:00Z`, completed_at: `${at}T10:00:00Z`,
    })
    expect(repeatingTasks([done('2026-09-07', '2026-09-07'), done('2026-09-14', '2026-09-14')])[0].history)
      .toBe('All 2 so far were on time.')
    expect(repeatingTasks([done('2026-09-07', '2026-09-09'), done('2026-09-14', '2026-09-14')])[0].history)
      .toBe('1 of 2 was late.')
  })

  it('has no history to report before anything has run', () => {
    expect(repeatingTasks([task({ rrule: 'FREQ=WEEKLY', due_date: `${TODAY}T00:00:00Z` })])[0].history)
      .toBeNull()
  })

  it('ignores tasks that do not repeat', () => {
    expect(repeatingTasks([task(), task({ rrule: 'FREQ=DAILY' })])).toHaveLength(1)
  })

  it('sorts by what lands next, with the unscheduled last', () => {
    const out = repeatingTasks([
      task({ title: 'C', rrule: 'FREQ=DAILY' }),
      task({ title: 'B', rrule: 'FREQ=WEEKLY', due_date: '2026-09-30T00:00:00Z' }),
      task({ title: 'A', rrule: 'FREQ=WEEKLY', due_date: '2026-09-22T00:00:00Z' }),
    ])
    expect(out.map(r => r.title)).toEqual(['A', 'B', 'C'])
  })
})

describe('nextLanding', () => {
  it('speaks in days from today', () => {
    expect(nextLanding(TODAY, TODAY)).toBe('Next one lands today.')
    expect(nextLanding('2026-09-22', TODAY)).toBe('Next one lands tomorrow.')
    expect(nextLanding('2026-09-25', TODAY)).toBe('Next one lands in 4 days.')
    expect(nextLanding('2026-09-20', TODAY)).toBe('The next one is 1 day overdue.')
    expect(nextLanding(null, TODAY)).toBe('Nothing scheduled.')
  })
})

describe('thinData', () => {
  it('always puts a noun on the right-hand value', () => {
    expect(thinData({
      have: 1, need: 7, unit: ['project', 'projects'],
      unlocks: n => `${n} to go`, readyText: 'done',
    }).unit).toBe('7 projects')
  })

  it('caps the bar rather than letting it claim the threshold moved', () => {
    expect(thinData({
      have: 9, need: 3, unit: ['sample', 'samples'], unlocks: () => '', readyText: 'ok',
    }).ratio).toBe(1)
  })

  it('switches from a promise to a statement at the threshold', () => {
    const under = estimateAccuracy({ projectName: 'Clinic', sampleCount: 1, biasRatio: 0.3 })
    expect(under.ready).toBe(false)
    expect(under.unlocks).toBe(
      'Two more finished Clinic tasks with a reflection and Planner can start correcting these estimates for you.')

    const at = estimateAccuracy({ projectName: 'Clinic', sampleCount: ESTIMATE_SAMPLES_NEEDED, biasRatio: 1.25 })
    expect(at.ready).toBe(true)
    expect(at.unlocks).toBe(
      'Clinic tasks run about 25% longer than you estimate. Planner is correcting for it.')
  })

  it('will not quote a bias ratio it does not yet trust', () => {
    // One sample at 0.33 is not "67% faster" — it is one task.
    expect(estimateAccuracy({ projectName: 'TA', sampleCount: 1, biasRatio: 0.333 }).unlocks)
      .not.toContain('%')
  })

  it('calls an accurate estimator accurate rather than quoting noise', () => {
    expect(estimateAccuracy({ projectName: 'Personal', sampleCount: 3, biasRatio: 1.02 }).unlocks)
      .toBe('Your Personal estimates are about right.')
  })
})
