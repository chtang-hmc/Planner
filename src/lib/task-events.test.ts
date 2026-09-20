import { describe, it, expect } from 'vitest'
import {
  titleTokens, suggestTaskEventLinks, topSuggestion, MIN_CONFIDENCE,
  type DecidedLink, type LinkableEvent, type LinkableTask,
} from '@/lib/task-events'
import { dueMinutesFor } from '@/lib/capacity'

const DAY = '2026-09-20'
const task = (id: string, title: string, over: Partial<LinkableTask> = {}): LinkableTask =>
  ({ id, title, dueDay: DAY, minutes: 60, ...over })
const event = (id: string, title: string, over: Partial<LinkableEvent> = {}): LinkableEvent =>
  ({ id, title, day: DAY, minutes: 60, ...over })

describe('title tokens', () => {
  it('keeps the words that are evidence and drops the connectives', () => {
    expect(titleTokens('Prep for Big E&M Grutoring')).toEqual(['prep', 'big', 'grutoring'])
  })

  it('keeps domain words like "prep"', () => {
    // Dropping them made the real pair indistinguishable from the wrong one —
    // see the confidence metric. "Prep for X" vs "Prep for Y" is refused by
    // the score, not by throwing the word away.
    expect(titleTokens('Prep')).toEqual(['prep'])
  })

  it('drops tokens under three characters', () => {
    // Which loses `e&m` — unfortunate for the very pair this exists for, and
    // still right: two-letter tokens match far too much.
    expect(titleTokens('E&M')).toEqual([])
  })

  it('deduplicates, so a repeated word is not extra evidence', () => {
    expect(titleTokens('Clinic clinic CLINIC report')).toEqual(['clinic', 'report'])
  })
})

describe('the pair this was built for', () => {
  const t = task('t1', 'Prep for Big E&M Grutoring')
  const e = event('e1', 'Big E&M Grutoring Prep')

  it('finds it', () => {
    const [c] = suggestTaskEventLinks([t], [e])
    expect(c).toMatchObject({ taskId: 't1', eventId: 'e1' })
    expect(c.shared.sort()).toEqual(['big', 'grutoring', 'prep'])
    expect(c.confidence).toBe(1)
  })

  it('does not find it on a different day', () => {
    // A task due Tuesday is not covered by an event last Thursday, however
    // alike the titles.
    expect(suggestTaskEventLinks([t], [event('e1', 'Big E&M Grutoring Prep', { day: '2026-09-18' })]))
      .toEqual([])
  })

  it('does not find it for an undated task', () => {
    expect(suggestTaskEventLinks([task('t1', 'Prep for Big E&M Grutoring', { dueDay: null })], [e]))
      .toEqual([])
  })

  it('never offers it again once decided', () => {
    // A rejection that does not stick means the same wrong suggestion every
    // morning, which is how a prompt becomes something people dismiss unread.
    const rejected: DecidedLink[] = [{ taskId: 't1', eventId: 'e1', status: 'rejected' }]
    expect(suggestTaskEventLinks([t], [e], rejected)).toEqual([])
  })

  it('prefers the prep event over the lecture of the same name', () => {
    // Both found on the live calendar, both scoring 1.0 under the old metric
    // because `big` and `grutoring` were all that survived of either title.
    // The suggestion shown was a coin flip between right and wrong.
    const lecture = event('e2', 'Big E&M Grutoring', { minutes: 180 })
    const cands = suggestTaskEventLinks([t], [e, lecture])
    expect(topSuggestion(cands)!.eventId).toBe('e1')
    expect(cands[0].confidence).toBeGreaterThan(cands[1].confidence)
  })

  it('stops asking once a confirmed link covers the task', () => {
    // The join table exists so one task can span two sittings — but once they
    // add up, confirming the right link should not earn a question about the
    // wrong one.
    const lecture = event('e2', 'Big E&M Grutoring', { minutes: 180 })
    const confirmed: DecidedLink[] = [{ taskId: 't1', eventId: 'e1', status: 'confirmed' }]
    expect(suggestTaskEventLinks([t], [e, lecture], confirmed)).toEqual([])
  })

  it('keeps asking while a confirmed link covers only part of it', () => {
    const halfHour = event('e3', 'Big E&M Grutoring Prep', { minutes: 30 })
    const confirmed: DecidedLink[] = [{ taskId: 't1', eventId: 'e3', status: 'confirmed' }]
    expect(suggestTaskEventLinks([t], [e, halfHour], confirmed).map(c => c.eventId)).toEqual(['e1'])
  })

  it('refuses "Prep for X" against "Prep for Y"', () => {
    expect(suggestTaskEventLinks(
      [task('t9', 'Prep for Rosner')],
      [event('e9', 'Prep for Baumgartner')],
    )).toEqual([])
  })
})

describe('what it refuses to guess', () => {
  it('will not pair on a single word out of many', () => {
    const c = suggestTaskEventLinks(
      [task('t', 'Clinic statement of work and literature review')],
      [event('e', 'Clinic team standup')],
    )
    expect(c).toEqual([])
  })

  it('scores an exact title at 1', () => {
    const [c] = suggestTaskEventLinks(
      [task('t', 'Review OS Processes')],
      [event('e', 'Review OS Processes')],
    )
    expect(c.confidence).toBe(1)
    expect(c.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
  })

  it('ignores an event whose title is all stopwords', () => {
    expect(suggestTaskEventLinks([task('t', 'Clinic report')], [event('e', 'Work session')]))
      .toEqual([])
  })

  it('offers one suggestion at a time, the most confident', () => {
    // A timeline asking four questions at once is a queue, and a queue gets
    // closed rather than answered.
    const cands = suggestTaskEventLinks(
      [task('t1', 'Piano practice'), task('t2', 'Clinic statement of work')],
      [event('e1', 'Piano practice'), event('e2', 'Clinic statement of work review')],
    )
    expect(topSuggestion(cands)!.taskId).toBe('t1')   // 1.0 beats the partial
  })

  it('has nothing to offer when nothing matches', () => {
    expect(topSuggestion([])).toBeNull()
  })
})

describe('a confirmed link stops the hour being counted twice', () => {
  const tasks = [
    { id: 't1', dueDay: DAY, minutes: 60 },
    { id: 't2', dueDay: DAY, minutes: 150 },
  ]

  it('counts both while nothing is confirmed', () => {
    expect(dueMinutesFor(tasks, DAY)).toBe(210)
  })

  it('drops the covered one', () => {
    // Its time is already on the calendar, so it is out of the free total.
    // Counting it as due as well makes the day look worse by the whole block.
    expect(dueMinutesFor(tasks, DAY, new Set(['t1']))).toBe(150)
  })

  it('ignores a covered id that is not due today', () => {
    expect(dueMinutesFor([{ id: 't1', dueDay: '2026-10-01', minutes: 60 }], DAY, new Set(['t1']))).toBe(0)
  })
})
